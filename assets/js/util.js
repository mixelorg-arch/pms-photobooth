/* Small helpers shared by every view. */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element. `attrs.html` sets innerHTML, `attrs.text` sets textContent. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }));

/* ---------------------------------------------------------------- money */

export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const CURRENCY_SIGN = { PHP: '₱', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', SGD: 'S$' };
export const sign = (code) => CURRENCY_SIGN[code] || (code ? code + ' ' : '');

export function money(v, code = 'PHP', { decimals = 2 } = {}) {
  const n = num(v);
  const s = Math.abs(n).toLocaleString('en-US',
    { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (n < 0 ? '-' : '') + sign(code) + s;
}

/** Compact figure for stat tiles: 1.2M, 84.5K, 940 */
export function compact(v, code = 'PHP') {
  const n = num(v);
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1_000_000) return s + sign(code) + (a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1) + 'M';
  if (a >= 1_000)     return s + sign(code) + (a / 1_000).toFixed(a >= 10_000 ? 0 : 1) + 'K';
  return money(n, code, { decimals: 0 });
}

/* ----------------------------------------------------------------- date */

export const todayISO = () => toISO(new Date());

export function toISO(d) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/** Parse 'YYYY-MM-DD' as a LOCAL date — `new Date(str)` would read it as UTC. */
export function fromISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export function fmtDate(s, style = 'medium') {
  const d = fromISO(s);
  if (!d) return '—';
  if (style === 'long')  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (style === 'short') return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  if (style === 'dow')   return `${DOW[d.getDay()]} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtTime(t) {
  if (!t) return '';
  const [hRaw, m] = String(t).split(':');
  let h = parseInt(hRaw, 10);
  if (!Number.isFinite(h)) return '';
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m ?? '00'} ${ap}`;
}

/** Whole days from today; negative = past. */
export function daysFromToday(iso) {
  const d = fromISO(iso);
  if (!d) return null;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

export function relativeDay(iso) {
  const n = daysFromToday(iso);
  if (n === null) return '—';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
}

export function addMonths(date, delta) {
  const d = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return d;
}

export const monthLabel = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export const monthKey   = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Add hours to a 'HH:MM' clock time, wrapping past midnight. */
export function addHours(time, hours) {
  const [h, m] = String(time || '18:00').split(':').map(Number);
  const total = (((h * 60 + (m || 0) + Math.round(num(hours) * 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- misc */

export const sortBy = (arr, fn, dir = 1) =>
  [...arr].sort((a, b) => {
    const x = fn(a), y = fn(b);
    if (x === y) return 0;
    return (x > y ? 1 : -1) * dir;
  });

export const sum = (arr, fn = (x) => x) => arr.reduce((t, x) => t + num(fn(x)), 0);

export function groupBy(arr, fn) {
  const map = new Map();
  for (const item of arr) {
    const k = fn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

export const titleCase = (s) =>
  String(s ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function debounce(fn, ms = 220) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Case-insensitive "does this record match the search box" test. */
export function matches(needle, ...fields) {
  const q = String(needle || '').trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}

export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(rows, columns) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(',')).join('\n');
  return head + '\n' + body;
}
