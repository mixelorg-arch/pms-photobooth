/* Shared UI pieces, in the sticker-book language: everything is outlined in
   1px black, controls are pills, cards are 20–40px round, and the six-colour
   sticker palette is used as a set. No shadows, no gradients. */

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

/* ----------------------------------------------------------- stickers */

const STICKER_ART = {
  camera: (c) => `<rect x="3" y="7" width="18" height="13" rx="3" fill="${c}" stroke="#000" stroke-width="1.6"/>
                  <path d="M8.5 7l1.6-3h3.8L15.5 7" fill="${c}" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/>
                  <circle cx="12" cy="13.5" r="3.6" fill="#fff" stroke="#000" stroke-width="1.6"/>`,
  coin:   (c) => `<circle cx="12" cy="12" r="8.5" fill="${c}" stroke="#000" stroke-width="1.6"/>
                  <path d="M12 7.5v9M9.6 9.6h4a1.9 1.9 0 010 3.8h-4h4a1.9 1.9 0 010 3.8h-4" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  star:   (c) => `<path d="M12 3.2l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.6l6-.8z" fill="${c}" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/>`,
  check:  (c) => `<circle cx="12" cy="12" r="8.5" fill="${c}" stroke="#000" stroke-width="1.6"/>
                  <path d="M8.2 12.4l2.7 2.7 5-5.4" stroke="#000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  bolt:   (c) => `<path d="M13.6 2.8L5.4 13.4h5l-1 7.8 8.2-10.6h-5z" fill="${c}" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/>`,
  ticket: (c) => `<path d="M3.5 8.5A2 2 0 015.5 6.5h13a2 2 0 012 2v1.6a2 2 0 000 3.8v1.6a2 2 0 01-2 2h-13a2 2 0 01-2-2v-1.6a2 2 0 000-3.8z" fill="${c}" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/>
                  <path d="M13 7.6v8.8" stroke="#000" stroke-width="1.5" stroke-dasharray="2 2"/>`,
  box:    (c) => `<path d="M12 3.4l8 4v9.2l-8 4-8-4V7.4z" fill="${c}" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/>
                  <path d="M4 7.4l8 4 8-4M12 11.4v9.2" stroke="#000" stroke-width="1.5" fill="none"/>`,
  calendar: (c) => `<rect x="3.5" y="5.5" width="17" height="15" rx="3" fill="${c}" stroke="#000" stroke-width="1.6"/>
                  <path d="M3.5 10.5h17M8 3.5v4M16 3.5v4" stroke="#000" stroke-width="1.6" stroke-linecap="round"/>`,
};

const SWATCH = {
  blue: '#4da2ff', mint: '#55db9c', lavender: '#e9ccff',
  ember: '#fb4903', sun: '#ffd731', violet: '#5c4ade', paper: '#ffffff',
};

/** One flat sticker: `sticker('camera', 'ember')`. */
export function sticker(name, tone = 'sun') {
  const art = STICKER_ART[name] || STICKER_ART.star;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = art(SWATCH[tone] || SWATCH.sun);
  return svg;
}

/** A rotated, overlapping cluster — display type never appears alone. */
export function stickerCluster(pairs) {
  return el('div', { class: 'stickers', 'aria-hidden': 'true' },
    pairs.map(([name, tone]) => sticker(name, tone)));
}

/* ------------------------------------------------------------- sheet */

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
    hint ? el('span', { class: 'alt muted', text: hint }) : null,
  ]);
  wrap.input = input;
  return wrap;
}

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

/**
 * State label. Colour is a sticker fill, not the meaning — the word is always
 * there, so the tag reads the same in greyscale or to a colour-blind user.
 */
export function tag(text, tone = 'paper') {
  const cls = tone && tone !== 'paper' ? `tag tag--${tone}` : 'tag';
  return el('span', { class: cls, text: titleCase(text) });
}

export function tagButton(text, tone, onclick) {
  return el('button', { class: tone ? `tag tag--${tone}` : 'tag', text, onclick, type: 'button' });
}

const BOOKING_TONE = {
  confirmed: 'mint',
  inquiry:   'sun',
  completed: 'lavender',
  cancelled: 'mist',
};
export const statusTag = (s) => tag(s, BOOKING_TONE[s] || 'paper');

const INVOICE_TONE = { paid: 'mint', sent: 'sky', draft: 'sun', void: 'mist' };
export const invoiceTag = (s) => tag(s, INVOICE_TONE[s] || 'paper');

export function stat(label, value, note, { large = false, wash = null } = {}) {
  return el('div', { class: 'card' + (wash ? ` card--wash-${wash}` : '') }, [
    el('span', { class: 'cap cap--muted', text: label }),
    el('span', { class: 'stat__value' + (large ? ' stat__value--lg' : ''), text: value }),
    note ? el('span', { class: 'stat__note', text: note }) : null,
  ]);
}

export function panel(title, children, action, { wash = null, flush = false } = {}) {
  return el('section', {
    class: 'card' + (wash ? ` card--wash-${wash}` : '') + (flush ? ' card--flush' : ''),
  }, [
    title
      ? el('div', { class: 'card__head' }, [
          el('span', { class: 'cap cap--muted', text: title }),
          action || null,
        ])
      : null,
    ...[].concat(children),
  ]);
}

/**
 * Data table.
 * columns: [{ label, cell(row) -> node|string, align }]
 */
export function table(columns, rows, { onRow, empty = 'Nothing here yet.' } = {}) {
  if (!rows.length) {
    return el('div', { class: 'tablewrap' }, [el('p', { class: 'empty', text: empty })]);
  }

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

export function twoLine(primary, secondary) {
  return el('div', {}, [
    el('div', { class: 'strong', text: primary }),
    secondary ? el('span', { class: 'cap cap--muted', text: secondary }) : null,
  ]);
}

/** Flat sticker-fill bars — the system forbids gradients. */
export function bars(rows, { format = (v) => String(v), tone = 'blue' } = {}) {
  const peak = Math.max(1, ...rows.map((r) => Math.abs(num(r.value))));
  return el('div', { class: `bars bars--${tone}` }, rows.map((r) =>
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
  return el('div', { class: 'stack', style: 'gap:12px' }, pairs.filter(Boolean).map(([k, v]) =>
    el('div', {}, [
      el('span', { class: 'cap cap--muted', text: k }),
      typeof v === 'string' || typeof v === 'number'
        ? el('div', { class: 'alt', text: String(v) })
        : v,
    ])));
}

export const moneyCell = (v, currency) =>
  el('span', { class: 'num', text: money(v, currency) });
