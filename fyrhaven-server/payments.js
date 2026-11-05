// Payments (#148, the money half): one order, one checkout, one webhook.
//
// Deliberately **provider-shaped, not provider-locked**: the store knows how to
// ask a provider for a checkout URL and how to verify that a webhook really came
// from it, and today there is exactly one adapter — Stripe's REST API called with
// `fetch`, so there is no SDK and no lockfile. With no key configured the store
// takes no money at all and an order stays `pending`, which an operator settles
// by hand from the admin panel. That is the honest state: the code cannot sell
// anything it has no account for.
//
// Nothing here holds a card: the customer pays on the provider's page, and this
// service only ever sees "this session was paid" and the metadata it put there.
//
// The webhook signature is Stripe's scheme, implemented with `node:crypto`:
//   Stripe-Signature: t=<unix>,v1=<hmac-sha256("<t>.<raw body>", secret)>
// compared in constant time, inside a tolerance window so a captured request
// cannot be replayed a day later.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a paid order buys, in days. `STRIPE_PLAN_DAYS` overrides. */
export const DEFAULT_PLAN_DAYS = 365;

/** Webhooks older than this are refused, in seconds. */
export const SIGNATURE_TOLERANCE = 300;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * What the environment says about payments.
 *
 * `provider` is `'stripe'` only when a secret key **and** a price are present —
 * half a configuration is not configured, because a checkout with no price would
 * fail at the customer instead of here.
 */
export function paymentConfig(env = process.env) {
  const secretKey = text(env.STRIPE_SECRET_KEY);
  // The fallback price is optional now that a catalogue product carries its own
  // `stripe_price`. Gating the provider on it meant a shop with real prices and a
  // secret key still said "no payments configured" — which is exactly what
  // happened: orders came back `unavailable` and the site never redirected.
  const priceId = text(env.STRIPE_PRICE_CLOUD);
  const webhookSecret = text(env.STRIPE_WEBHOOK_SECRET);
  const publicUrl = text(env.PUBLIC_URL).replace(/\/+$/, '');
  const planDays = Number(env.STRIPE_PLAN_DAYS ?? DEFAULT_PLAN_DAYS);
  const mode = text(env.STRIPE_MODE) === 'subscription' ? 'subscription' : 'payment';
  return {
    provider: secretKey ? 'stripe' : 'none',
    secretKey,
    priceId,
    webhookSecret,
    publicUrl,
    planDays: Number.isFinite(planDays) && planDays > 0 ? planDays : DEFAULT_PLAN_DAYS,
    mode,
  };
}

/** Whether a customer could pay right now. */
export const paymentsAvailable = (config) => config.provider === 'stripe' && Boolean(config.publicUrl);

/**
 * Asks Stripe for a Checkout Session and returns where to send the customer.
 *
 * `fetch` is injected so a test can drive the whole path without a network or a
 * key — the same reason every other optional call in this repository is a seam.
 *
 * @returns {Promise<{status: 'ok'|'unconfigured'|'failed', url?: string, id?: string, reason?: string}>}
 */
export async function createCheckout(config, { order, account, priceId = '', mode = '', fetch = globalThis.fetch } = {}) {
  if (!paymentsAvailable(config)) return { status: 'unconfigured' };
  if (!order?.id || !account?.id) return { status: 'failed', reason: 'an order and an account are needed' };
  // A catalogue price wins over the single configured one: the product says what
  // is being sold, and the operator may sell several things.
  const price = priceId || config.priceId;
  if (!price) return { status: 'unconfigured' };

  const form = new URLSearchParams();
  form.set('mode', mode || config.mode);
  form.set('line_items[0][price]', price);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', `${config.publicUrl}/?paid=1`);
  form.set('cancel_url', `${config.publicUrl}/?paid=0`);
  form.set('customer_email', account.email);
  form.set('client_reference_id', account.id);
  // The webhook learns what to switch on from here — never from a request body
  // a customer can edit.
  form.set('metadata[accountId]', account.id);
  form.set('metadata[orderId]', order.id);
  form.set('metadata[plan]', order.plan ?? 'cloud');

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { status: 'failed', reason: payload?.error?.message ?? `HTTP ${response.status}` };
    }
    if (!text(payload?.url)) return { status: 'failed', reason: 'no checkout url in the answer' };
    return { status: 'ok', url: payload.url, id: text(payload.id) };
  } catch (err) {
    return { status: 'failed', reason: String(err?.message ?? err) };
  }
}

