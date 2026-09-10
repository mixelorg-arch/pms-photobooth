/* Scheduling — month calendar, booking list, and the booking record itself. */

import { store, STATUS, EVENT_TYPES, PAY_METHODS, PAY_KINDS } from '../store.js';
import {
  el, money, num, matches, sortBy, sum, todayISO, toISO, fromISO, addMonths, addHours,
  monthLabel, monthKey, fmtDate, fmtTime, relativeDay, DOW, titleCase, toCSV, downloadText,
} from '../util.js';
import {
  table, sheet, field, button, readForm, toast, fail, confirmSheet, statusTag, tag,
  twoLine, search, segment, keyValue,
} from '../ui.js';
import { openInvoiceFor } from './invoices.js';

const state = {
  mode: 'calendar',
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  q: '',
  status: 'all',
};

const rerender = () => window.dispatchEvent(new CustomEvent('pms:rerender'));

export default {
  id: 'scheduling',
  label: 'Scheduling',

  render(root) {
    const cur = store.currency;
    const upcoming = store.upcoming();

    root.appendChild(el('div', { class: 'view' }, [
      el('div', { class: 'viewhead' }, [
        el('div', {}, [
          el('span', { class: 'cap cap--muted',
            text: `${upcoming.length} upcoming · ${store.bookings.length} total` }),
          el('h1', { text: 'Scheduling' }),
        ]),
        el('div', { class: 'row row--tight' }, [
          segment([['calendar', 'Calendar'], ['list', 'List']], state.mode,
            (v) => { state.mode = v; rerender(); }),
          button('New booking', () => editBooking(null), { solid: true }),
        ]),
      ]),
      state.mode === 'calendar' ? calendarView(cur) : listView(cur),
    ]));
  },
};

/* ---------------------------------------------------------- calendar */

function calendarView(cur) {
  const m = state.month;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((startPad + daysInMonth) / 7) * 7;
  const today = todayISO();

  const byDate = new Map();
  for (const b of store.bookings) {
    if (!byDate.has(b.event_date)) byDate.set(b.event_date, []);
    byDate.get(b.event_date).push(b);
  }

  const grid = el('div', { class: 'cal' },
    DOW.map((d) => el('div', { class: 'cal__dow', text: d })));

  for (let i = 0; i < cells; i++) {
    const date = new Date(m.getFullYear(), m.getMonth(), i - startPad + 1);
    const iso = toISO(date);
    const outside = date.getMonth() !== m.getMonth();
    const events = sortBy(byDate.get(iso) || [], (b) => b.start_time || '');

    grid.appendChild(el('div', {
      class: 'cal__day' + (outside ? ' cal__day--out' : '') + (iso === today ? ' cal__day--today' : ''),
      ondblclick: () => editBooking(null, { event_date: iso }),
      title: 'Double-click to book this date',
    }, [
      el('span', { class: 'cal__num', text: String(date.getDate()) }),
      ...events.map((b) => {
        const v = store.view(b);
        return el('button', {
          class: `cal__ev cal__ev--${b.status}`,
          text: `${fmtTime(b.start_time)} ${v.client_name}`,
          title: `${v.client_name} — ${v.package_name} — ${b.venue || 'venue TBC'}`,
          onclick: (e) => { e.stopPropagation(); editBooking(b); },
        });
      }),
    ]));
  }

  const monthBookings = store.bookings.filter(
    (b) => b.event_date.slice(0, 7) === monthKey(m) && b.status !== 'cancelled');

  return el('div', { class: 'stack' }, [
    el('div', { class: 'row' }, [
      el('div', { class: 'row row--tight' }, [
        button('‹ Prev', () => { state.month = addMonths(m, -1); rerender(); }, { quiet: true }),
        button('Today', () => {
          const n = new Date();
          state.month = new Date(n.getFullYear(), n.getMonth(), 1);
          rerender();
        }, { quiet: true }),
        button('Next ›', () => { state.month = addMonths(m, 1); rerender(); }, { quiet: true }),
      ]),
      el('h3', { class: 'grow', text: monthLabel(m) }),
      el('span', { class: 'cap cap--muted',
        text: `${monthBookings.length} events · ${money(sum(monthBookings, (b) => b.total_amount), cur)} booked` }),
    ]),
    grid,
    el('div', { class: 'row', style: 'margin-top:4px' }, [
      el('span', { class: 'cap cap--muted', text: 'Legend' }),
      legend('Confirmed', 'cal__ev--confirmed'),
      legend('Inquiry', ''),
      legend('Completed', 'cal__ev--completed'),
      legend('Cancelled', 'cal__ev--cancelled'),
    ]),
  ]);
}

