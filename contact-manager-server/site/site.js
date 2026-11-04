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
  for (const name of ['intro', 'signup', 'login', 'account']) {
    const section = $(`#${name}`);
    if (section) section.hidden = name !== view;
  }
  document.querySelector('[data-view="signup"]').hidden = signedIn;
  document.querySelector('[data-view="login"]').hidden = signedIn;
  document.querySelector('[data-view="account"]').hidden = !signedIn;
  document.querySelector('[data-view="signout"]').hidden = !signedIn;
  if (view !== 'account') $('#token').hidden = true;
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
      try {
        const answer = await call('/v1/account/order', { method: 'POST', body: { plan: 'cloud' } });
        const note = $('#order-note');
        note.hidden = false;
        note.textContent = `Order ${answer.order.id} is ${answer.order.status}. An invoice follows — the plan is switched on when it is paid.`;
      } catch (err) {
        status(String(err.message ?? err), true);
      }
      return;
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

// Opening the page with a session goes straight to the account; without one it
// stays on the landing panel, which is what a stranger should see.
if (token()) void loadAccount();
else show('intro');
