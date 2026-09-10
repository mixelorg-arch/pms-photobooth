/* Shared UI pieces. Everything here obeys the flat two-tone system:
   no radius, no shadow, no hue — state is carried by fill and weight. */

import { el, titleCase, money, num } from './util.js';

/* ------------------------------------------------------------- toast */

let toastTimer = null;

export function toast(message, kind = 'ok') {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: 'toast' + (kind === 'err' ? ' toast--err' : ''), text: message });
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), kind === 'err' ? 6000 : 3000);
}

export const fail = (err) => {
  console.error(err);
  toast(err?.message || String(err), 'err');
};

/* ------------------------------------------------------------- sheet */

/**
 * Open a modal sheet. `body` is a node; `actions` are buttons for the footer.
 * Returns { close }.
 */
export function sheet({ title, subtitle, body, actions = [], wide = false, onClose }) {
  const scrim = el('div', { class: 'scrim' });

  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const box = el('div', { class: 'sheet' + (wide ? ' sheet--wide' : '') }, [
    el('div', { class: 'sheet__head' }, [
      el('div', {}, [
        subtitle ? el('span', { class: 'cap cap--muted', text: subtitle }) : null,
        el('h2', { text: title }),
      ]),
      el('button', { class: 'btn btn--icon no-print', text: 'Close', onclick: close }),
    ]),
    el('div', { class: 'sheet__body' }, [body]),
    actions.length
      ? el('div', { class: 'sheet__foot no-print' }, [
          el('div', { class: 'row row--tight' }, actions.filter((a) => a?.dataset?.side === 'left')),
          el('div', { class: 'row row--tight' }, actions.filter((a) => a?.dataset?.side !== 'left')),
        ])
      : null,
  ]);

  scrim.appendChild(box);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.appendChild(scrim);
  box.querySelector('input, select, textarea')?.focus();

  return { close, box };
}

export function confirmSheet(message, { title = 'Confirm', danger = 'Delete' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const s = sheet({
      title,
      body: el('p', { text: message, style: 'margin:0' }),
      actions: [
        button('Cancel', () => { done(false); s.close(); }, { side: 'left', quiet: true }),
        button(danger, () => { done(true); s.close(); }, { solid: true }),
      ],
      onClose: () => done(false),
    });
  });
}

/* ----------------------------------------------------------- controls */

export function button(label, onclick, { solid, quiet, side, type = 'button', disabled } = {}) {
  const b = el('button', {
    class: 'btn' + (solid ? ' btn--solid' : '') + (quiet ? ' btn--quiet' : ''),
    type, text: label, onclick, disabled,
  });
  if (side) b.dataset.side = side;
  return b;
}

/** A labelled control. `type` accepts any input type plus 'select' and 'textarea'. */
export function field(label, name, opts = {}) {
  const {
    type = 'text', value = '', options = [], span = false, required = false,
    placeholder = '', step, min, max, rows, hint, disabled = false,
  } = opts;

  let input;
  if (type === 'select') {
    input = el('select', { name, disabled, required });
    for (const o of options) {
      const [val, text] = Array.isArray(o) ? o : [o, titleCase(o)];
      input.appendChild(el('option', { value: val, text, selected: String(val) === String(value) }));
    }
    input.value = value ?? '';
  } else if (type === 'textarea') {
    input = el('textarea', { name, placeholder, rows: rows || 3, disabled });
    input.value = value ?? '';
  } else if (type === 'checkbox') {
    input = el('input', { type: 'checkbox', name, disabled });
    input.checked = !!value;
  } else {
    input = el('input', { type, name, placeholder, required, disabled, step, min, max });
    input.value = value ?? '';
  }

  const wrap = el('div', { class: 'field' + (span ? ' span2' : '') }, [
    el('label', { for: name, text: label }),
    input,
    hint ? el('span', { class: 'cap cap--muted', text: hint }) : null,
  ]);
  wrap.input = input;
  return wrap;
}

/** Read a form into a plain object. Checkboxes come back boolean. */
export function readForm(form) {
  const out = {};
  for (const node of form.querySelectorAll('input, select, textarea')) {
    if (!node.name) continue;
    out[node.name] = node.type === 'checkbox' ? node.checked : node.value;
  }
  return out;
}

