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
  document.querySelector('[data-view="account"]').hidden = !signedIn;
}

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};

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
const currencySelect = document.getElementById('currency');
if (currencySelect) {
  currencySelect.value = chosenCurrency();
  currencySelect.addEventListener('change', () => {
    localStorage.setItem(currencyKey, currencySelect.value);
    void loadProducts();
  });
}
const currencyKey = 'cm-currency';
const chosenCurrency = () => (localStorage.getItem(currencyKey) ?? 'EUR').toUpperCase();

/** The shop window: every active product with its price and a buy button. */
async function loadProducts() {
  try {
    const answer = await call('/v1/products');
    products.list = answer.products;
    const box = $('#products');
    box.replaceChildren();
    if (!answer.products.length) {
      box.append(el('p', { class: 'muted', text: 'Nothing is for sale right now.' }));
      return;
    }
    for (const product of answer.products) {
      const currency = chosenCurrency();
      const price = (product.prices || []).find((entry) => entry.currency === currency)
        ?? (product.prices || [])[0];
      const shown = price ? `${price.label} ${product.interval === 'once' ? 'one-off' : `per ${product.interval}`}` : product.price;
      box.append(el('div', { class: 'plan' },
        el('strong', { text: product.label }),
        el('div', { class: 'price', text: shown }),
        el('div', { class: 'muted', text: product.description }),
        el('button', {
          type: 'button',
          text: product.kind === 'license' ? 'Buy the licence' : 'Subscribe',
          onclick: () => order(productId(product), currency),
        })));
    }
  } catch (err) {
    status(String(err.message ?? err), true);
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
      box.append(el('p', { class: 'muted', text: 'No self-hosted licence yet.' }));
      return;
    }
    for (const licence of answer.licences) {
      box.append(el('div', { class: 'row' },
        el('div', {},
          el('strong', { text: licence.label || 'Self-hosted licence' }),
          el('div', { class: 'muted', text: `until ${licence.expiresAt.slice(0, 10)}` }
            + (licence.fingerprint ? ` · installed on ${licence.fingerprint}` : ' · not activated yet')),
          el('div', { class: 'muted', text: licence.revoked ? 'revoked' : (licence.signed ? 'signed' : '') }))));
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