const legend = (label, cls) =>
  el('span', { class: `cal__ev ${cls}`, text: label, style: 'cursor:default' });

/* -------------------------------------------------------------- list */

function listView(cur) {
  const rows = store.bookingViews().filter((b) =>
    (state.status === 'all' || b.status === state.status) &&
    matches(state.q, b.reference, b.client_name, b.venue, b.package_name, b.event_type));

  return el('div', { class: 'stack' }, [
    el('div', { class: 'row' }, [
      el('div', { class: 'grow', style: 'max-width:340px' }, [
        search('Search reference, client or venue…', state.q, (v) => { state.q = v; rerender(); }),
      ]),
      segment([['all', 'All'], ...STATUS.map((s) => [s, titleCase(s)])], state.status,
        (v) => { state.status = v; rerender(); }),
      button('Export CSV', () => exportCSV(rows, cur), { quiet: true }),
    ]),
    el('div', { class: 'frame' }, [
      table([
        { label: 'Event date', cell: (b) => twoLine(fmtDate(b.event_date, 'dow'),
            `${fmtTime(b.start_time)} · ${relativeDay(b.event_date)}`) },
        { label: 'Client', cell: (b) => twoLine(b.client_name, b.reference) },
        { label: 'Package', cell: (b) => twoLine(b.package_name, b.event_type || '') },
        { label: 'Venue', cell: (b) => b.venue || '—' },
        { label: 'Status', cell: (b) => statusTag(b.status) },
        { label: 'Total', align: 'right', cell: (b) => money(b.total_amount, cur) },
        { label: 'Balance', align: 'right', cell: (b) =>
            b.balance_due > 0.005
              ? el('strong', { text: money(b.balance_due, cur) })
              : el('span', { class: 'muted', text: 'Settled' }) },
      ], rows, {
        onRow: (b) => editBooking(store.booking(b.id)),
        empty: 'No bookings match this filter.',
      }),
    ]),
  ]);
}

/* ---------------------------------------------------------- the sheet */

