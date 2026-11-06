// The site's behaviour (#148). No framework, no build step: it runs in the same
// container it talks to, so anything clever here is one more thing to keep alive.
//
// The session token lives in `localStorage` on **this origin** — the store's own
// origin, never the webmail's. It is the same credential the plugin holds (the
// host keeps that one), so the two never share storage.

const $ = (selector) => document.querySelector(selector);
const status = (message, isError = false) => {
  const line = $('#status');
  line.textContent = message;
  line.className = isError ? 'status error' : 'status';
};

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'onclick') node.addEventListener('click', value);
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
};

const TOKEN_KEY = 'cm-session';

const token = () => localStorage.getItem(TOKEN_KEY) ?? '';
const setToken = (value) => {
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
};

/** One call to the API, with the session attached when there is one. */
async function call(path, { method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token()) headers.authorization = `Bearer ${token()}`;
  const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error((payload && payload.error) || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

/** Which panel is visible. `signout` is an action, not a panel. */
function show(view) {
  const signedIn = Boolean(token());
  for (const name of ['intro', 'signup', 'login', 'account', 'selfhosted']) {
    const section = $(`#${name}`);
    if (section) section.hidden = name !== view;
  }
  document.querySelector('[data-view="signup"]').hidden = signedIn;
  document.querySelector('[data-view="login"]').hidden = signedIn;
  document.querySelector('[data-view="account"]').hidden = !signedIn;
  document.querySelector('[data-view="signout"]').hidden = !signedIn;
  if (view !== 'account') $('#token').hidden = true;
  const selfhosted = $('#selfhosted');
  if (selfhosted) selfhosted.hidden = view !== 'account';

  // A customer who is signed in wants their own state first and the price list
  // second: the sections are reordered rather than the page scrolled, so nobody
  // has to travel past the shop to find their account.
  const pricing = $('#pricing');
  const account = $('#account');
  if (pricing && account) {
    if (view === 'account') {
      pricing.before(account);
      if (selfhosted) pricing.before(selfhosted);
    } else {
      // back to the order the document is written in; both calls are no-ops when
      // it is already correct
      pricing.after(account);
      if (selfhosted) account.after(selfhosted);
    }
  }
}

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};

/**
 * The line above the account details. Two states a customer actually meets: a
 * trial that is running (say when it ends) and access that has ended (say that
 * nothing was deleted, which is the first thing anyone worries about).
 */
function showAccountNote(answer) {
  const note = $('#account-note');
  if (!note) return;
  const entitled = answer.entitled !== false;
  if (!entitled) {
    note.className = 'notice notice--warn';
    note.textContent = 'Your access has ended, so the plugin can read but not write. Nothing has been deleted — ordering again turns writing back on.';
    note.hidden = false;
    return;
  }
  if (answer.plan === 'trial') {
    note.className = 'notice';
    note.textContent = `Trial — everything is on until ${formatDate(answer.expiresAt)}. No card was taken; order whenever you are ready.`;
    note.hidden = false;
    return;
  }
  note.hidden = true;
}

/** The account panel: plan, expiry, usage. */
async function loadAccount() {
  try {
    const answer = await call('/v1/account');
    $('[data-field="email"]').textContent = answer.account?.email ?? 'installer token';
    $('[data-field="plan"]').textContent = answer.plan === 'installer'
      ? 'installer token'
      : `${answer.plan}${answer.entitled ? '' : ' — expired, read-only'}`;
    $('[data-field="expires"]').textContent = formatDate(answer.expiresAt);
    $('[data-field="usage"]').textContent = `${answer.usage.records} of ${answer.usage.maxRecords} records`;
    showAccountNote(answer);
    show('account');
    await loadLicences();
  } catch (err) {
    if (err.status === 401) {
      setToken('');
      show('login');
      status('Your session ended. Sign in again.', true);
      return;
    }
    status(String(err.message ?? err), true);
  }
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', async () => {
    const view = button.dataset.view;
    status('');
    if (view === 'signout') {
      try {
        await call('/v1/sessions', { method: 'DELETE' });
      } catch {
        // the local token is what matters
      }
      setToken('');
      show('login');
      void loadProducts();
      status('Signed out.');
      return;
    }
    if (view === 'account') return loadAccount();
    return show(view);
  });
});

