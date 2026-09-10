/* Inventory — equipment and consumables, with a movement log that is the
   single source of truth for quantity on hand. */

import { store, CATEGORIES, MOVE_REASONS } from '../store.js';
import {
  el, money, num, sum, sortBy, matches, titleCase, fmtDate, todayISO,
  toCSV, downloadText,
} from '../util.js';
import {
  table, panel, stat, sheet, field, button, readForm, toast, fail, confirmSheet,
  tag, twoLine, search, segment, keyValue,
} from '../ui.js';

const state = { q: '', category: 'all', lowOnly: false };

const rerender = () => window.dispatchEvent(new CustomEvent('pms:rerender'));

export default {
  id: 'inventory',
  label: 'Inventory',

  render(root) {
    const cur = store.currency;
    const all = store.inventory_items.filter((i) => i.active !== false);
    const low = store.lowStock();

    const rows = sortBy(all, (i) => i.name.toLowerCase()).filter((i) =>
      (state.category === 'all' || i.category === state.category) &&
      (!state.lowOnly || num(i.quantity) <= num(i.reorder_level)) &&
      matches(state.q, i.name, i.sku, i.location, i.category, i.notes));

    const stockValue = sum(all, (i) => num(i.quantity) * num(i.unit_cost));
    const consumables = all.filter((i) => i.category === 'consumable');
    const recent = sortBy(store.inventory_movements, (m) => m.created_at || '', -1).slice(0, 12);

    root.appendChild(el('div', { class: 'view' }, [
      el('div', { class: 'viewhead' }, [
        el('div', {}, [
          el('span', { class: 'cap cap--muted',
            text: `${all.length} items · ${low.length} at or below reorder level` }),
          el('h1', { text: 'Inventory' }),
        ]),
        el('div', { class: 'row row--tight' }, [
          button('Export CSV', () => exportCSV(all, cur), { quiet: true }),
          button('New item', () => editItem(null), { solid: true }),
        ]),
      ]),

      el('div', { class: 'mosaic cols-4', style: 'margin-bottom:19px' }, [
        stat('Stock value', money(stockValue, cur), 'quantity × unit cost', { large: true }),
        stat('Items tracked', String(all.length), `${consumables.length} consumable lines`),
        stat('Need reorder', String(low.length),
          low.length ? low.slice(0, 2).map((i) => i.name).join(', ') : 'Everything above level'),
        stat('Movements logged', String(store.inventory_movements.length), 'in + out entries'),
      ]),

      low.length
        ? el('div', { class: 'frame', style: 'padding:19px;margin-bottom:19px' }, [
            el('span', { class: 'cap', text: 'Reorder now' }),
            el('div', { class: 'row', style: 'margin-top:9px' }, low.map((i) =>
              el('button', {
                class: 'tag tag--solid', style: 'cursor:pointer',
                text: `${i.name} — ${num(i.quantity)} ${i.unit} left`,
                onclick: () => moveStock(i),
              }))),
          ])
        : null,

      el('div', { class: 'row', style: 'margin-bottom:19px' }, [
        el('div', { class: 'grow', style: 'max-width:320px' }, [
          search('Search item, SKU or location…', state.q, (v) => { state.q = v; rerender(); }),
        ]),
        segment([['all', 'All'], ...CATEGORIES.map((c) => [c, titleCase(c)])], state.category,
          (v) => { state.category = v; rerender(); }),
        button(state.lowOnly ? 'Showing low stock' : 'Low stock only',
          () => { state.lowOnly = !state.lowOnly; rerender(); },
          { solid: state.lowOnly, quiet: !state.lowOnly }),
      ]),

      el('div', { class: 'frame', style: 'margin-bottom:19px' }, [
        table([
          { label: 'Item', cell: (i) => twoLine(i.name, i.sku || '') },
          { label: 'Category', cell: (i) => titleCase(i.category) },
          { label: 'Location', cell: (i) => i.location || '—' },
          { label: 'On hand', align: 'right', cell: (i) => {
              const lowNow = num(i.quantity) <= num(i.reorder_level);
              const txt = `${num(i.quantity)} ${i.unit}`;
              return lowNow ? el('strong', { text: txt }) : txt;
            } },
          { label: 'Reorder at', align: 'right', cell: (i) => `${num(i.reorder_level)} ${i.unit}` },
          { label: 'Level', cell: (i) => num(i.quantity) <= num(i.reorder_level)
              ? tag('reorder', 'solid') : tag('ok', 'ghost') },
          { label: 'Value', align: 'right', cell: (i) => money(num(i.quantity) * num(i.unit_cost), cur) },
          { label: '', align: 'right', cell: (i) =>
              button('Stock in/out', () => moveStock(i), { quiet: true }) },
        ], rows, {
          onRow: (i) => editItem(i),
          empty: state.q || state.lowOnly ? 'No item matches this filter.' : 'No inventory yet.',
        }),
      ]),

      panel('Recent movements', table([
        { label: 'When', cell: (m) => fmtDate((m.created_at || '').slice(0, 10)) },
        { label: 'Item', cell: (m) => store.item(m.item_id)?.name || '—' },
        { label: 'Reason', cell: (m) => titleCase(m.reason) },
        { label: 'Event', cell: (m) => {
            const b = m.booking_id ? store.booking(m.booking_id) : null;
            return b ? `${b.reference} · ${store.view(b).client_name}` : '—';
          } },
        { label: 'Note', cell: (m) => m.note || '—' },
        { label: 'Change', align: 'right', cell: (m) =>
            el('strong', { text: (num(m.delta) > 0 ? '+' : '') + num(m.delta) }) },
      ], recent, { empty: 'No stock movements recorded yet.' })),
    ]));
  },
};

