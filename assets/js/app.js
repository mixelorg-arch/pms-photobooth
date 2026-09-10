/* Boot, authentication gate, navigation. */

import { APP_NAME, APP_SUB } from './config.js';
import { db } from './db.js';
import { store } from './store.js';
import { el, $, money, num, sum, fmtDate, daysFromToday } from './util.js';
import { sheet, field, button, readForm, toast, fail, confirmSheet, tag,
         stickerCluster } from './ui.js';

import dashboard from './views/dashboard.js';
import scheduling from './views/scheduling.js';
import packages from './views/packages.js';
import sales from './views/sales.js';
import inventory from './views/inventory.js';
import invoices from './views/invoices.js';
import clients from './views/clients.js';

const VIEWS = [dashboard, scheduling, packages, sales, inventory, invoices, clients];
const byId = new Map(VIEWS.map((v) => [v.id, v]));

const root = () => document.getElementById('app');

let current = location.hash.replace('#', '') || 'dashboard';
if (!byId.has(current)) current = 'dashboard';

/* --------------------------------------------------------------- shell */

/** The marquee band carries today's live numbers rather than a slogan. */
function marqueeLine() {
  const cur = store.currency;
  const upcoming = store.upcoming();
  const week = upcoming.filter((b) => daysFromToday(b.event_date) <= 7);
  const next = upcoming[0];
  const low = store.lowStock();

  return [
    store.settings?.company_name || 'PMS Photobooth',
    next ? `Next up — ${next.client_name}, ${fmtDate(next.event_date, 'long')}` : 'No events booked',
    `${week.length} event${week.length === 1 ? '' : 's'} within 7 days`,
    `${money(store.outstanding(), cur)} outstanding`,
    low.length ? `${low.length} item${low.length === 1 ? '' : 's'} to reorder` : 'Stock levels healthy',
  ].join('  ●  ');
}

function renderShell() {
  const app = root();
  app.replaceChildren();

  const line = marqueeLine();
  app.appendChild(el('div', { class: 'marquee no-print' }, [
    // The track holds the line twice so the -50% loop is seamless.
    el('div', { class: 'marquee__track' }, [
      el('span', { text: line }), el('span', { text: line }),
    ]),
  ]));

  app.appendChild(el('nav', { class: 'nav no-print' }, [
    el('a', { class: 'nav__mark', href: '#dashboard' }, [
      el('span', { class: 'nav__badge', text: 'P' }),
      el('span', { text: `${APP_NAME} ${APP_SUB}` }),
    ]),
    el('div', { class: 'nav__links' }, VIEWS.map((v) =>
      el('a', {
        class: 'nav__link',
        href: `#${v.id}`,
        text: v.label,
        'aria-current': v.id === current ? 'page' : null,
      }))),
    el('div', { class: 'nav__right' }, [
      db.isLocal
        ? tag('Demo data', 'sun')
        : el('span', { class: 'cap cap--muted', text: db.user?.email || '' }),
      el('button', { class: 'nav__link', text: 'Settings', onclick: openSettings }),
      el('button', {
        class: 'nav__link',
        text: db.isLocal ? 'Sign in' : 'Sign out',
        onclick: async () => {
          if (!db.isLocal && !(await confirmSheet('Sign out of this session?',
            { title: 'Sign out', danger: 'Sign out' }))) return;
          await db.signOut();
          location.reload();
        },
      }),
    ]),
  ]));

  const body = el('main', { id: 'body' });
  app.appendChild(body);
  renderView();
}