document.querySelectorAll('form[data-form]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const which = form.dataset.form;
    const data = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status(which === 'signup' ? 'Creating your account…' : 'Signing in…');
    try {
      const answer = await call(which === 'signup' ? '/v1/accounts' : '/v1/sessions', {
        method: 'POST',
        body: { email: data.get('email'), password: data.get('password') },
      });
      setToken(answer.token);
      form.reset();
      void loadProducts();
      status('');
      await loadAccount();
    } catch (err) {
      status(String(err.message ?? err), true);
    } finally {
      submit.disabled = false;
    }
  });
});

const products = { list: [] };

// Declared before the first read. `chosenCurrency()` used to be declared *below*
// the `currency` select, so the module threw "Cannot access 'chosenCurrency'
// before initialization" during setup and **nothing after that line ran** — which
// is why the shop never showed a single price.
const currencyKey = 'cm-currency';
const chosenCurrency = () => (localStorage.getItem(currencyKey) ?? 'EUR').toUpperCase();

const currencySelect = document.getElementById('currency');
if (currencySelect) {
  currencySelect.value = chosenCurrency();
  currencySelect.addEventListener('change', () => {
    localStorage.setItem(currencyKey, currencySelect.value);
    void loadProducts();
  });
}

/** One price row from a product, in the chosen currency, falling back to its base. */
const priceOf = (product, currency) => {
  const prices = product?.prices ?? [];
  return prices.find((entry) => entry.currency === currency) ?? prices[0] ?? null;
};
const perLabel = (product) => (product.interval === 'once' ? 'one-off' : `per ${product.interval}`);

/** How many months a yearly price saves — computed, so it cannot go stale. */
function monthsFree(monthly, yearly) {
  if (!monthly?.amount || !yearly?.amount) return 0;
  return Math.max(0, Math.round((monthly.amount * 12 - yearly.amount) / monthly.amount));
}

/** One pricing tier. Everything it shows is an argument, so the copy stays in one place. */
function tier({ title, price, unit, badge, recommended = false, features = [], note, actions = [] }) {
  const children = [];
  if (badge) children.push(el('span', { class: 'tier__badge', text: badge }));
  children.push(el('h3', { class: 'tier__title', text: title }));
  children.push(el('p', { class: 'tier__price', text: price }));
  if (unit) children.push(el('p', { class: 'tier__unit muted', text: unit }));
  if (features.length) {
    children.push(el('ul', { class: 'tier__list' }, ...features.map((text) => el('li', { text }))));
  }
  if (note) children.push(el('p', { class: 'tier__note muted', text: note }));
  if (actions.length) children.push(el('div', { class: 'tier__actions' }, ...actions));
  return el('div', { class: `tier${recommended ? ' tier--recommended' : ''}` }, ...children);
}

/**
 * The shop window: three tiers, the cloud one recommended, the yearly price
 * marked as the cheaper way to buy it. Prices come from the catalogue rather
 * than from this file, so a price change is one edit in the panel.
 */