/* --------------------------------------------------------- item sheet */

function editItem(item) {
  const isNew = !item;
  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() }, [
    field('Item name', 'name', { value: item?.name || '', required: true, span: true }),
    field('SKU', 'sku', { value: item?.sku || '', placeholder: 'MED-KP108' }),
    field('Category', 'category', { type: 'select', options: CATEGORIES, value: item?.category || 'equipment' }),
    field('Unit', 'unit', { value: item?.unit || 'pc', hint: 'pc, box, set, roll…' }),
    field(isNew ? 'Opening quantity' : 'Quantity on hand', 'quantity',
      { type: 'number', step: '0.01', value: item?.quantity ?? 0,
        hint: isNew ? '' : 'Use Stock in/out to keep the movement log honest' }),
    field('Reorder level', 'reorder_level',
      { type: 'number', step: '0.01', value: item?.reorder_level ?? 0 }),
    field('Unit cost', 'unit_cost', { type: 'number', step: '0.01', value: item?.unit_cost ?? 0 }),
    field('Location', 'location', { value: item?.location || '', span: true }),
    field('Notes', 'notes', { type: 'textarea', value: item?.notes || '', span: true, rows: 2 }),
  ]);

  const actions = [button('Save item', async () => {
    const d = readForm(form);
    if (!d.name.trim()) return toast('An item needs a name.', 'err');
    const payload = {
      name: d.name.trim(),
      sku: d.sku.trim() || null,
      category: d.category,
      unit: d.unit.trim() || 'pc',
      quantity: num(d.quantity),
      reorder_level: num(d.reorder_level),
      unit_cost: num(d.unit_cost),
      location: d.location.trim(),
      notes: d.notes.trim(),
      active: true,
    };
    try {
      if (isNew) await store.create('inventory_items', payload);
      else await store.patch('inventory_items', item.id, payload);
      s.close();
      toast(isNew ? 'Item added.' : 'Item saved.');
    } catch (err) { fail(err); }
  }, { solid: true })];

  if (!isNew) {
    actions.unshift(button('Delete', async () => {
      if (!(await confirmSheet(`Delete ${item.name}? Its movement history goes with it.`,
        { title: 'Delete item' }))) return;
      try { await store.destroy('inventory_items', item.id); s.close(); toast('Item deleted.'); }
      catch (err) { fail(err); }
    }, { side: 'left', quiet: true }));
  }

  const body = el('div', { class: 'stack' }, [form]);
  if (!isNew) {
    const history = sortBy(
      store.inventory_movements.filter((m) => String(m.item_id) === String(item.id)),
      (m) => m.created_at || '', -1);
    body.appendChild(el('section', { class: 'frame', style: 'padding:19px' }, [
      el('div', { class: 'panel__head' }, [
        el('span', { class: 'cap cap--muted', text: `Movement history — ${history.length} entries` }),
        button('Stock in/out', () => { s.close(); moveStock(item); }, { quiet: true }),
      ]),
      table([
        { label: 'When', cell: (m) => fmtDate((m.created_at || '').slice(0, 10)) },
        { label: 'Reason', cell: (m) => titleCase(m.reason) },
        { label: 'Note', cell: (m) => m.note || '—' },
        { label: 'Change', align: 'right', cell: (m) => (num(m.delta) > 0 ? '+' : '') + num(m.delta) },
      ], history, { empty: 'No movements for this item yet.' }),
    ]));
  }

  const s = sheet({
    title: isNew ? 'New inventory item' : item.name,
    subtitle: isNew ? 'Inventory' : (item.sku || titleCase(item.category)),
    body, actions,
  });
}

