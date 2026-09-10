/* Clients — the address book bookings and invoices are built on. */

import { store } from '../store.js';
import {
  el, money, num, sum, sortBy, matches, fmtDate, toCSV, downloadText,
} from '../util.js';
import {
  table, sheet, field, button, readForm, toast, fail, confirmSheet,
  twoLine, search, statusTag, stickerCluster,
} from '../ui.js';
import { editBooking, newClient } from './scheduling.js';

const state = { q: '' };
const rerender = () => window.dispatchEvent(new CustomEvent('pms:rerender'));

export default {
  id: 'clients',
  label: 'Clients',

  render(root) {
    const cur = store.currency;

    const rows = sortBy(store.clients, (c) => c.name.toLowerCase()).map((c) => {
      const theirs = store.bookings
        .filter((b) => String(b.client_id) === String(c.id) && b.status !== 'cancelled')
        .map((b) => store.view(b));
      return {
        ...c,
        count: theirs.length,
        lifetime: sum(theirs, (b) => b.amount_paid),
        owing: sum(theirs, (b) => Math.max(0, b.balance_due)),
        last: sortBy(theirs, (b) => b.event_date, -1)[0] || null,
      };
    }).filter((c) => matches(state.q, c.name, c.company, c.email, c.phone, c.address));

    root.appendChild(el('div', { class: 'view' }, [
      el('div', { class: 'viewhead' }, [
        el('div', { class: 'viewhead__title' }, [
          stickerCluster([['star', 'lavender'], ['camera', 'ember'], ['check', 'mint']]),
          el('div', {}, [
            el('span', { class: 'cap cap--muted', text: `${store.clients.length} on file` }),
            el('h1', { text: 'Clients' }),
          ]),
        ]),
        el('div', { class: 'row row--tight' }, [
          button('Export CSV', () => exportCSV(rows, cur), { quiet: true }),
          button('New client', () => newClient(), { solid: true }),
        ]),
      ]),

      el('div', { class: 'row', style: 'margin-bottom:24px' }, [
        el('div', { class: 'grow', style: 'max-width:340px' }, [
          search('Search name, company, phone or email…', state.q,
            (v) => { state.q = v; rerender(); }),
        ]),
      ]),

      table([
          { label: 'Client', cell: (c) => twoLine(c.name, c.company || '') },
          { label: 'Contact', cell: (c) => twoLine(c.phone || '—', c.email || '') },
          { label: 'Last event', cell: (c) => c.last
              ? twoLine(fmtDate(c.last.event_date), c.last.package_name)
              : el('span', { class: 'muted', text: 'None yet' }) },
          { label: 'Bookings', align: 'right', cell: (c) => String(c.count) },
          { label: 'Lifetime paid', align: 'right', cell: (c) => money(c.lifetime, cur) },
          { label: 'Owing', align: 'right', cell: (c) => c.owing > 0.005
              ? el('strong', { text: money(c.owing, cur) })
              : el('span', { class: 'muted', text: '—' }) },
        ], rows, {
          onRow: (c) => editClient(store.client(c.id)),
          empty: state.q ? 'No client matches that search.' : 'No clients yet.',
        }),
    ]));
  },
};

function editClient(client) {
  const cur = store.currency;
  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() }, [
    field('Name', 'name', { value: client.name, required: true, span: true }),
    field('Company', 'company', { value: client.company || '' }),
    field('Phone', 'phone', { type: 'tel', value: client.phone || '' }),
    field('Email', 'email', { type: 'email', value: client.email || '', span: true }),
    field('Address', 'address', { value: client.address || '', span: true }),
    field('Notes', 'notes', { type: 'textarea', value: client.notes || '', span: true, rows: 3 }),
  ]);

  const theirs = sortBy(
    store.bookings.filter((b) => String(b.client_id) === String(client.id)),
    (b) => b.event_date, -1).map((b) => store.view(b));

  const body = el('div', { class: 'stack' }, [
    form,
    el('section', { class: 'card', style: 'padding:24px' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'cap cap--muted', text: `Bookings — ${theirs.length}` }),
        button('New booking', () => { s.close(); editBooking(null, { client_id: client.id }); },
          { quiet: true }),
      ]),
      table([
        { label: 'Date', cell: (b) => fmtDate(b.event_date, 'dow') },
        { label: 'Reference', cell: (b) => b.reference },
        { label: 'Package', cell: (b) => b.package_name },
        { label: 'Status', cell: (b) => statusTag(b.status) },
        { label: 'Total', align: 'right', cell: (b) => money(b.total_amount, cur) },
        { label: 'Balance', align: 'right', cell: (b) => money(b.balance_due, cur) },
      ], theirs, {
        onRow: (b) => { s.close(); editBooking(store.booking(b.id)); },
        empty: 'No bookings for this client yet.',
      }),
    ]),
  ]);

  const s = sheet({
    title: client.name,
    subtitle: client.company || 'Clients',
    body,
    actions: [
      button('Delete', async () => {
        if (theirs.length) {
          return toast('This client has bookings — delete or reassign those first.', 'err');
        }
        if (!(await confirmSheet(`Delete ${client.name}?`, { title: 'Delete client' }))) return;
        try { await store.destroy('clients', client.id); s.close(); toast('Client deleted.'); }
        catch (err) { fail(err); }
      }, { side: 'left', quiet: true }),
      button('Save client', async () => {
        const d = readForm(form);
        if (!d.name.trim()) return toast('A client needs a name.', 'err');
        try {
          await store.patch('clients', client.id, {
            name: d.name.trim(), company: d.company.trim(), phone: d.phone.trim(),
            email: d.email.trim(), address: d.address.trim(), notes: d.notes.trim(),
          });
          s.close();
          toast('Client saved.');
        } catch (err) { fail(err); }
      }, { solid: true }),
    ],
  });
}

function exportCSV(rows, cur) {
  downloadText('clients.csv', toCSV(rows, [
    { label: 'Name', value: (c) => c.name },
    { label: 'Company', value: (c) => c.company || '' },
    { label: 'Phone', value: (c) => c.phone || '' },
    { label: 'Email', value: (c) => c.email || '' },
    { label: 'Address', value: (c) => c.address || '' },
    { label: 'Bookings', value: (c) => c.count },
    { label: `Lifetime paid (${cur})`, value: (c) => num(c.lifetime).toFixed(2) },
    { label: `Owing (${cur})`, value: (c) => num(c.owing).toFixed(2) },
  ]));
  toast('clients.csv downloaded.');
}