async function loadProducts() {
  const box = $('#products');
  if (!box) return;
  try {
    const answer = await call('/v1/products');
    products.list = answer.products ?? [];
    const currency = chosenCurrency();
    box.replaceChildren();

    if (!products.list.length) {
      box.append(el('p', { class: 'notice' },
        el('strong', { text: 'Nothing is for sale right now. ' }),
        el('span', { text: 'Prices are being updated — everything the free plugin does keeps working.' })));
      return;
    }

    const subscriptions = products.list.filter((product) => product.kind === 'subscription');
    const monthly = subscriptions.find((product) => product.interval === 'month') ?? null;
    const yearly = subscriptions.find((product) => product.interval === 'year') ?? null;
    const licence = products.list.find((product) => product.kind === 'license') ?? null;
    const free = monthsFree(priceOf(monthly, currency), priceOf(yearly, currency));

    box.append(tier({
      title: 'Plugin only',
      price: 'Free',
      unit: 'no account, no server',
      features: [
        'Find and merge duplicate contacts',
        'Bulk edit, export, health and history',
        'Nothing to sign up for',
      ],
      note: 'Works with the records the webmail already keeps.',
    }));

    const cloudActions = [];
    if (monthly) {
      // The button says what it will actually do for this visitor: a signed-in
      // customer already has a trial, so offering them one is a dead end.
      const signedIn = Boolean(token());
      cloudActions.push(el('button', {
        type: 'button',
        class: 'primary',
        text: signedIn ? 'Order the cloud plan' : 'Start the free trial',
        onclick: () => (signedIn ? order(productId(monthly), currency) : show('signup')),
      }));
    }
    if (yearly) {
      const label = priceOf(yearly, currency)?.label ?? yearly.price;
      cloudActions.push(el('button', {
        type: 'button',
        class: 'quiet',
        text: `Yearly — ${label} ${perLabel(yearly)}${free ? `, save ${free} months` : ''}`,
        onclick: () => order(productId(yearly), currency),
      }));
    }
    box.append(tier({
      title: 'Cloud',
      badge: 'Recommended',
      recommended: true,
      price: priceOf(monthly, currency)?.label ?? monthly?.price ?? '—',
      unit: monthly ? `${perLabel(monthly)} · includes 25% VAT` : '',
      features: [
        'Projects, private notes, consent records',
        'Follows you between devices',
        'Shared with everyone who can open the account',
        'Updates included',
      ],
      note: free ? `Yearly is ${free} months cheaper than monthly.` : '',
      actions: cloudActions,
    }));

    if (licence) {
      box.append(tier({
        title: 'Self-hosted',
        price: priceOf(licence, currency)?.label ?? licence.price,
        unit: 'one-off · 12 months of updates',
        features: [
          'Runs on a machine you control',
          'The same records as the cloud tier',
          'Bound to one installation',
          'Move it with a release code',
        ],
        note: 'Renews separately after the first year.',
        actions: [el('button', {
          type: 'button',
          text: 'Buy the licence',
          onclick: () => order(productId(licence), currency),
        })],
      }));
    }
  } catch (err) {
    // An empty shop box looks like "nothing to sell"; say what actually happened.
    box.replaceChildren(el('p', { class: 'notice notice--warn' },
      el('strong', { text: 'Prices did not load. ' }),
      el('span', { text: `${err.message ?? err} — the shop needs the API to answer. ` }),
      el('button', { type: 'button', class: 'quiet', text: 'Try again', onclick: () => loadProducts() })));
  }
}

const productId = (product) => product.id;

/** Orders one product; the payment status decides what the customer is told. */
async function order(id, currency) {
  if (!token()) {
    show('signup');
    status('Create an account first — the order belongs to it.');
    return;
  }
  try {
    const answer = await call('/v1/account/order', { method: 'POST', body: { productId: id, currency: currency ?? chosenCurrency() } });
    if (answer.payment.status === 'redirect' && answer.payment.url) {
      window.location.href = answer.payment.url;
      return;
    }
    const note = $('#order-note');
    note.hidden = false;
    note.textContent = `Order ${answer.order.id} is ${answer.order.status}. An invoice follows — the plan is switched on when it is paid.`;
    show('account');
    await loadAccount();
  } catch (err) {
    status(String(err.message ?? err), true);
  }
}

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const action = button.dataset.action;
    if (action === 'token') {
      const box = $('#token');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        box.textContent = `${token()}\n\nUse this in the plugin’s Dedicated server dialog when it asks for the token.\nIt ends in 30 days, and signing in again replaces it.`;
      }
      return;
    }
    if (action === 'order') {
      const first = products.list.find((entry) => entry.kind === 'subscription') ?? products.list[0];
      if (!first) return status('Nothing is for sale right now.', true);
      return order(first.id, chosenCurrency());
    }
    if (action === 'delete') {
      const sure = window.confirm('Delete your account, its sessions and every record in it? This cannot be undone.');
      if (!sure) return;
      try {
        await call('/v1/account', { method: 'DELETE' });
        setToken('');
        show('signup');
        status('Account deleted. Every record in it is gone.');
      } catch (err) {
        status(String(err.message ?? err), true);
      }
    }
  });
});