function renderView() {
  const body = document.getElementById('body');
  if (!body) return;
  body.replaceChildren();
  const view = byId.get(current) || byId.get('dashboard');
  try {
    view.render(body);
  } catch (err) {
    console.error(err);
    body.appendChild(el('div', { class: 'view' }, [
      el('h1', { text: 'Something broke' }),
      el('p', { class: 'alt', text: err.message }),
    ]));
  }
  for (const link of document.querySelectorAll('.nav__link[href]')) {
    if (link.getAttribute('href') === `#${current}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  const next = location.hash.replace('#', '') || 'dashboard';
  if (!byId.has(next)) return;
  current = next;
  renderView();
});

window.addEventListener('pms:rerender', renderView);
store.onChange(renderView);

/* ------------------------------------------------------------ settings */

function openSettings() {
  const st = store.settings || {};
  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() }, [
    field('Company name', 'company_name', { value: st.company_name || '', span: true }),
    field('Tagline', 'tagline', { value: st.tagline || '', span: true }),
    field('Address', 'address', { value: st.address || '', span: true }),
    field('Phone', 'phone', { value: st.phone || '' }),
    field('Email', 'email', { type: 'email', value: st.email || '' }),
    field('Website', 'website', { value: st.website || '' }),
    field('Tax ID / TIN', 'tax_id', { value: st.tax_id || '' }),
    field('Currency', 'currency', {
      type: 'select', value: st.currency || 'PHP',
      options: [['PHP', 'PHP — Philippine peso'], ['USD', 'USD'], ['EUR', 'EUR'],
        ['GBP', 'GBP'], ['AUD', 'AUD'], ['SGD', 'SGD']],
    }),
    field('Default tax rate %', 'tax_rate',
      { type: 'number', step: '0.01', min: '0', value: st.tax_rate ?? 0 }),
    field('Invoice terms', 'invoice_terms',
      { type: 'textarea', value: st.invoice_terms || '', span: true, rows: 2 }),
    field('Payment details', 'bank_details', {
      type: 'textarea', value: st.bank_details || '', span: true, rows: 2,
      hint: 'Printed at the foot of every invoice',
    }),
  ]);

  const actions = [button('Save settings', async () => {
    const d = readForm(form);
    try {
      await store.saveSettings({
        company_name: d.company_name.trim(),
        tagline: d.tagline.trim(),
        address: d.address.trim(),
        phone: d.phone.trim(),
        email: d.email.trim(),
        website: d.website.trim(),
        tax_id: d.tax_id.trim(),
        currency: d.currency,
        tax_rate: parseFloat(d.tax_rate) || 0,
        invoice_terms: d.invoice_terms,
        bank_details: d.bank_details,
      });
      s.close();
      toast('Settings saved.');
    } catch (err) { fail(err); }
  }, { solid: true })];

  if (db.isLocal) {
    actions.unshift(button('Reset demo data', async () => {
      if (!(await confirmSheet('Throw away every local change and restore the demo rows?',
        { title: 'Reset demo data', danger: 'Reset' }))) return;
      db.resetLocal();
      location.reload();
    }, { side: 'left', quiet: true }));
  }

  const s = sheet({
    title: 'Settings',
    subtitle: db.isLocal ? 'Stored in this browser' : 'Stored in Supabase',
    body: form,
    actions,
  });
}

/* ---------------------------------------------------------------- gate */

function renderGate(reachable) {
  const app = root();
  app.replaceChildren();

  const form = el('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); signIn(); } }, [
    field('Email', 'email', { type: 'email', required: true, placeholder: 'you@example.com' }),
    field('Password', 'password', { type: 'password', required: true }),
  ]);

  const status = el('p', { class: 'alt', style: 'margin:0;min-height:1.2em' });
  const submit = button('Sign in', () => signIn(), { solid: true, type: 'submit' });

  async function signIn() {
    const d = readForm(form);
    if (!d.email || !d.password) { status.textContent = 'Enter your email and password.'; return; }
    submit.disabled = true;
    status.textContent = 'Signing in…';
    try {
      await db.signIn(d.email.trim(), d.password);
      await boot();
    } catch (err) {
      status.textContent = err.message || 'Sign in failed.';
      submit.disabled = false;
    }
  }

  app.appendChild(el('div', { class: 'gate' }, [
    el('div', { class: 'gate__box' }, [
      el('div', { class: 'row', style: 'margin-bottom:20px' }, [
        stickerCluster([['camera', 'ember'], ['coin', 'sun'], ['star', 'violet']]),
      ]),
      el('span', { class: 'cap cap--muted', text: 'Photobooth Booking Management' }),
      el('h1', { text: `${APP_NAME} ${APP_SUB}`, style: 'margin:8px 0 24px' }),

      reachable
        ? el('div', { class: 'stack' }, [
            form,
            el('div', { class: 'row row--tight' }, [submit]),
            status,
          ])
        : el('p', { class: 'alt', style: 'margin:0 0 24px',
            text: 'Supabase could not be reached from this browser. You can still explore the app with demo data held locally.' }),

      el('hr', { class: 'gate__rule' }),
      el('span', { class: 'cap cap--muted', text: 'No account yet?' }),
      el('p', { class: 'alt', style: 'margin:8px 0 16px' }, [
        'Add a user under Authentication → Users in the Supabase dashboard, then run ',
        el('code', { text: 'supabase/schema.sql' }),
        ' once in the SQL editor.',
      ]),
      button('Explore with demo data', () => { db.useLocal(); boot(); }, { quiet: true }),
    ]),
  ]));

  form.querySelector('input')?.focus();
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  const app = root();
  app.replaceChildren(el('div', { class: 'gate' }, [
    el('span', { class: 'cap cap--muted', text: 'Loading…' }),
  ]));

  try {
    await store.load();
    renderShell();
  } catch (err) {
    if (db.isLocal) { fail(err); return; }
    // Signed in, but the data would not load — say why rather than showing a blank page.
    app.replaceChildren(el('div', { class: 'gate' }, [
      el('div', { class: 'gate__box stack' }, [
        el('h1', { text: 'Cannot load data' }),
        el('p', { class: 'alt', style: 'margin:0', text: err.message }),
        el('div', { class: 'row row--tight' }, [
          button('Try again', () => boot(), { solid: true }),
          button('Use demo data', () => { db.useLocal(); boot(); }, { quiet: true }),
          button('Sign out', async () => { await db.signOut(); location.reload(); }, { quiet: true }),
        ]),
      ]),
    ]));
  }
}

(async function start() {
  const reachable = await db.connect();
  if (db.user) return boot();
  if (db.prefersLocal()) { db.useLocal(); return boot(); }
  renderGate(reachable);
})();
