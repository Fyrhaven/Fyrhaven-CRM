// The cloud service's own routes: the shop pages, the price list, customer
// accounts and sessions, the Stripe webhook, the operator panel, orders and
// licence issuing.
//
// **This file is not in the self-hosted archive.** `scripts/dist.mjs` replaces it
// with a stub, so a customer's copy contains none of this code — and that is the
// reason the two builds are two artifacts rather than one binary with a switch.
//
// It is handed a context (everything the request handler owns) and answers `true`
// when it answered the request itself. Two phases, because token authentication
// sits between them and belongs to the record API as much as to this one:
//
//   phase 1 (`authed: false`) — shop, catalogue, signup, webhook, panel
//   phase 2 (`authed: true`)  — sessions, the account, orders, licence issuing

import { deactivationChallenge, describeLicence, isInstallKey, licencePayload, publicKeyOf, readChallenge, signDeactivation, signLicence, verifyDeactivation, verifyLicence } from './licence.js';
import { accountWorkspace } from './accounts.js';
import { createCheckout, createStripePrice, planFromEvent, verifyStripeSignature } from './payments.js';

export async function cloudRoute(ctx, request) {
  const {
    send: rawSend, readBody, now, people, catalogue, payments, fetchJson, authenticate, tooMany, bump,
    siteFile, SITE_FILES, SITE_TYPES, adminToken, licence, licencePublic, licencePrivate, installKey, VERSION,
    ops, issueLicence, usageOf, tokenOf, sameToken, db, keys, s3, allowQueryToken, traffic,
    DEFAULT_SCOPE,
    webhookState, noteWebhook, pendingChallenge, setChallenge,
  } = ctx;

  // `send` here answers **and** says so. The handler's own send returns nothing,
  // so a route that ended in `return send(...)` reported "not mine" and the
  // record API then answered a second time on the same socket.
  const send = (...args) => { rawSend(...args); return true; };
  const { req, res, url, path, method, who } = request;
  const client = req.socket?.remoteAddress ?? 'unknown';
  const body = async () => {
    const raw = await readBody(req);
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  if (!request.authed) {
    // The site (#148): the page a customer signs up and orders on. Static files,
    // no build step, served by the same container as the API.
    if (method === 'GET' && SITE_FILES[path]) {
      const body = await siteFile(SITE_FILES[path]);
      if (body === null) return send(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'content-type': SITE_TYPES[SITE_FILES[path]],
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      return res.end(body);
    }

    // What is for sale: open, because a price list is a shop window.
    if (method === 'GET' && path === '/v1/products') {
      const products = catalogue.all({ onlyActive: true })
        .map((product) => ({ ...product, prices: catalogue.pricesFor(catalogue.row(product.id)) }));
      return send(res, 200, { ok: true, products, payments: payments.provider });
    }

    // ── Open endpoints: sign up, sign in ────────────────────────────────
    if (method === 'POST' && (path === '/v1/accounts' || path === '/v1/sessions')) {
      if (tooMany(`open:${client}`)) return send(res, 429, { error: 'too many requests' });
      const payload = await body();
      if (!payload || typeof payload !== 'object') return send(res, 400, { error: 'body is not JSON' });

      if (path === '/v1/accounts') {
        const answer = await people.signup({ email: payload.email, password: payload.password, now: now() });
        if (answer.status === 'invalid-email') return send(res, 400, { error: 'that email address is not valid' });
        if (answer.status === 'too-short') return send(res, 400, { error: 'the password needs at least 10 characters' });
        if (answer.status === 'too-long') return send(res, 400, { error: 'the password is too long' });
        if (answer.status === 'exists') return send(res, 409, { error: 'that email already has an account' });
        return send(res, 201, { ok: true, token: answer.token, account: answer.account });
      }

      const answer = await people.login({ email: payload.email, password: payload.password, now: now() });
      if (answer.status !== 'ok') return send(res, 401, { error: 'email or password is wrong' });
      return send(res, 200, { ok: true, token: answer.token, account: answer.account });
    }

    // ── The payment provider's webhook (no bearer: the signature is the proof) ──
    if (path === '/v1/payments/webhook' && method === 'POST') {
      const raw = await readBody(req);
      const signature = req.headers['stripe-signature'];
      if (!verifyStripeSignature({ header: signature, payload: raw, secret: payments.webhookSecret, now: now() })) {
        return send(res, 400, { error: 'bad signature' });
      }
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'body is not JSON' });
      }
      noteWebhook({ at: new Date(now()).toISOString(), type: String(event?.type ?? ''), result: 'accepted' });
      const meaning = planFromEvent(event);
      if (!meaning) return send(res, 200, { ok: true, ignored: true });
      if (!people.byId(meaning.accountId)) return send(res, 200, { ok: true, ignored: 'no such account' });
      people.setPlan(meaning.accountId, meaning.plan, { days: payments.planDays, now: now() });
      if (meaning.orderId) people.setOrderStatus(meaning.orderId, 'paid');

      // A licence product also hands out a key: the software is self-hosted, so
      // the key is the whole entitlement and nothing calls home to check it.
      let licence = null;
      const order = meaning.orderId ? people.order(meaning.orderId) : null;
      const product = order?.productId ? catalogue.get(order.productId) : null;
      if (product && product.kind === 'license') {
        licence = issueLicence(meaning.accountId, product, product.days);
      }
      return send(res, 200, { ok: true, plan: meaning.plan, licence });
    }

    // ── The operator's panel (#148): everything under /v1/admin ────────
    if (path === '/v1/admin' || path.startsWith('/v1/admin/')) {
      if (!adminToken) return send(res, 503, { error: 'no admin token configured' });
      const presented = tokenOf(req, url, { allowQueryToken });
      if (!presented || !sameToken(adminToken, presented)) return send(res, 401, { error: 'unauthorized' });
      if (tooMany('admin')) return send(res, 429, { error: 'too many requests' });

      // Where a workspace's bytes live (#158). `sqlite` is always available and
      // `s3` appears once a bucket is configured, so the panel offers only what
      // this process can actually reach.
      const storageRoute = /^\/v1\/admin\/workspaces\/([^/]+)\/storage$/.exec(path);
      if (storageRoute && method === 'GET') {
        const workspace = decodeURIComponent(storageRoute[1]);
        const provider = ops.provider(workspace);
        let used = { records: 0, bytes: 0 };
        let reachable = true;
        try {
          // `?fresh=1` recounts from the bucket; the default reads the counters
          // every write maintains, so an operator can check them without paying
          // for a listing on every page view.
          used = url.searchParams.get('fresh') === '1'
            ? await ops.recount(workspace)
            : await ops.usage(workspace);
        } catch (err) {
          // A workspace on a bucket this process cannot reach has no count, and
          // saying "0 objects" would read as "empty" rather than "unreachable".
          if (!err?.unavailable) throw err;
          reachable = false;
        }
        return send(res, 200, {
          ok: true,
          workspace,
          provider,
          available: ops.available,
          reachable,
          objects: used.records,
          bytes: used.bytes,
        });
      }

      const migrateRoute = /^\/v1\/admin\/workspaces\/([^/]+)\/migrate$/.exec(path);
      if (migrateRoute && method === 'POST') {
        const workspace = decodeURIComponent(migrateRoute[1]);
        const payload = (await body()) ?? {};
        const target = String(payload.provider ?? '').trim();
        const dry = url.searchParams.get('dry') === '1';

        if (dry) {
          const used = await usageOf(workspace);
          return send(res, 200, {
            ok: true, dry: true, workspace, target,
            provider: ops.provider(workspace), available: ops.available,
            objects: used.records, bytes: used.bytes,
          });
        }

        // Copy, READ BACK AND COMPARE, flip the provider row, and only then delete
        // the old copies. Deleting first is how a migration loses a customer's
        // data when the copy was silently truncated — the order lives in
        // `storage.js`, where no route can skip it.
        const moved = await ops.migrate(workspace, target);
        if (!moved.ok) {
          return send(res, moved.status, {
            ok: false,
            workspace,
            provider: ops.provider(workspace),
            available: ops.available,
            objects: moved.objects,
            bytes: moved.bytes,
            error: moved.reason,
          });
        }
        return send(res, 200, {
          ok: true,
          workspace,
          provider: moved.provider,
          moved: moved.moved,
          objects: moved.objects,
          bytes: moved.bytes,
          leftBehind: moved.leftBehind ?? [],
        });
      }

      if (path === '/v1/admin/usage' && method === 'GET') {
        const spaces = new Map();
        for (const row of db.prepare('SELECT DISTINCT workspace FROM records').all()) spaces.set(row.workspace, true);
        // A workspace on a bucket has no rows in this database, so the provider
        // table is the only complete list of who exists.
        for (const row of db.prepare('SELECT workspace FROM workspace_storage').all()) spaces.set(row.workspace, true);
        for (const workspace of traffic.keys()) spaces.set(workspace, true);

        const emails = new Map(
          db.prepare('SELECT id, email FROM accounts').all().map((row) => [`acct:${row.id}`, row.email]),
        );

        const perCustomer = (await Promise.all([...spaces.keys()].map(async (workspace) => {
          const provider = ops.provider(workspace);
          let used = { records: 0, bytes: 0 };
          let reachable = true;
          try {
            used = await ops.usage(workspace);
          } catch (err) {
            if (!err?.unavailable) throw err;
            reachable = false;
          }
          const moved = traffic.get(workspace) ?? { inBytes: 0, outBytes: 0, requests: 0 };
          // How many projects a workspace holds. Read through the store, not the
          // raw column: the stored value is sealed, so parsing it directly always
          // said "0 projects".
          let projects = 0;
          try {
            const value = await ops.get(workspace, DEFAULT_SCOPE, 'projects');
            projects = Array.isArray(value) ? value.length : 0;
          } catch {
            projects = 0;
          }
          return {
            workspace,
            provider,
            reachable,
            email: emails.get(workspace) ?? null,
            records: used.records,
            bytes: used.bytes,
            projects,
            requests: moved.requests,
            inBytes: moved.inBytes,
            outBytes: moved.outBytes,
          };
        }))).sort((a, b) => (b.bytes + b.inBytes + b.outBytes) - (a.bytes + a.inBytes + a.outBytes));

        const total = perCustomer.reduce((sum, entry) => ({
          records: sum.records + entry.records,
          bytes: sum.bytes + entry.bytes,
          projects: sum.projects + entry.projects,
          requests: sum.requests + entry.requests,
          inBytes: sum.inBytes + entry.inBytes,
          outBytes: sum.outBytes + entry.outBytes,
        }), { records: 0, bytes: 0, projects: 0, requests: 0, inBytes: 0, outBytes: 0 });

        return send(res, 200, {
          ok: true, total, customers: perCustomer, providers: ops.available, since: new Date(now()).toISOString(),
        });
      }

      if (path === '/v1/admin/status' && method === 'GET') {
        const count = (sql) => Number(db.prepare(sql).get().n ?? 0);
        return send(res, 200, {
          ok: true,
          version: VERSION,
          mode: licence.mode ?? 'cloud',
          licence: licence.licence ?? null,
          installation: installKey,
          payments: {
            provider: payments.provider,
            // A provider with no webhook secret takes money it cannot honour:
            // the panel should say so rather than let it be discovered later.
            webhookConfigured: Boolean(payments.webhookSecret),
            publicUrl: payments.publicUrl,
            lastWebhook: webhookState(),
          },
          counts: {
            accounts: count('SELECT COUNT(*) AS n FROM accounts'),
            orders: count('SELECT COUNT(*) AS n FROM orders'),
            pending: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
            licences: count('SELECT COUNT(*) AS n FROM licences'),
          },
        });
      }

      if (path === '/v1/admin/orders' && method === 'GET') {
        return send(res, 200, { ok: true, orders: people.allOrders() });
      }
      if (path === '/v1/admin/products' && method === 'GET') {
        return send(res, 200, { ok: true, products: catalogue.all(), payments: payments.provider });
      }
      if (path === '/v1/admin/products' && method === 'POST') {
        const answer = catalogue.save((await body()) ?? {});
        if (answer.status !== 'ok') return send(res, 400, { error: 'a code and a label are needed' });
        return send(res, 200, { ok: true, product: answer.product });
      }

      const priceRoute = /^\/v1\/admin\/products\/([^/]+)\/price$/.exec(path);
      if (priceRoute && method === 'POST') {
        const payload = (await body()) ?? {};
        const product = catalogue.setPrice(decodeURIComponent(priceRoute[1]), payload);
        if (!product) return send(res, 400, { error: 'a currency and an amount are needed' });
        return send(res, 200, { ok: true, product });
      }

      const stripeProduct = /^\/v1\/admin\/products\/([^/]+)\/stripe$/.exec(path);
      if (stripeProduct && method === 'POST') {
        const product = catalogue.get(decodeURIComponent(stripeProduct[1]));
        if (!product) return send(res, 404, { error: 'no such product' });
        const created = await createStripePrice(payments, product, { fetch: fetchJson });
        if (created.status === 'unconfigured') return send(res, 503, { error: 'no payment provider configured' });
        if (created.status !== 'ok') return send(res, 502, { error: created.reason ?? 'stripe refused' });
        const saved = catalogue.setStripe(product.id, created);
        return send(res, 200, { ok: true, product: saved });
      }

      const activeProduct = /^\/v1\/admin\/products\/([^/]+)\/active$/.exec(path);
      if (activeProduct && method === 'POST') {
        const payload = (await body()) ?? {};
        const product = catalogue.setActive(decodeURIComponent(activeProduct[1]), payload.active !== false);
        if (!product) return send(res, 404, { error: 'no such product' });
        return send(res, 200, { ok: true, product });
      }

      const revoke = /^\/v1\/admin\/licenses\/([^/]+)\/revoke$/.exec(path);
      if (revoke && method === 'POST') {
        const licence2 = catalogue.revokeLicence(decodeURIComponent(revoke[1]));
        if (!licence2) return send(res, 404, { error: 'no such licence' });
        return send(res, 200, { ok: true, licence: licence2 });
      }

      if (path === '/v1/admin/licenses' && method === 'GET') {
        return send(res, 200, { ok: true, licences: catalogue.allLicences() });
      }

      if (path === '/v1/admin/accounts' && method === 'GET') {
        return send(res, 200, { ok: true, accounts: people.allAccounts(), payments: { provider: payments.provider } });
      }

      const paid = /^\/v1\/admin\/orders\/([^/]+)\/paid$/.exec(path);
      if (paid && method === 'POST') {
        const order = people.order(decodeURIComponent(paid[1]));
        if (!order) return send(res, 404, { error: 'no such order' });
        const payload = (await body()) ?? {};
        const days = Number(payload.days ?? payments.planDays);
        people.setOrderStatus(order.id, 'paid');
        const account = people.setPlan(order.accountId, order.plan, {
          days: Number.isFinite(days) && days > 0 ? days : payments.planDays, now: now(),
        });
        if (!account) return send(res, 404, { error: 'the order has no live account' });
        return send(res, 200, { ok: true, order: people.order(order.id), account });
      }

      const plan = /^\/v1\/admin\/accounts\/([^/]+)\/plan$/.exec(path);
      if (plan && method === 'POST') {
        const payload = (await body()) ?? {};
        const account = people.setPlan(decodeURIComponent(plan[1]), payload.plan ?? 'cloud', {
          days: Number(payload.days ?? payments.planDays), now: now(),
        });
        if (!account) return send(res, 400, { error: 'no such account, or an unknown plan' });
        return send(res, 200, { ok: true, account });
      }

      const accountPath = /^\/v1\/admin\/accounts\/([^/]+)$/.exec(path);
      if (accountPath && method === 'DELETE') {
        const id = decodeURIComponent(accountPath[1]);
        const workspace = accountWorkspace(id);
        if (!people.deleteAccount(id)) return send(res, 404, { error: 'no such account' });
        db.prepare('DELETE FROM records WHERE workspace = ?').run(workspace);
        // A workspace on a bucket has nothing in `records`; its objects go too, so
        // an erasure is an erasure and not just an unreadable bucket prefix.
        const purged = await ops.erase(workspace);
        db.prepare('DELETE FROM workspaces WHERE workspace = ?').run(workspace);
        return send(res, 200, { ok: true, deleted: true, objectsRemoved: purged.removed, storageUnreachable: purged.unreachable });
      }

      return send(res, 404, { error: 'not found' });
    }
    return false;
  }

    if (path === '/v1/sessions' && method === 'DELETE') {
      people.logout(who.token);
      return send(res, 200, { ok: true });
    }


    if (path === '/v1/account') {
      if (method === 'GET') {
        return send(res, 200, {
          ok: true,
          workspace: who.workspace,
          plan: who.plan,
          expiresAt: who.expiresAt,
          entitled: who.entitled,
          account: who.account,
          licences: who.account ? catalogue.licences(who.account.id) : [],
          usage: await usageOf(who.workspace),
        });
      }
      // Leaving: the account, its sessions, its orders, its records and the
      // wrapped key all go. Without the key the rows are unreadable, which is
      // what makes this an erasure rather than a flag.
      if (method === 'DELETE') {
        if (!who.account) return send(res, 409, { error: 'an installer token has no account' });
        const workspace = who.workspace;
        people.deleteAccount(who.account.id);
        db.prepare('DELETE FROM records WHERE workspace = ?').run(workspace);
        const purged = await ops.erase(workspace);
        db.prepare('DELETE FROM workspaces WHERE workspace = ?').run(workspace);
        return send(res, 200, {
          ok: true, deleted: true, objectsRemoved: purged.removed, storageUnreachable: purged.unreachable,
        });
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    // Online activation (#148): a self-hosted install with an account token asks
    // the service for a key bound to its own fingerprint.
    if (path === '/v1/licence/activate' && method === 'POST') {
      if (!who.account) return send(res, 409, { error: 'activation belongs to an account, not an installer token' });
      if (!licencePrivate) return send(res, 503, { error: 'this service cannot sign licences' });
      const payload = (await body()) ?? {};
      const fingerprint = String(payload.fingerprint ?? '').trim();
      if (!isInstallKey(fingerprint)) return send(res, 400, { error: 'that is not an installation key (FHI-XXXX-XXXX-XXXX-XXXX)' });

      const owned = catalogue.licences(who.account.id).filter((entry) => !entry.revoked);
      if (!owned.length) return send(res, 402, { error: 'no licence to activate — buy one first' });
      const source = owned[0];
      const key = signLicence(licencePayload({
        subject: who.account.email,
        plan: 'selfhosted',
        fingerprint,
        issuedAt: new Date(now()).toISOString(),
        expiresAt: source.expiresAt,
      }), licencePrivate);
      const bound = catalogue.bindLicence(source.id, fingerprint, key);
      return send(res, 200, { ok: true, licence: key, expiresAt: source.expiresAt, fingerprint, record: bound });
    }

    // Deactivation, both halves. An **account** asks for a release code for the
    // installation it names; an **installer/basic** caller spends that code and
    // forgets its licence. A customer cannot mint the code, so a copied key can
    // not walk away from its server.
    if (path === '/v1/licence/deactivate' && method === 'POST') {
      const payload = (await body()) ?? {};

      if (who.account) {
        if (!licencePrivate) return send(res, 503, { error: 'this service cannot sign licences' });
        const challenge = readChallenge(payload.challenge);
        if (!challenge) return send(res, 400, { error: 'that is not a deactivation challenge' });
        const owned = catalogue.licenceForFingerprint(challenge.fp);
        if (!owned || owned.accountId !== who.account.id) {
          return send(res, 404, { error: 'no licence of yours is bound to that installation' });
        }
        const released = catalogue.deactivateLicence(owned.id);
        return send(res, 200, {
          ok: true,
          code: signDeactivation({ fingerprint: challenge.fp, nonce: challenge.nonce }, licencePrivate, { now: now() }),
          licence: released,
        });
      }

      // The installation's own side: one pending challenge at a time, because a
      // server is released once and then re-licensed.
      const nonce = pendingChallenge();
      if (!nonce) return send(res, 409, { error: 'ask for a challenge first' });
      const checked = verifyDeactivation(String(payload.code ?? ''), {
        publicKey: publicKeyOf({ FYRHAVEN_LICENCE_PUBLIC: licencePublic }),
        fingerprint: installKey, nonce, now: now(),
      });
      if (!checked.ok) return send(res, 400, { error: `the deactivation code was not accepted (${checked.reason})` });
      setChallenge('');
      process.env.FYRHAVEN_LICENCE = '';
      try {
        const { rmSync } = await import('node:fs');
        rmSync(process.env.FYRHAVEN_LICENCE_FILE ?? '/data/licence.key', { force: true });
      } catch {
        // nothing cached
      }
      return send(res, 200, { ok: true, deactivated: true, note: 'restart to run unlicensed, or paste a new key' });
    }

    if (path === '/v1/licence' && method === 'POST') {
      const payload = (await body()) ?? {};
      const key = String(payload.licence ?? '').trim();
      const check = verifyLicence(key, {
        publicKey: publicKeyOf({ FYRHAVEN_LICENCE_PUBLIC: licencePublic }),
        fingerprint: installKey, now: now(),
      });
      if (!check.ok) return send(res, 400, { error: `that licence was not accepted (${check.reason})` });
      process.env.FYRHAVEN_LICENCE = key;
      let stored = false;
      try {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(process.env.FYRHAVEN_LICENCE_FILE ?? '/data/licence.key', `${key}\n`, { mode: 0o600 });
        stored = true;
      } catch {
        // an unwritable volume still runs with the key in memory
      }
      return send(res, 200, {
        ok: true, stored, fingerprint: installKey,
        licence: check.payload, summary: describeLicence(check.payload), daysLeft: check.daysLeft,
      });
    }

    if (path === '/v1/licence/challenge' && method === 'POST') {
      const challenge = deactivationChallenge(installKey, { now: now() });
      const read = readChallenge(challenge);
      setChallenge(read?.nonce ?? '');
      return send(res, 200, { ok: true, fingerprint: installKey, challenge });
    }

    if (path === '/v1/licence') {
      if (method !== 'GET') return send(res, 405, { error: 'method not allowed' });
      return send(res, 200, {
        ok: true,
        mode: licence.mode ?? 'cloud',
        fingerprint: installKey,
        licensed: Boolean(licence.licence),
        licence: licence.licence ?? null,
        summary: describeLicence(licence.licence ?? null),
      });
    }

    if (path === '/v1/account/order') {
      if (method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      if (!who.account) return send(res, 409, { error: 'an installer token has no account' });
      const payload = (await body()) ?? {};
      // A product says what is being sold; without one the old `plan` shape is
      // still accepted, so the plugin's existing call keeps working.
      const product = payload.productId || payload.product
        ? catalogue.get(payload.productId ?? payload.product)
        : null;
      if ((payload.productId || payload.product) && !product) return send(res, 404, { error: 'no such product' });
      const order = people.placeOrder(who.account.id, product ? 'cloud' : (payload.plan ?? 'cloud'), {
        productId: product?.id ?? '', now: now(),
      });

      // With a provider configured the customer is sent to pay; without one the
      // order is a request an operator settles by hand. Neither is a lie, and
      // the client is told which it got.
      // The currency decides WHICH Stripe price is used: never convert, always
      // use the price the operator set for that currency.
      let priceId = product?.stripePriceId ?? '';
      const wanted = String(payload.currency ?? '').toUpperCase().slice(0, 3);
      if (product && wanted) {
        const chosen = catalogue.pricesFor(catalogue.row(product.id))
          .find((price) => price.currency === wanted);
        if (!chosen) return send(res, 400, { error: `no price in ${wanted} for that product` });
        priceId = chosen.stripePriceId;
      }

      const checkout = await createCheckout(payments, {
        order, account: who.account, fetch: fetchJson,
        priceId,
        mode: product && product.interval === 'once' ? 'payment' : (product ? 'subscription' : ''),
      });
      return send(res, 202, {
        ok: true,
        order,
        payment: checkout.status === 'ok'
          ? { status: 'redirect', url: checkout.url, sessionId: checkout.id }
          : { status: checkout.status === 'unconfigured' ? 'unavailable' : 'failed', reason: checkout.reason },
        note: checkout.status === 'ok' ? 'pay on the provider page to switch the plan on' : 'pending — an invoice follows',
      });
    }

  return false;
}