/* ------------------------------------------------------ stock in/out */

export function moveStock(item) {
  const upcoming = store.upcoming(20);

  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() }, [
    field('Direction', 'direction', {
      type: 'select', value: 'in',
      options: [['in', 'Stock in (+)'], ['out', 'Stock out (−)']],
    }),
    field('Quantity', 'qty', { type: 'number', step: '0.01', min: '0', value: 1, required: true }),
    field('Reason', 'reason', { type: 'select', options: MOVE_REASONS, value: 'purchase' }),
    field('Link to event', 'booking_id', {
      type: 'select',
      options: [['', '— None —'],
        ...upcoming.map((b) => [b.id, `${b.reference} · ${b.client_name} · ${fmtDate(b.event_date)}`])],
      value: '',
    }),
    field('Note', 'note', { type: 'textarea', value: '', span: true, rows: 2 }),
  ]);

  const dir = form.querySelector('[name=direction]');
  const reason = form.querySelector('[name=reason]');
  dir.addEventListener('change', () => {
    reason.value = dir.value === 'out' ? 'event_use' : 'purchase';
  });

  const s = sheet({
    title: 'Stock movement',
    subtitle: `${item.name} · ${num(item.quantity)} ${item.unit} on hand`,
    body: form,
    actions: [button('Record movement', async () => {
      const d = readForm(form);
      const qty = Math.abs(num(d.qty));
      if (!qty) return toast('Enter a quantity.', 'err');
      const delta = d.direction === 'out' ? -qty : qty;
      if (num(item.quantity) + delta < 0 &&
          !(await confirmSheet(
            `That takes ${item.name} to ${num(item.quantity) + delta} ${item.unit}. Record it anyway?`,
            { title: 'Negative stock', danger: 'Record' }))) return;
      try {
        await store.addMovement({
          item_id: item.id,
          delta,
          reason: d.reason,
          booking_id: d.booking_id || null,
          note: d.note.trim(),
        });
        s.close();
        toast(`${item.name}: ${delta > 0 ? '+' : ''}${delta} ${item.unit}.`);
      } catch (err) { fail(err); }
    }, { solid: true })],
  });
}

function exportCSV(rows, cur) {
  downloadText('inventory.csv', toCSV(rows, [
    { label: 'SKU', value: (i) => i.sku || '' },
    { label: 'Name', value: (i) => i.name },
    { label: 'Category', value: (i) => i.category },
    { label: 'Unit', value: (i) => i.unit },
    { label: 'On hand', value: (i) => num(i.quantity) },
    { label: 'Reorder level', value: (i) => num(i.reorder_level) },
    { label: `Unit cost (${cur})`, value: (i) => num(i.unit_cost).toFixed(2) },
    { label: `Value (${cur})`, value: (i) => (num(i.quantity) * num(i.unit_cost)).toFixed(2) },
    { label: 'Location', value: (i) => i.location || '' },
  ]));
  toast('inventory.csv downloaded.');
}