/**
 * Self-hosted licences (#148): bind a licence to an installation, and release an
 * installation so the licence can move. Both are the *account's* actions, so they
 * need a signed-in session — the token is the proof of who is asking.
 */
const showBlock = (id, text) => {
  const box = $(id);
  box.hidden = !text;
  box.textContent = text;
  // the answer's wrapper appears with it, so a step never shows an empty box
  if (id === '#licence-key') $('#licence-block').hidden = !text;
  if (id === '#release-code') $('#release-block').hidden = !text;
};

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const source = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(source.textContent.split('\n\n')[0].trim());
      status('Copied.');
    } catch {
      status('Could not copy — select the text instead.', true);
    }
  });
});

async function loadLicences() {
  try {
    const answer = await call('/v1/account');
    const box = $('#licences');
    if (!box) return;
    box.replaceChildren();
    if (!answer.licences.length) {
      box.append(el('p', { class: 'notice' },
        el('strong', { text: 'No self-hosted licence yet. ' }),
        el('span', { text: 'Paste an installation key in step 1 and the licence appears here, with the machine it is bound to.' })));
      return;
    }
    for (const licence of answer.licences) {
      // One string, built once: this card used to concatenate an element with
      // text, so a real licence rendered "[object HTMLDivElement] · not activated".
      const where = licence.revoked
        ? 'revoked'
        : licence.fingerprint ? `installed on ${licence.fingerprint}` : 'not activated yet';
      box.append(el('div', { class: 'row' },
        el('div', {},
          el('strong', { text: licence.label || 'Self-hosted licence' }),
          el('div', { class: 'muted', text: `until ${String(licence.expiresAt).slice(0, 10)} · ${where}` }))));
    }
  } catch (err) {
    status(String(err.message ?? err), true);
  }
}

function bindLicenceForms() {
  const activate = document.querySelector('[data-form="activate"]');
  const release = document.querySelector('[data-form="release"]');
  if (activate) {
    activate.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fingerprint = String(new FormData(activate).get('fingerprint') ?? '').trim().toUpperCase();
      try {
        const answer = await call('/v1/licence/activate', { method: 'POST', body: { fingerprint } });
        showBlock('#licence-key', `${answer.licence}\n\nPaste this into your server as FYRHAVEN_LICENCE (or Dedicated server → Licence → install). It is bound to ${answer.fingerprint}.`);
        status('Licence issued for that installation.');
        await loadLicences();
      } catch (err) {
        status(String(err.message ?? err), true);
      }
    });
  }
  if (release) {
    release.addEventListener('submit', async (event) => {
      event.preventDefault();
      const challenge = String(new FormData(release).get('challenge') ?? '').trim();
      try {
        const answer = await call('/v1/licence/deactivate', { method: 'POST', body: { challenge } });
        showBlock('#release-code', `${answer.code}\n\nPaste this into the old server to release it. The licence can then be activated on the new one.`);
        status('Release code issued.');
        await loadLicences();
      } catch (err) {
        status(String(err.message ?? err), true);
      }
    });
  }
}

// Opening the page with a session goes straight to the account; without one it
// stays on the landing panel, which is what a stranger should see.
bindLicenceForms();

if (token()) void loadAccount();
else show('intro');

// The shop window is public, so it loads before anything else.
void loadProducts();