/**
 * Verifies `Stripe-Signature` against the **raw** body.
 *
 * The body must be the bytes that arrived, not `JSON.stringify` of the parsed
 * object: a re-serialised body has different bytes and a valid signature would
 * be rejected.
 */
export function verifyStripeSignature({ header, payload, secret, now = Date.now(), tolerance = SIGNATURE_TOLERANCE } = {}) {
  if (!secret || !header || typeof payload !== 'string') return false;
  const parts = String(header).split(',').reduce((all, part) => {
    const [key, value] = part.split('=');
    if (key && value) (all[key.trim()] ??= []).push(value.trim());
    return all;
  }, {});
  const stamp = Number(parts.t?.[0]);
  if (!Number.isFinite(stamp)) return false;
  if (Math.abs(now / 1000 - stamp) > tolerance) return false;
  const expected = createHmac('sha256', secret).update(`${stamp}.${payload}`).digest();
  return (parts.v1 ?? []).some((candidate) => {
    const given = Buffer.from(candidate, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/**
 * What a paid event means for an account — or null when it means nothing to us.
 *
 * Only `checkout.session.completed` (and a subscription's `invoice.paid`) switch
 * a plan on, and only from metadata this service put there.
 */
export function planFromEvent(event) {
  const type = text(event?.type);
  if (!type) return null;
  const object = event?.data?.object ?? {};
  if (type === 'checkout.session.completed') {
    const accountId = text(object.metadata?.accountId);
    if (!accountId) return null;
    return { accountId, orderId: text(object.metadata?.orderId), plan: text(object.metadata?.plan) || 'cloud' };
  }
  if (type === 'invoice.paid') {
    const accountId = text(object.subscription_details?.metadata?.accountId ?? object.metadata?.accountId);
    if (!accountId) return null;
    return { accountId, orderId: text(object.metadata?.orderId), plan: 'cloud' };
  }
  return null;
}


/**
 * Creates the Stripe product and price a catalogue entry needs.
 *
 * Called from the admin panel, so a price is never typed twice and can never
 * drift from what the store charges. Recurring intervals become a monthly/yearly
 * price; a one-off (`once`) becomes a single payment.
 *
 * @returns {Promise<{status: 'ok'|'unconfigured'|'failed', productId?: string, priceId?: string, reason?: string}>}
 */
export async function createStripePrice(config, product, { fetch = globalThis.fetch } = {}) {
  if (config.provider !== 'stripe') return { status: 'unconfigured' };
  if (!product?.label || !Number.isFinite(product.amount)) return { status: 'failed', reason: 'a label and an amount are needed' };

  const post = async (path, form) => {
    const response = await fetch(`https://api.stripe.com${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
    return payload;
  };

  try {
    const created = await post('/v1/products', new URLSearchParams({
      name: product.label,
      ...(product.description ? { description: product.description } : {}),
    }));
    const priceForm = new URLSearchParams({
      product: created.id,
      unit_amount: String(product.amount),
      currency: String(product.currency || 'eur').toLowerCase(),
    });
    if (product.interval === 'month' || product.interval === 'year') {
      priceForm.set('recurring[interval]', product.interval);
    }
    const price = await post('/v1/prices', priceForm);
    return { status: 'ok', productId: created.id, priceId: price.id };
  } catch (err) {
    return { status: 'failed', reason: String(err?.message ?? err) };
  }
}
