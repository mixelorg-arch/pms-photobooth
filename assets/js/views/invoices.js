/* Invoice generator — build an invoice from a booking, edit its lines,
   then print it to paper or PDF. */

import { store, INVOICE_STATUS } from '../store.js';
import {
  el, money, num, sum, sortBy, matches, todayISO, toISO, fromISO, fmtDate, fmtTime,
  titleCase, uid, toCSV, downloadText,
} from '../util.js';
import {
  table, panel, stat, sheet, field, button, readForm, toast, fail, confirmSheet,
  invoiceTag, tag, twoLine, search, segment,
} from '../ui.js';

const state = { q: '', status: 'all' };
const rerender = () => window.dispatchEvent(new CustomEvent('pms:rerender'));

export default {
  id: 'invoices',
  label: 'Invoices',

  render(root) {
    const cur = store.currency;

    const rows = sortBy(store.invoices, (i) => i.issue_date + i.number, -1)
      .map((inv) => {
        const t = store.invoiceTotals(inv);
        const b = inv.booking_id ? store.booking(inv.booking_id) : null;
        return {
          ...inv,
          total: t.total,
          client_name: store.client(inv.client_id)?.name || '—',
          booking_ref: b?.reference || '—',
          booking: b,
        };
      })
      .filter((i) => (state.status === 'all' || i.status === state.status) &&
        matches(state.q, i.number, i.client_name, i.booking_ref));

    const issued = store.invoices.filter((i) => i.status !== 'void' && i.status !== 'draft');
    const issuedValue = sum(issued, (i) => store.invoiceTotals(i).total);
    const unpaid = issued.filter((i) => i.status !== 'paid');
    const unpaidValue = sum(unpaid, (i) => store.invoiceTotals(i).total);

    const uninvoiced = store.bookingViews().filter((b) =>
      b.status !== 'cancelled' &&
      !store.invoices.some((i) => String(i.booking_id) === String(b.id) && i.status !== 'void'));

    root.appendChild(el('div', { class: 'view' }, [
      el('div', { class: 'viewhead' }, [
        el('div', {}, [
          el('span', { class: 'cap cap--muted',
            text: `${store.invoices.length} invoices · ${unpaid.length} awaiting payment` }),
          el('h1', { text: 'Invoices' }),
        ]),
        el('div', { class: 'row row--tight' }, [
          button('Export CSV', () => exportCSV(rows, cur), { quiet: true }),
          button('New invoice', () => pickBooking(), { solid: true }),
        ]),
      ]),

      el('div', { class: 'mosaic cols-3', style: 'margin-bottom:19px' }, [
        stat('Issued', money(issuedValue, cur), `${issued.length} sent or paid`, { large: true }),
        stat('Awaiting payment', money(unpaidValue, cur), `${unpaid.length} invoices`),
        stat('Not yet invoiced', String(uninvoiced.length),
          uninvoiced.length ? 'Bookings with no live invoice' : 'Every booking is invoiced'),
      ]),

      uninvoiced.length
        ? el('div', { class: 'frame', style: 'padding:19px;margin-bottom:19px' }, [
            el('span', { class: 'cap', text: 'Bookings without an invoice' }),
            el('div', { class: 'row', style: 'margin-top:9px' },
              uninvoiced.slice(0, 8).map((b) => el('button', {
                class: 'tag', style: 'cursor:pointer',
                text: `${b.reference} · ${b.client_name} · ${money(b.total_amount, cur)}`,
                onclick: () => openInvoiceFor(store.booking(b.id)),
              }))),
          ])
        : null,

      el('div', { class: 'row', style: 'margin-bottom:19px' }, [
        el('div', { class: 'grow', style: 'max-width:320px' }, [
          search('Search number, client or booking…', state.q, (v) => { state.q = v; rerender(); }),
        ]),
        segment([['all', 'All'], ...INVOICE_STATUS.map((s) => [s, titleCase(s)])], state.status,
          (v) => { state.status = v; rerender(); }),
      ]),

      el('div', { class: 'frame' }, [
        table([
          { label: 'Number', cell: (i) => twoLine(i.number, fmtDate(i.issue_date)) },
          { label: 'Client', cell: (i) => twoLine(i.client_name, i.booking_ref) },
          { label: 'Due', cell: (i) => i.due_date ? fmtDate(i.due_date) : '—' },
          { label: 'Status', cell: (i) => invoiceTag(i.status) },
          { label: 'Total', align: 'right', cell: (i) => money(i.total, cur) },
          { label: '', align: 'right', cell: (i) => el('div', { class: 'row row--tight',
              style: 'justify-content:flex-end' }, [
              button('Print', () => previewInvoice(store.invoice(i.id)), { quiet: true }),
              button('Edit', () => editInvoice(store.invoice(i.id)), { quiet: true }),
            ]) },
        ], rows, {
          onRow: (i) => previewInvoice(store.invoice(i.id)),
          empty: 'No invoices yet. Create one from a booking.',
        }),
      ]),
    ]));
  },
};