export async function editBooking(booking, defaults = {}) {
  const isNew = !booking;
  const cur = store.currency;
  const v = isNew ? null : store.view(booking);

  const activePackages = store.packages.filter(
    (p) => p.active !== false || String(p.id) === String(booking?.package_id));

  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() });

  const clientOptions = [['', '— Select client —'],
    ...sortBy(store.clients, (c) => c.name.toLowerCase())
      .map((c) => [c.id, c.company ? `${c.name} (${c.company})` : c.name])];

  const f = {};
  f.client_id = field('Client', 'client_id',
    { type: 'select', options: clientOptions, value: booking?.client_id || defaults.client_id || '' });
  const addClient = button('+ New client', () => newClient((c) => {
    f.client_id.input.appendChild(el('option', { value: c.id, text: c.name, selected: true }));
    f.client_id.input.value = c.id;
  }), { quiet: true });
  f.client_id.appendChild(el('div', { style: 'margin-top:5px' }, [addClient]));

  f.package_id = field('Package', 'package_id', {
    type: 'select',
    options: [['', '— Custom / none —'],
      ...activePackages.map((p) => [p.id, `${p.name} — ${money(p.price, cur)}`])],
    value: booking?.package_id || '',
  });

  f.event_date = field('Event date', 'event_date',
    { type: 'date', value: booking?.event_date || defaults.event_date || todayISO(), required: true });
  f.start_time = field('Start time', 'start_time',
    { type: 'time', value: (booking?.start_time || '18:00').slice(0, 5) });
  f.end_time = field('End time', 'end_time',
    { type: 'time', value: (booking?.end_time || '').slice(0, 5), hint: 'Filled from the package if left blank' });
  f.event_type = field('Event type', 'event_type',
    { type: 'select', options: EVENT_TYPES, value: booking?.event_type || 'Wedding' });
  f.venue = field('Venue', 'venue', { value: booking?.venue || '', span: true });
  f.guest_count = field('Guests', 'guest_count',
    { type: 'number', min: '0', value: booking?.guest_count ?? 0 });
  f.status = field('Status', 'status',
    { type: 'select', options: STATUS, value: booking?.status || 'inquiry' });

  f.package_price = field('Package price', 'package_price',
    { type: 'number', step: '0.01', min: '0', value: booking?.package_price ?? 0 });
  f.addons_total = field('Add-ons', 'addons_total',
    { type: 'number', step: '0.01', min: '0', value: booking?.addons_total ?? 0 });
  f.discount = field('Discount', 'discount',
    { type: 'number', step: '0.01', min: '0', value: booking?.discount ?? 0 });
  f.notes = field('Notes', 'notes',
    { type: 'textarea', value: booking?.notes || '', span: true, rows: 3 });

  const totalLine = el('div', { class: 'panel frame span2', style: 'padding:13px 19px' });
  const clashLine = el('div', { class: 'span2' });

  for (const key of ['client_id', 'package_id', 'event_date', 'start_time', 'end_time',
    'event_type', 'venue', 'guest_count', 'status', 'package_price', 'addons_total',
    'discount']) form.appendChild(f[key]);
  form.appendChild(clashLine);
  form.appendChild(totalLine);
  form.appendChild(f.notes);

  /* live total + clash warning ------------------------------------- */
  const paid = isNew ? 0 : v.amount_paid;

  function refreshTotals() {
    const total = num(f.package_price.input.value) + num(f.addons_total.input.value)
                - num(f.discount.input.value);
    totalLine.replaceChildren(el('div', { class: 'row' }, [
      figure('Total', money(total, cur)),
      figure('Paid', money(paid, cur)),
      figure('Balance', money(total - paid, cur)),
    ]));
  }

  function refreshClash() {
    const iso = f.event_date.input.value;
    const clashes = store.clashesFor(iso, booking?.id);
    // replaceChildren() would turn a null into the text "null" — pass no child instead.
    clashLine.replaceChildren(...(clashes.length
      ? [el('div', { class: 'frame', style: 'padding:11px 13px' }, [
          el('span', { class: 'cap', text: `Already booked on ${fmtDate(iso)}` }),
          ...clashes.map((c) => el('div', { class: 'alt',
            text: `${fmtTime(c.start_time)} — ${c.client_name} · ${c.package_name} · ${c.venue || 'venue TBC'}` })),
          el('span', { class: 'cap cap--muted',
            text: 'Double bookings are allowed — check you have the equipment and crew.' }),
        ])]
      : []));
  }

  f.package_id.input.addEventListener('change', () => {
    const pkg = store.package(f.package_id.input.value);
    if (!pkg) return;
    f.package_price.input.value = num(pkg.price);
    if (!f.end_time.input.value) {
      f.end_time.input.value = addHours(f.start_time.input.value || '18:00', pkg.duration_hours);
    }
    refreshTotals();
  });
  for (const k of ['package_price', 'addons_total', 'discount']) {
    f[k].input.addEventListener('input', refreshTotals);
  }
  f.event_date.input.addEventListener('change', refreshClash);
  refreshTotals();
  refreshClash();

  /* body ----------------------------------------------------------- */
  const body = el('div', { class: 'stack' }, [form]);
  if (!isNew) body.appendChild(paymentsPanel(booking, cur));

  const save = async () => {
    const d = readForm(form);
    if (!d.client_id) return toast('Choose a client for this booking.', 'err');
    if (!d.event_date) return toast('An event date is required.', 'err');

    const pkg = store.package(d.package_id);
    const payload = {
      client_id: d.client_id,
      package_id: d.package_id || null,
      event_date: d.event_date,
      start_time: d.start_time || '18:00',
      end_time: d.end_time || (pkg ? addHours(d.start_time || '18:00', pkg.duration_hours) : null),
      venue: d.venue.trim(),
      event_type: d.event_type,
      guest_count: parseInt(d.guest_count, 10) || 0,
      status: d.status,
      package_price: num(d.package_price),
      addons_total: num(d.addons_total),
      discount: num(d.discount),
      notes: d.notes.trim(),
    };

    try {
      if (isNew) {
        payload.reference = await store.nextNumber('booking', 'BK');
        const rec = await store.create('bookings', payload);
        s.close();
        toast(`Booking ${rec.reference} created.`);
      } else {
        await store.patch('bookings', booking.id, payload);
        s.close();
        toast('Booking saved.');
      }
    } catch (err) { fail(err); }
  };

  const actions = [button('Save booking', save, { solid: true })];
  if (!isNew) {
    actions.unshift(button('Delete', async () => {
      if (!(await confirmSheet(
        `Delete ${booking.reference}? Its payments are deleted with it.`,
        { title: 'Delete booking' }))) return;
      try { await store.destroy('bookings', booking.id); s.close(); toast('Booking deleted.'); }
      catch (err) { fail(err); }
    }, { side: 'left', quiet: true }));
    actions.unshift(button('Invoice', () => { s.close(); openInvoiceFor(booking); },
      { side: 'left', quiet: true }));
  }

  const s = sheet({
    title: isNew ? 'New booking' : `${v.client_name}`,
    subtitle: isNew ? 'Scheduling' : `${booking.reference} · ${fmtDate(booking.event_date, 'dow')}`,
    body,
    actions,
    wide: true,
  });
}

