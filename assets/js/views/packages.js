/* Packages — the price list every booking and invoice draws from. */

import { store } from '../store.js';
import { el, money, num, matches, sortBy, sum, titleCase, toCSV, downloadText } from '../util.js';
import { table, panel, sheet, field, button, readForm, toast, fail,
         confirmSheet, tag, twoLine, search, segment, stickerCluster,
} from '../ui.js';

const state = { q: '', show: 'active' };

export default {
  id: 'packages',
  label: 'Packages',

  render(root) {
    const cur = store.currency;
    const all = sortBy(store.packages, (p) => num(p.price), -1);

    const rows = all.filter((p) =>
      (state.show === 'all' || (state.show === 'active' ? p.active !== false : p.active === false)) &&
      matches(state.q, p.name, p.code, p.description, (p.inclusions || []).join(' ')));

    const live = all.filter((p) => p.active !== false);
    const avg = live.length ? sum(live, (p) => p.price) / live.length : 0;

    // How much each package has actually been booked for.
    const usage = new Map();
    for (const b of store.bookings) {
      if (b.status === 'cancelled') continue;
      const k = String(b.package_id);
      usage.set(k, (usage.get(k) || 0) + 1);
    }

    root.appendChild(el('div', { class: 'view' }, [
      el('div', { class: 'viewhead' }, [
        el('div', { class: 'viewhead__title' }, [
          stickerCluster([['ticket', 'lavender'], ['camera', 'mint'], ['star', 'sun']]),
          el('div', {}, [
            el('span', { class: 'cap cap--muted', text: `${live.length} active · average ${money(avg, cur)}` }),
            el('h1', { text: 'Packages' }),
          ]),
        ]),
        el('div', { class: 'row row--tight' }, [
          button('Export CSV', () => exportCSV(all, cur), { quiet: true }),
          button('New package', () => edit(null), { solid: true }),
        ]),
      ]),

      el('div', { class: 'row', style: 'margin-bottom:24px' }, [
        el('div', { class: 'grow', style: 'max-width:340px' }, [
          search('Search name, code or inclusion…', state.q, (v) => { state.q = v; rerender(); }),
        ]),
        segment([['active', 'Active'], ['archived', 'Archived'], ['all', 'All']],
          state.show, (v) => { state.show = v; rerender(); }),
      ]),

      table([
          { label: 'Package', cell: (p) => twoLine(p.name, p.code) },
          { label: 'Inclusions', cell: (p) => inclusionList(p) },
          { label: 'Duration', cell: (p) => `${num(p.duration_hours)} hrs` },
          { label: 'Booked', cell: (p) => `${usage.get(String(p.id)) || 0}×` },
          { label: 'Status', cell: (p) => tag(p.active === false ? 'archived' : 'active',
              p.active === false ? 'mist' : 'mint') },
          { label: 'Price', align: 'right', cell: (p) => money(p.price, cur) },
        ], rows, {
          onRow: (p) => edit(p),
          empty: state.q ? 'No package matches that search.' : 'No packages yet. Add your first one.',
        }),
    ]));
  },
};

function inclusionList(p) {
  const inc = p.inclusions || [];
  if (!inc.length) return el('span', { class: 'muted', text: '—' });
  const head = inc.slice(0, 2).join(' · ');
  return el('div', {}, [
    el('div', { text: head }),
    inc.length > 2 ? el('span', { class: 'cap cap--muted', text: `+${inc.length - 2} more` }) : null,
  ]);
}

const rerender = () => window.dispatchEvent(new CustomEvent('pms:rerender'));

/* ------------------------------------------------------------- editor */

function edit(pkg) {
  const isNew = !pkg;
  const form = el('form', { class: 'formgrid', onsubmit: (e) => e.preventDefault() });

  const f = {
    name: field('Package name', 'name', { value: pkg?.name || '', required: true, span: true }),
    code: field('Code', 'code', { value: pkg?.code || '', placeholder: 'PB-BASIC', required: true,
      hint: 'Short unique reference' }),
    price: field('Price', 'price', { type: 'number', step: '0.01', min: '0', value: pkg?.price ?? 0 }),
    duration_hours: field('Duration (hours)', 'duration_hours',
      { type: 'number', step: '0.5', min: '0', value: pkg?.duration_hours ?? 3 }),
    active: field('Active', 'active', { type: 'checkbox', value: pkg ? pkg.active !== false : true,
      hint: 'Archived packages stay on old bookings' }),
    description: field('Description', 'description',
      { type: 'textarea', value: pkg?.description || '', span: true, rows: 2 }),
    inclusions: field('Inclusions', 'inclusions', {
      type: 'textarea', span: true, rows: 6,
      value: (pkg?.inclusions || []).join('\n'),
      hint: 'One line per inclusion — these print on the invoice',
    }),
  };
  Object.values(f).forEach((n) => form.appendChild(n));

  const save = async () => {
    const data = readForm(form);
    if (!data.name.trim()) return toast('A package needs a name.', 'err');
    if (!data.code.trim()) return toast('A package needs a code.', 'err');

    const payload = {
      name: data.name.trim(),
      code: data.code.trim().toUpperCase(),
      description: data.description.trim(),
      price: num(data.price),
      duration_hours: num(data.duration_hours),
      active: data.active,
      inclusions: data.inclusions.split('\n').map((s) => s.trim()).filter(Boolean),
    };

    try {
      if (isNew) await store.create('packages', payload);
      else await store.patch('packages', pkg.id, payload);
      s.close();
      toast(isNew ? 'Package added.' : 'Package saved.');
    } catch (err) { fail(err); }
  };

  const actions = [button('Save package', save, { solid: true })];
  if (!isNew) {
    actions.unshift(button('Delete', async () => {
      const used = store.bookings.some((b) => String(b.package_id) === String(pkg.id));
      const msg = used
        ? `${pkg.name} is used by existing bookings. Deleting it leaves those bookings without a package — archive it instead?`
        : `Delete ${pkg.name}? This cannot be undone.`;
      if (!(await confirmSheet(msg, { title: 'Delete package' }))) return;
      try { await store.destroy('packages', pkg.id); s.close(); toast('Package deleted.'); }
      catch (err) { fail(err); }
    }, { side: 'left', quiet: true }));
  }

  const s = sheet({
    title: isNew ? 'New package' : pkg.name,
    subtitle: isNew ? 'Packages' : pkg.code,
    body: form,
    actions,
  });
}

function exportCSV(rows, cur) {
  downloadText('packages.csv', toCSV(rows, [
    { label: 'Code', value: (p) => p.code },
    { label: 'Name', value: (p) => p.name },
    { label: 'Price', value: (p) => num(p.price).toFixed(2) },
    { label: 'Currency', value: () => cur },
    { label: 'Hours', value: (p) => num(p.duration_hours) },
    { label: 'Active', value: (p) => (p.active === false ? 'no' : 'yes') },
    { label: 'Inclusions', value: (p) => (p.inclusions || []).join(' | ') },
  ]));
  toast('packages.csv downloaded.');
}