/* ------------------------------------------------------------ create */

function pickBooking() {
  const cur = store.currency;
  const options = sortBy(store.bookingViews().filter((b) => b.status !== 'cancelled'),
    (b) => b.event_date, -1);

  const body = el('div', { class: 'stack' }, [
    el('p', { class: 'alt', style: 'margin:0',
      text: 'Pick the booking to invoice. Lines are drafted from its package and add-ons; you can edit them after.' }),
    el('div', { class: 'frame' }, [
      table([
        { label: 'Booking', cell: (b) => twoLine(b.reference, fmtDate(b.event_date, 'dow')) },
        { label: 'Client', cell: (b) => b.client_name },
        { label: 'Package', cell: (b) => b.package_name },
        { label: 'Invoiced', cell: (b) => store.invoices.some(
            (i) => String(i.booking_id) === String(b.id) && i.status !== 'void')
              ? tag('yes', 'solid') : tag('no', 'ghost') },
        { label: 'Total', align: 'right', cell: (b) => money(b.total_amount, cur) },
      ], options, {
        onRow: (b) => { s.close(); openInvoiceFor(store.booking(b.id)); },
        empty: 'No bookings to invoice yet.',
      }),
    ]),
  ]);

  const s = sheet({
    title: 'New invoice',
    subtitle: 'Invoices',
    body,
    wide: true,
    actions: [button('Blank invoice', async () => { s.close(); await createInvoice(null); },
      { side: 'left', quiet: true })],
  });
}

/** Open the live invoice for a booking, creating a draft if there isn't one. */
export async function openInvoiceFor(booking) {
  const existing = store.invoices.find(
    (i) => String(i.booking_id) === String(booking?.id) && i.status !== 'void');
  if (existing) return editInvoice(existing);
  return createInvoice(booking);
}

async function createInvoice(booking) {
  const st = store.settings || {};
  const v = booking ? store.view(booking) : null;

  try {
    const number = await store.nextNumber('invoice', 'INV');
    const issue = todayISO();
    const due = toISO(new Date(Date.now() + 7 * 86400000));

    const inv = await store.create('invoices', {
      number,
      booking_id: booking?.id || null,
      client_id: booking?.client_id || null,
      issue_date: issue,
      due_date: due,
      status: 'draft',
      currency: st.currency || 'PHP',
      tax_rate: num(st.tax_rate),
      discount: booking ? num(booking.discount) : 0,
      notes: '',
      terms: st.invoice_terms || '',
    });

    if (booking) {
      const pkg = store.package(booking.package_id);
      const where = [booking.event_type, booking.venue].filter(Boolean).join(' · ');
      const lines = [];

      lines.push({
        description: [
          pkg ? pkg.name : 'Photobooth coverage',
          `${fmtDate(booking.event_date, 'long')}${booking.start_time ? ', ' + fmtTime(booking.start_time) : ''}`,
          where,
          ...(pkg?.inclusions || []).map((i) => `• ${i}`),
        ].filter(Boolean).join('\n'),
        quantity: 1,
        unit_price: num(booking.package_price),
      });

      if (num(booking.addons_total)) {
        lines.push({ description: 'Add-ons and extras', quantity: 1, unit_price: num(booking.addons_total) });
      }

      for (const [i, line] of lines.entries()) {
        await store.create('invoice_items', { invoice_id: inv.id, position: i, ...line });
      }
    }

    toast(`Invoice ${number} drafted.`);
    return editInvoice(store.invoice(inv.id) || inv);
  } catch (err) { fail(err); }
}

/* ------------------------------------------------------------- editor */