const figure = (label, value) => el('div', { class: 'grow' }, [
  el('span', { class: 'cap cap--muted', text: label }),
  el('div', { class: 'strong num', text: value }),
]);

/* ---------------------------------------------------------- payments */

function paymentsPanel(booking, cur) {
  const v = store.view(booking);
  const rows = store.paymentsFor(booking.id);

  const box = el('section', { class: 'frame', style: 'padding:19px' }, [
    el('div', { class: 'panel__head' }, [
      el('span', { class: 'cap cap--muted',
        text: `Payments — ${money(v.amount_paid, cur)} of ${money(v.total_amount, cur)} received` }),
      el('div', { class: 'row row--tight' }, [
        v.balance_due > 0.005
          ? button(`Settle ${money(v.balance_due, cur)}`,
              () => addPayment(booking, v.balance_due, 'full'), { quiet: true })
          : null,
        button('Add payment', () => addPayment(booking), { solid: true }),
      ].filter(Boolean)),
    ]),
    table([
      { label: 'Date', cell: (p) => fmtDate(p.paid_on) },
      { label: 'Kind', cell: (p) => tag(p.kind, p.kind === 'refund' ? 'ghost' : 'plain') },
      { label: 'Method', cell: (p) => titleCase(p.method) },
      { label: 'Reference', cell: (p) => p.reference || '—' },
      { label: 'Amount', align: 'right', cell: (p) => money(p.amount, cur) },
      { label: '', align: 'right', cell: (p) => button('Remove', async () => {
          if (!(await confirmSheet(`Remove the ${money(p.amount, cur)} payment?`,
            { title: 'Remove payment', danger: 'Remove' }))) return;
          try { await store.destroy('payments', p.id); toast('Payment removed.'); }
          catch (err) { fail(err); }
        }, { quiet: true }) },
    ], rows, { empty: 'No payments recorded against this booking.' }),
  ]);
  return box;
}