export function segment(values, current, onPick) {
  const box = el('div', { class: 'segment' });
  for (const v of values) {
    const [val, label] = Array.isArray(v) ? v : [v, titleCase(v)];
    box.appendChild(el('button', {
      type: 'button', text: label,
      'aria-pressed': String(val) === String(current),
      onclick: () => onPick(val),
    }));
  }
  return box;
}

export function search(placeholder, value, onInput) {
  const input = el('input', { type: 'search', placeholder, value });
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

/* ------------------------------------------------------------ display */

/** State label. Emphasis is fill + weight, never colour. */
export function tag(text, style = 'ghost') {
  const cls = style === 'solid' ? 'tag tag--solid'
            : style === 'rule'  ? 'tag tag--rule'
            : style === 'plain' ? 'tag'
            : 'tag tag--ghost';
  return el('span', { class: cls, text: titleCase(text) });
}

const BOOKING_TAG = {
  confirmed: 'solid',
  completed: 'plain',
  inquiry:   'rule',
  cancelled: 'ghost',
};
export const statusTag = (s) => tag(s, BOOKING_TAG[s] || 'ghost');

const INVOICE_TAG = { paid: 'solid', sent: 'plain', draft: 'rule', void: 'ghost' };
export const invoiceTag = (s) => tag(s, INVOICE_TAG[s] || 'ghost');

export function stat(label, value, note, { large = false } = {}) {
  return el('div', { class: 'panel' }, [
    el('span', { class: 'cap cap--muted', text: label }),
    el('span', { class: 'stat__value' + (large ? ' stat__value--lg' : ''), text: value }),
    note ? el('span', { class: 'stat__note', text: note }) : null,
  ]);
}

export function panel(title, children, action) {
  return el('section', { class: 'panel' }, [
    title
      ? el('div', { class: 'panel__head' }, [
          el('span', { class: 'cap cap--muted', text: title }),
          action || null,
        ])
      : null,
    ...[].concat(children),
  ]);
}

/**
 * Data table.
 * columns: [{ label, cell(row) -> node|string, align, width }]
 */
export function table(columns, rows, { onRow, empty = 'Nothing here yet.' } = {}) {
  if (!rows.length) return el('p', { class: 'empty', text: empty });

  const thead = el('thead', {}, [
    el('tr', {}, columns.map((c) =>
      el('th', { text: c.label, style: c.align === 'right' ? 'text-align:right' : null }))),
  ]);

  const tbody = el('tbody', {}, rows.map((row) => {
    const tr = el('tr', { class: onRow ? 'is-clickable' : null }, columns.map((c) => {
      const v = c.cell(row);
      return el('td', {
        style: c.align === 'right' ? 'text-align:right' : null,
        class: c.align === 'right' ? 'num' : null,
      }, [typeof v === 'string' || typeof v === 'number' ? String(v) : v]);
    }));
    if (onRow) {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input, select')) return;
        onRow(row);
      });
    }
    return tr;
  }));

  return el('div', { class: 'tablewrap' }, [el('table', { class: 'data' }, [thead, tbody])]);
}

/** Two lines in one cell: a strong primary and a quiet caption. */
export function twoLine(primary, secondary) {
  return el('div', {}, [
    el('div', { class: 'strong', text: primary }),
    secondary ? el('span', { class: 'cap cap--muted', text: secondary }) : null,
  ]);
}

/** Horizontal hairline bar chart — the only chart form this system allows. */
export function bars(rows, { format = (v) => String(v) } = {}) {
  const peak = Math.max(1, ...rows.map((r) => Math.abs(num(r.value))));
  return el('div', { class: 'bars' }, rows.map((r) =>
    el('div', {}, [
      el('div', { class: 'bar__label' }, [
        el('span', { text: r.label }),
        el('span', { class: 'num', text: format(r.value) }),
      ]),
      el('div', { class: 'bar__track' }, [
        el('div', { class: 'bar__fill', style: `width:${(Math.abs(num(r.value)) / peak) * 100}%` }),
      ]),
    ])));
}

export function keyValue(pairs) {
  return el('div', { class: 'stack', style: 'gap:9px' }, pairs.filter(Boolean).map(([k, v]) =>
    el('div', {}, [
      el('span', { class: 'cap cap--muted', text: k }),
      typeof v === 'string' || typeof v === 'number'
        ? el('div', { class: 'alt', text: String(v) })
        : v,
    ])));
}

export const moneyCell = (v, currency) =>
  el('span', { class: 'num', text: money(v, currency) });
