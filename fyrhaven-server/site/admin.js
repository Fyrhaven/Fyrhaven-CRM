// The operator panel (#148): orders and accounts, behind STORE_ADMIN_TOKEN.
//
// The token is held in `sessionStorage` and sent on every request — no cookie, so
// a third-party page cannot ride the operator's session, and closing the tab
// locks the panel. Every write is a deliberate click; nothing here is automatic.

const $ = (selector) => document.querySelector(selector);
const status = (message, isError = false) => {
  const line = $('#status');
  line.textContent = message;
  line.className = isError ? 'status error' : 'status';
};

const TOKEN_KEY = 'cm-admin';
const token = () => sessionStorage.getItem(TOKEN_KEY) ?? '';
const setToken = (value) => {
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
};

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'onclick') node.addEventListener('click', value);
    else if (key === 'text') node.textContent = value;
    else if (key === 'disabled') { if (value) node.disabled = true; }
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
};

const day = (value) => (value ? new Date(value).toLocaleDateString() : '—');

/** Which panel is shown, and whether the operator is unlocked at all. */
function show(name) {
  const unlocked = Boolean(token());
  $('#unlock').hidden = unlocked;
  $('#panel').hidden = !unlocked;
  document.querySelector('[data-action="signout"]').hidden = !unlocked;
  for (const panel of document.querySelectorAll('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== name;
  }
}

async function loadOrders() {
  const answer = await call('/v1/admin/orders');
  const box = $('#orders');
  box.replaceChildren();
  if (!answer.orders.length) {
    box.append(el('p', { class: 'muted', text: 'No orders yet.' }));
    return;
  }
  for (const order of answer.orders) {
    const days = el('input', { type: 'number', min: '1', value: '365', style: 'width:6em' });
    box.append(el('div', { class: 'row' },
      el('div', {},
        el('strong', { text: `${order.email || order.accountId} · ${order.plan}` }),
        el('div', { class: 'muted', text: `${order.id} · ${day(order.createdAt)} · ${order.status}` })),
      el('div', { class: 'actions' }, days,
        el('button', {
          type: 'button',
          text: 'Mark paid',
          disabled: order.status === 'paid',
          onclick: async () => {
            try {
              await call(`/v1/admin/orders/${order.id}/paid`, { method: 'POST', body: { days: Number(days.value) } });
              status(`Order ${order.id} settled for ${days.value} days.`);
              await loadOrders();
            } catch (err) {
              status(String(err.message ?? err), true);
            }
          },
        }))));
  }
}

async function loadCatalog() {
  const answer = await call('/v1/admin/products');
  const box = $('#catalog');
  box.replaceChildren();
  for (const product of answer.products) {
    box.append(el('div', { class: 'row' },
      el('div', {},
        el('strong', { text: `${product.label} · ${product.price}` }),
        el('div', {
          class: 'muted',
          text: `${product.code} · ${product.kind} · ${product.active ? 'active' : 'off'}`
            + (product.stripePriceId ? ' · Stripe price set' : ' · no Stripe price yet'),
        })),
      el('div', { class: 'actions' },
        el('button', {
          type: 'button',
          text: product.stripePriceId ? 'Recreate in Stripe' : 'Create in Stripe',
          onclick: async () => {
            try {
              status('Asking Stripe…');
              const made = await call(`/v1/admin/products/${product.id}/stripe`, { method: 'POST' });
              status(`Stripe price ${made.product.stripePriceId} created for ${product.code}.`);
              await loadCatalog();
            } catch (err) {
              status(String(err.message ?? err), true);
            }
          },
        }),
        el('button', {
          type: 'button',
          text: product.active ? 'Turn off' : 'Turn on',
          onclick: async () => {
            try {
              await call(`/v1/admin/products/${product.id}/active`, {
                method: 'POST', body: { active: !product.active },
              });
              await loadCatalog();
            } catch (err) {
              status(String(err.message ?? err), true);
            }
          },
        }))));
  }
}

async function loadAccounts() {
  const answer = await call('/v1/admin/accounts');
  $('#payments').textContent = answer.payments.provider === 'stripe'
    ? 'Card payments are live: an order sends the customer to the provider, and the webhook switches the plan on.'
    : 'No payment provider configured — orders arrive pending and are settled here.';

  const box = $('#accounts');
  box.replaceChildren();
  if (!answer.accounts.length) {
    box.append(el('p', { class: 'muted', text: 'No accounts yet.' }));
    return;
  }
  for (const account of answer.accounts) {
    const days = el('input', { type: 'number', min: '1', value: '365', style: 'width:6em' });
    box.append(el('div', { class: 'row' },
      el('div', {},
        el('strong', { text: account.email }),
        el('div', {
          class: 'muted',
          text: `${account.plan} · until ${day(account.expiresAt)}${account.overdue ? ' · expired' : ''}`,
        })),
      el('div', { class: 'actions' }, days,
        el('button', {
          type: 'button',
          text: 'Set cloud',
          onclick: async () => {
            try {
              await call(`/v1/admin/accounts/${account.id}/plan`, {
                method: 'POST', body: { plan: 'cloud', days: Number(days.value) },
              });
              status(`${account.email} is on the cloud plan.`);
              await loadAccounts();
            } catch (err) {
              status(String(err.message ?? err), true);
            }
          },
        }),
        el('button', {
          type: 'button',
          class: 'danger',
          text: 'Delete',
          onclick: async () => {
            if (!window.confirm(`Delete ${account.email}, its sessions and every record in it?`)) return;
            try {
              await call(`/v1/admin/accounts/${account.id}`, { method: 'DELETE' });
              status(`${account.email} deleted.`);
              await loadAccounts();
            } catch (err) {
              status(String(err.message ?? err), true);
            }
          },
        }))));
  }
}

document.querySelector('[data-form="unlock"]').addEventListener('submit', async (event) => {
  event.preventDefault();
  setToken(String(new FormData(event.target).get('token') ?? '').trim());
  status('');
  try {
    await loadOrders();
    show('orders');
  } catch (err) {
    setToken('');
    show('orders');
    status(err.status === 503
      ? 'The panel is disabled: STORE_ADMIN_TOKEN is not set on the server.'
      : 'That token was refused.', true);
  }
});

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', async () => {
    const tab = button.dataset.tab;
    status('');
    try {
      await (tab === 'orders' ? loadOrders() : tab === 'accounts' ? loadAccounts() : loadCatalog());
      show(tab);
    } catch (err) {
      status(String(err.message ?? err), true);
    }
  });
});

document.querySelector('[data-action="signout"]').addEventListener('click', () => {
  setToken('');
  show('orders');
  status('Locked.');
});

// A reload with a live token goes straight back to the orders.
if (token()) {
  loadOrders().then(() => show('orders')).catch(() => { setToken(''); show('orders'); });
} else {
  show('orders');
}

document.querySelector('[data-form="product"]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  try {
    await call('/v1/admin/products', {
      method: 'POST',
      body: {
        code: data.get('code'),
        label: data.get('label'),
        kind: data.get('kind'),
        interval: data.get('interval'),
        amount: Number(data.get('amount')),
        currency: data.get('currency'),
        description: data.get('description'),
      },
    });
    event.target.reset();
    status('Product saved. Create its Stripe price next.');
    await loadCatalog();
    show('catalog');
  } catch (err) {
    status(String(err.message ?? err), true);
  }
});