export function addPayment(booking, amount = null, kind = null) {
  const cur = store.currency;
  const v = store.view(booking);
  const suggested = amount ?? Math.max(0, v.balance_due);
  const suggestedKind = kind ?? (v.amount_paid === 0 ? 'reservation' : 'partial');

  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() }, [
    field('Amount', 'amount', { type: 'number', step: '0.01', value: suggested.toFixed(2), required: true }),
    field('Date received', 'paid_on', { type: 'date', value: todayISO() }),
    field('Method', 'method', { type: 'select', options: PAY_METHODS, value: 'gcash' }),
    field('Kind', 'kind', { type: 'select', options: PAY_KINDS, value: suggestedKind }),
    field('Reference', 'reference', { value: '', placeholder: 'GCash / bank reference', span: true }),
    field('Notes', 'notes', { type: 'textarea', value: '', span: true, rows: 2 }),
  ]);

  const s = sheet({
    title: 'Record payment',
    subtitle: `${booking.reference} · balance ${money(v.balance_due, cur)}`,
    body: form,
    actions: [button('Record payment', async () => {
      const d = readForm(form);
      const value = num(d.amount);
      if (!value) return toast('Enter an amount.', 'err');
      try {
        await store.create('payments', {
          booking_id: booking.id,
          amount: d.kind === 'refund' ? -Math.abs(value) : Math.abs(value),
          method: d.method,
          kind: d.kind,
          paid_on: d.paid_on || todayISO(),
          reference: d.reference.trim(),
          notes: d.notes.trim(),
        });
        s.close();
        toast('Payment recorded.');
      } catch (err) { fail(err); }
    }, { solid: true })],
  });
}

/* ----------------------------------------------------------- clients */

export function newClient(onCreated) {
  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() }, [
    field('Name', 'name', { required: true, span: true }),
    field('Company', 'company', {}),
    field('Phone', 'phone', { type: 'tel' }),
    field('Email', 'email', { type: 'email', span: true }),
    field('Address', 'address', { span: true }),
    field('Notes', 'notes', { type: 'textarea', span: true, rows: 2 }),
  ]);

  const s = sheet({
    title: 'New client',
    subtitle: 'Clients',
    body: form,
    actions: [button('Add client', async () => {
      const d = readForm(form);
      if (!d.name.trim()) return toast('A client needs a name.', 'err');
      try {
        const rec = await store.create('clients', {
          name: d.name.trim(), company: d.company.trim(), phone: d.phone.trim(),
          email: d.email.trim(), address: d.address.trim(), notes: d.notes.trim(),
        });
        s.close();
        toast('Client added.');
        onCreated?.(rec);
      } catch (err) { fail(err); }
    }, { solid: true })],
  });
}

function exportCSV(rows, cur) {
  downloadText('bookings.csv', toCSV(rows, [
    { label: 'Reference', value: (b) => b.reference },
    { label: 'Event date', value: (b) => b.event_date },
    { label: 'Start', value: (b) => b.start_time },
    { label: 'Client', value: (b) => b.client_name },
    { label: 'Package', value: (b) => b.package_name },
    { label: 'Type', value: (b) => b.event_type },
    { label: 'Venue', value: (b) => b.venue },
    { label: 'Guests', value: (b) => b.guest_count },
    { label: 'Status', value: (b) => b.status },
    { label: `Total (${cur})`, value: (b) => num(b.total_amount).toFixed(2) },
    { label: `Paid (${cur})`, value: (b) => num(b.amount_paid).toFixed(2) },
    { label: `Balance (${cur})`, value: (b) => num(b.balance_due).toFixed(2) },
  ]));
  toast('bookings.csv downloaded.');
}