function editInvoice(invoice) {
  const cur = invoice.currency || store.currency;
  const booking = invoice.booking_id ? store.booking(invoice.booking_id) : null;

  const clientOptions = [['', '— No client —'],
    ...sortBy(store.clients, (c) => c.name.toLowerCase()).map((c) => [c.id, c.name])];

  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() }, [
    field('Client', 'client_id', { type: 'select', options: clientOptions, value: invoice.client_id || '' }),
    field('Status', 'status', { type: 'select', options: INVOICE_STATUS, value: invoice.status }),
    field('Issue date', 'issue_date', { type: 'date', value: invoice.issue_date }),
    field('Due date', 'due_date', { type: 'date', value: invoice.due_date || '' }),
    field('Tax rate %', 'tax_rate', { type: 'number', step: '0.01', min: '0', value: num(invoice.tax_rate) }),
    field('Discount', 'discount', { type: 'number', step: '0.01', min: '0', value: num(invoice.discount) }),
    field('Terms', 'terms', { type: 'textarea', value: invoice.terms || '', span: true, rows: 2 }),
    field('Notes', 'notes', { type: 'textarea', value: invoice.notes || '', span: true, rows: 2 }),
  ]);

  /* Line items are edited in place and written on save. */
  let lines = store.itemsFor(invoice.id).map((i) => ({
    id: i.id, description: i.description, quantity: num(i.quantity), unit_price: num(i.unit_price),
  }));
  if (!lines.length) lines = [{ id: null, description: '', quantity: 1, unit_price: 0 }];

  const linesBox = el('div', { class: 'stack', style: 'gap:9px' });
  const totalsBox = el('div', { class: 'frame', style: 'padding:13px 19px' });

  function totals() {
    const subtotal = sum(lines, (l) => num(l.quantity) * num(l.unit_price));
    const discount = num(form.querySelector('[name=discount]').value);
    const rate = num(form.querySelector('[name=tax_rate]').value);
    const taxable = Math.max(0, subtotal - discount);
    const tax = taxable * (rate / 100);
    return { subtotal, discount, tax, total: taxable + tax };
  }

  function drawTotals() {
    const t = totals();
    const paid = booking ? store.view(booking).amount_paid : 0;
    totalsBox.replaceChildren(el('div', { class: 'row' }, [
      fig('Subtotal', money(t.subtotal, cur)),
      fig('Discount', money(t.discount, cur)),
      fig('Tax', money(t.tax, cur)),
      fig('Total', money(t.total, cur)),
      booking ? fig('Received', money(paid, cur)) : null,
      booking ? fig('Balance', money(t.total - paid, cur)) : null,
    ].filter(Boolean)));
  }

  function drawLines() {
    linesBox.replaceChildren(...lines.map((line, idx) => {
      const desc = el('textarea', { rows: 2, placeholder: 'Description' });
      desc.value = line.description;
      desc.addEventListener('input', () => { line.description = desc.value; });

      const qty = el('input', { type: 'number', step: '0.01', value: line.quantity });
      const price = el('input', { type: 'number', step: '0.01', value: line.unit_price });
      const amount = el('div', { class: 'strong num right',
        text: money(num(line.quantity) * num(line.unit_price), cur) });

      const recalc = () => {
        line.quantity = num(qty.value);
        line.unit_price = num(price.value);
        amount.textContent = money(line.quantity * line.unit_price, cur);
        drawTotals();
      };
      qty.addEventListener('input', recalc);
      price.addEventListener('input', recalc);

      return el('div', {
        class: 'frame',
        style: 'display:grid;grid-template-columns:minmax(0,3fr) 90px 130px 130px 40px;gap:9px;padding:9px;align-items:start',
      }, [
        desc, qty, price,
        el('div', { style: 'padding-top:9px' }, [amount]),
        button('×', () => {
          lines.splice(idx, 1);
          if (!lines.length) lines.push({ id: null, description: '', quantity: 1, unit_price: 0 });
          drawLines(); drawTotals();
        }, { quiet: true }),
      ]);
    }));
  }

  form.querySelector('[name=discount]').addEventListener('input', drawTotals);
  form.querySelector('[name=tax_rate]').addEventListener('input', drawTotals);
  drawLines();
  drawTotals();

  const body = el('div', { class: 'stack' }, [
    form,
    el('div', {}, [
      el('div', { class: 'panel__head' }, [
        el('span', { class: 'cap cap--muted', text: 'Line items' }),
        el('div', { class: 'row row--tight' }, [
          booking ? button('Reload from booking', () => {
            const pkg = store.package(booking.package_id);
            lines = [{
              id: null,
              description: [
                pkg ? pkg.name : 'Photobooth coverage',
                fmtDate(booking.event_date, 'long'),
                [booking.event_type, booking.venue].filter(Boolean).join(' · '),
                ...(pkg?.inclusions || []).map((i) => `• ${i}`),
              ].filter(Boolean).join('\n'),
              quantity: 1,
              unit_price: num(booking.package_price),
            }];
            if (num(booking.addons_total)) {
              lines.push({ id: null, description: 'Add-ons and extras', quantity: 1,
                unit_price: num(booking.addons_total) });
            }
            drawLines(); drawTotals();
          }, { quiet: true }) : null,
          button('+ Add line', () => {
            lines.push({ id: null, description: '', quantity: 1, unit_price: 0 });
            drawLines();
          }, { quiet: true }),
        ].filter(Boolean)),
      ]),
      el('div', { class: 'cap cap--muted', style: 'display:grid;grid-template-columns:minmax(0,3fr) 90px 130px 130px 40px;gap:9px;padding:0 9px 5px' }, [
        el('span', { text: 'Description' }), el('span', { text: 'Qty' }),
        el('span', { text: 'Unit price' }), el('span', { class: 'right', text: 'Amount' }), el('span'),
      ]),
      linesBox,
      el('div', { style: 'margin-top:19px' }, [totalsBox]),
    ]),
  ]);

  const persist = async () => {
    const d = readForm(form);
    await store.patch('invoices', invoice.id, {
      client_id: d.client_id || null,
      status: d.status,
      issue_date: d.issue_date || todayISO(),
      due_date: d.due_date || null,
      tax_rate: num(d.tax_rate),
      discount: num(d.discount),
      terms: d.terms,
      notes: d.notes,
    });

    // Rewrite the lines: drop what was removed, update what stayed, insert the new.
    const keptIds = new Set(lines.filter((l) => l.id).map((l) => String(l.id)));
    for (const old of store.itemsFor(invoice.id)) {
      if (!keptIds.has(String(old.id))) await store.destroy('invoice_items', old.id);
    }
    for (const [i, line] of lines.entries()) {
      const payload = {
        invoice_id: invoice.id,
        position: i,
        description: line.description,
        quantity: num(line.quantity),
        unit_price: num(line.unit_price),
      };
      if (line.id) await store.patch('invoice_items', line.id, payload);
      else await store.create('invoice_items', payload);
    }
  };

  const actions = [
    button('Delete', async () => {
      if (!(await confirmSheet(`Delete invoice ${invoice.number}?`, { title: 'Delete invoice' }))) return;
      try { await store.destroy('invoices', invoice.id); s.close(); toast('Invoice deleted.'); }
      catch (err) { fail(err); }
    }, { side: 'left', quiet: true }),
    button('Save', async () => {
      try { await persist(); s.close(); toast('Invoice saved.'); } catch (err) { fail(err); }
    }, { quiet: true }),
    button('Save & print', async () => {
      try {
        await persist();
        s.close();
        previewInvoice(store.invoice(invoice.id));
      } catch (err) { fail(err); }
    }, { solid: true }),
  ];

  const s = sheet({
    title: `Invoice ${invoice.number}`,
    subtitle: booking ? `${booking.reference} · ${store.view(booking).client_name}` : 'Invoices',
    body, actions, wide: true,
  });
}

const fig = (label, value) => el('div', { class: 'grow' }, [
  el('span', { class: 'cap cap--muted', text: label }),
  el('div', { class: 'strong num', text: value }),
]);

/* ------------------------------------------------------------ preview */

export function previewInvoice(invoice) {
  if (!invoice) return;
  const doc = renderDocument(invoice);

  const actions = [
    button('Edit', () => { s.close(); editInvoice(invoice); }, { side: 'left', quiet: true }),
    invoice.status !== 'paid'
      ? button('Mark paid', async () => {
          try {
            await store.patch('invoices', invoice.id, { status: 'paid' });
            s.close();
            toast(`${invoice.number} marked paid.`);
          } catch (err) { fail(err); }
        }, { quiet: true })
      : null,
    invoice.status === 'draft'
      ? button('Mark sent', async () => {
          try {
            await store.patch('invoices', invoice.id, { status: 'sent' });
            s.close();
            toast(`${invoice.number} marked sent.`);
          } catch (err) { fail(err); }
        }, { quiet: true })
      : null,
    button('Print / Save PDF', () => window.print(), { solid: true }),
  ].filter(Boolean);

  const s = sheet({
    title: `Invoice ${invoice.number}`,
    subtitle: 'Preview — use your browser’s “Save as PDF” to export',
    body: doc,
    actions,
    wide: true,
  });
}

function renderDocument(invoice) {
  const st = store.settings || {};
  const cur = invoice.currency || st.currency || 'PHP';
  const client = store.client(invoice.client_id);
  const booking = invoice.booking_id ? store.booking(invoice.booking_id) : null;
  const bv = booking ? store.view(booking) : null;
  const t = store.invoiceTotals(invoice);
  const paid = bv ? bv.amount_paid : 0;
  const balance = t.total - paid;

  const lineRows = t.items.length ? t.items : [];

  return el('article', { class: 'doc' }, [
    el('header', { class: 'doc__head' }, [
      el('div', {}, [
        el('div', { class: 'doc__title', text: 'Invoice' }),
        el('span', { class: 'cap', text: invoice.number }),
      ]),
      el('div', { class: 'right' }, [
        el('div', { class: 'strong', text: st.company_name || 'PMS Photobooth' }),
        el('div', { class: 'alt' }, [
          ...[st.address, st.phone, st.email, st.website, st.tax_id ? `TIN ${st.tax_id}` : null]
            .filter(Boolean)
            .flatMap((line) => [document.createTextNode(line), el('br')]),
        ]),
      ]),
    ]),

    el('div', { class: 'doc__meta' }, [
      el('div', {}, [
        el('span', { class: 'cap cap--muted', text: 'Billed to' }),
        el('div', { class: 'strong', text: client?.name || '—' }),
        el('div', { class: 'alt' }, [
          ...[client?.company, client?.address, client?.phone, client?.email]
            .filter(Boolean)
            .flatMap((line) => [document.createTextNode(line), el('br')]),
        ]),
      ]),
      el('div', { class: 'right' }, [
        row('Issued', fmtDate(invoice.issue_date, 'long')),
        row('Due', invoice.due_date ? fmtDate(invoice.due_date, 'long') : 'On receipt'),
        booking ? row('Booking', booking.reference) : null,
        booking ? row('Event', fmtDate(booking.event_date, 'long')) : null,
        row('Status', titleCase(invoice.status)),
      ]),
    ]),

    el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Description' }),
        el('th', { text: 'Qty', style: 'text-align:right;width:70px' }),
        el('th', { text: 'Unit price', style: 'text-align:right;width:120px' }),
        el('th', { text: 'Amount', style: 'text-align:right;width:130px' }),
      ])]),
      el('tbody', {}, lineRows.length
        ? lineRows.map((i) => el('tr', {}, [
            el('td', { style: 'white-space:pre-line', text: i.description || '—' }),
            el('td', { class: 'num right', text: String(num(i.quantity)) }),
            el('td', { class: 'num right', text: money(i.unit_price, cur) }),
            el('td', { class: 'num right', text: money(num(i.amount ?? num(i.quantity) * num(i.unit_price)), cur) }),
          ]))
        : [el('tr', {}, [el('td', { colspan: 4, text: 'No line items.' })])]),
    ]),

    el('div', { class: 'doc__totals' }, [
      line('Subtotal', money(t.subtotal, cur)),
      t.discount ? line('Discount', '− ' + money(t.discount, cur)) : null,
      num(invoice.tax_rate) ? line(`Tax (${num(invoice.tax_rate)}%)`, money(t.tax, cur)) : null,
      line('Total', money(t.total, cur), true),
      paid ? line('Received', '− ' + money(paid, cur)) : null,
      paid ? line('Balance due', money(balance, cur), true) : null,
    ].filter(Boolean)),

    el('footer', { class: 'doc__foot' }, [
      invoice.notes ? el('div', { style: 'margin-bottom:9px', text: invoice.notes }) : null,
      invoice.terms ? el('div', { text: invoice.terms }) : null,
      st.bank_details ? el('div', { style: 'margin-top:9px', text: st.bank_details }) : null,
      el('div', { style: 'margin-top:19px', text: `Thank you — ${st.company_name || 'PMS Photobooth'}` }),
    ].filter(Boolean)),
  ]);
}

const row = (k, v) => el('div', { style: 'margin-bottom:5px' }, [
  el('span', { class: 'cap cap--muted', text: k }),
  el('div', { class: 'alt', text: v }),
]);

const line = (k, v, grand = false) => el('div', { class: grand ? 'grand' : '' }, [
  el('span', { text: k }), el('span', { class: 'num', text: v }),
]);

function exportCSV(rows, cur) {
  downloadText('invoices.csv', toCSV(rows, [
    { label: 'Number', value: (i) => i.number },
    { label: 'Issue date', value: (i) => i.issue_date },
    { label: 'Due date', value: (i) => i.due_date || '' },
    { label: 'Client', value: (i) => i.client_name },
    { label: 'Booking', value: (i) => i.booking_ref },
    { label: 'Status', value: (i) => i.status },
    { label: `Total (${cur})`, value: (i) => num(i.total).toFixed(2) },
  ]));
  toast('invoices.csv downloaded.');
}
