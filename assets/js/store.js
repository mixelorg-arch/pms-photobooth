/* =====================================================================
   Domain layer.

   Holds one in-memory snapshot of every table and derives the joins the
   views need (booking -> client / package / payments / balance) in JS, so
   the Supabase and offline adapters behave identically.
   ===================================================================== */

import { db, TABLES } from './db.js';
import { num, sum, sortBy, todayISO, toISO, fromISO, monthKey, uid } from './util.js';

const listeners = new Set();

export const store = {
  settings: null,
  clients: [],
  packages: [],
  bookings: [],
  payments: [],
  inventory_items: [],
  inventory_movements: [],
  invoices: [],
  invoice_items: [],
  loaded: false,

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { for (const fn of listeners) fn(); },

  get currency() { return this.settings?.currency || 'PHP'; },

  async load() {
    const results = await Promise.all(TABLES.map((t) => db.select(t)));
    TABLES.forEach((t, i) => {
      if (t === 'settings') this.settings = results[i][0] || defaultSettings();
      else this[t] = results[i] || [];
    });
    this.loaded = true;
    this.emit();
  },

  /* ------------------------------------------------------------ writes */

  async create(table, row) {
    const rec = await db.insert(table, row);
    this[table] = [...(this[table] || []), rec];
    this.emit();
    return rec;
  },

  async patch(table, id, changes) {
    const rec = await db.update(table, id, changes);
    this[table] = this[table].map((r) => (String(r.id) === String(id) ? rec : r));
    this.emit();
    return rec;
  },

  async destroy(table, id) {
    await db.remove(table, id);
    this[table] = this[table].filter((r) => String(r.id) !== String(id));
    if (table === 'bookings') {
      this.payments = this.payments.filter((p) => String(p.booking_id) !== String(id));
    }
    if (table === 'invoices') {
      this.invoice_items = this.invoice_items.filter((i) => String(i.invoice_id) !== String(id));
    }
    if (table === 'inventory_items') {
      this.inventory_movements = this.inventory_movements
        .filter((m) => String(m.item_id) !== String(id));
    }
    this.emit();
  },

  async saveSettings(changes) {
    if (db.isLocal) {
      const merged = { ...this.settings, ...changes };
      await db.update('settings', 1, merged);
      this.settings = merged;
    } else {
      this.settings = await db.update('settings', 1, changes);
    }
    this.emit();
    return this.settings;
  },

  async nextNumber(key, prefix) {
    try {
      return await db.rpc('next_number', { p_key: key, p_prefix: prefix });
    } catch {
      // The RPC is missing or blocked — fall back to the highest number on file.
      const field = key === 'invoice' ? 'number' : 'reference';
      const list  = key === 'invoice' ? this.invoices : this.bookings;
      const year  = new Date().getFullYear();
      const highest = list.reduce((max, r) => {
        const m = String(r[field] || '').match(/(\d+)\s*$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      return `${prefix}-${year}-${String(highest + 1).padStart(4, '0')}`;
    }
  },

  /** Record an inventory movement and keep the cached quantity in step. */
  async addMovement({ item_id, delta, reason, booking_id = null, note = '' }) {
    const rec = await this.create('inventory_movements',
      { item_id, delta: num(delta), reason, booking_id, note });
    await db.afterMovement(num(delta), item_id, 0);
    const item = this.inventory_items.find((i) => String(i.id) === String(item_id));
    if (item) {
      item.quantity = num(item.quantity) + num(delta);
      this.inventory_items = [...this.inventory_items];
    }
    this.emit();
    return rec;
  },

  /* ------------------------------------------------------- derivations */

  client(id)  { return this.clients.find((c) => String(c.id) === String(id)) || null; },
  package(id) { return this.packages.find((p) => String(p.id) === String(id)) || null; },
  booking(id) { return this.bookings.find((b) => String(b.id) === String(id)) || null; },
  item(id)    { return this.inventory_items.find((i) => String(i.id) === String(id)) || null; },
  invoice(id) { return this.invoices.find((i) => String(i.id) === String(id)) || null; },

  paymentsFor(bookingId) {
    return sortBy(this.payments.filter((p) => String(p.booking_id) === String(bookingId)),
      (p) => p.paid_on, -1);
  },

  itemsFor(invoiceId) {
    return sortBy(this.invoice_items.filter((i) => String(i.invoice_id) === String(invoiceId)),
      (i) => num(i.position));
  },

  /** A booking with its client, package and money position attached. */
  view(booking) {
    if (!booking) return null;
    const paid = sum(this.paymentsFor(booking.id), (p) => p.amount);
    const total = num(booking.total_amount ??
      (num(booking.package_price) + num(booking.addons_total) - num(booking.discount)));
    return {
      ...booking,
      total_amount: total,
      client: this.client(booking.client_id),
      pkg: this.package(booking.package_id),
      client_name: this.client(booking.client_id)?.name || 'Unassigned',
      package_name: this.package(booking.package_id)?.name || '—',
      amount_paid: paid,
      balance_due: total - paid,
      is_settled: total - paid <= 0.005,
    };
  },

  /** Every booking, newest event first, with joins resolved. */
  bookingViews() {
    return sortBy(this.bookings.map((b) => this.view(b)), (b) => b.event_date, -1);
  },

  upcoming(limit = 0) {
    const today = todayISO();
    const list = sortBy(
      this.bookings.filter((b) => b.event_date >= today && b.status !== 'cancelled'),
      (b) => b.event_date + (b.start_time || ''),
    ).map((b) => this.view(b));
    return limit ? list.slice(0, limit) : list;
  },

  bookingsOn(iso) {
    return sortBy(this.bookings.filter((b) => b.event_date === iso), (b) => b.start_time || '')
      .map((b) => this.view(b));
  },

  /** Other live bookings sharing this date — the double-booking guard. */
  clashesFor(iso, exceptId = null) {
    return this.bookings.filter((b) =>
      b.event_date === iso &&
      String(b.id) !== String(exceptId) &&
      b.status !== 'cancelled').map((b) => this.view(b));
  },

  lowStock() {
    return this.inventory_items
      .filter((i) => i.active !== false && num(i.quantity) <= num(i.reorder_level))
      .sort((a, b) => (num(a.quantity) - num(a.reorder_level)) - (num(b.quantity) - num(b.reorder_level)));
  },

  invoiceTotals(invoice) {
    const items = this.itemsFor(invoice.id);
    const subtotal = sum(items, (i) => num(i.amount ?? num(i.quantity) * num(i.unit_price)));
    const discount = num(invoice.discount);
    const taxable  = Math.max(0, subtotal - discount);
    const tax      = taxable * (num(invoice.tax_rate) / 100);
    return { items, subtotal, discount, tax, total: taxable + tax };
  },

  /* ------------------------------------------------------------ money */

  /** Payments received inside [from, to] (ISO dates, inclusive). */
  revenueBetween(from, to) {
    return sum(this.payments.filter((p) => p.paid_on >= from && p.paid_on <= to),
      (p) => p.amount);
  },

  /** Monthly received totals for the last `count` months, oldest first. */
  monthlyRevenue(count = 6) {
    const now = new Date();
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      out.push({
        date: d,
        key,
        total: sum(this.payments.filter((p) => String(p.paid_on).slice(0, 7) === key),
          (p) => p.amount),
      });
    }
    return out;
  },

  /** Total still owed across every non-cancelled booking. */
  outstanding() {
    return sum(
      this.bookings.filter((b) => b.status !== 'cancelled').map((b) => this.view(b)),
      (b) => Math.max(0, b.balance_due),
    );
  },

  /** Booked value (not cash) of events in a month key like '2026-09'. */
  pipelineFor(key) {
    return sum(
      this.bookings.filter((b) => b.status !== 'cancelled' && b.event_date.slice(0, 7) === key),
      (b) => num(b.total_amount),
    );
  },
};

function defaultSettings() {
  return {
    id: 1,
    company_name: 'PMS Photobooth',
    tagline: 'Photobooth Booking Management',
    address: '', phone: '', email: '', website: '', tax_id: '',
    currency: 'PHP', tax_rate: 0,
    invoice_terms: 'Payable within 7 days. A 50% reservation fee confirms the date.',
    bank_details: '',
  };
}

export const STATUS = ['inquiry', 'confirmed', 'completed', 'cancelled'];
export const PAY_METHODS = ['cash', 'gcash', 'maya', 'bank_transfer', 'card', 'other'];
export const PAY_KINDS = ['reservation', 'partial', 'full', 'refund'];
export const CATEGORIES = ['equipment', 'consumable', 'prop', 'backdrop', 'other'];
export const MOVE_REASONS = ['purchase', 'restock', 'event_use', 'return', 'damage', 'adjustment'];
export const INVOICE_STATUS = ['draft', 'sent', 'paid', 'void'];
export const EVENT_TYPES = ['Wedding', 'Debut', 'Birthday', 'Corporate', 'Anniversary',
  'Christening', 'Reunion', 'Graduation', 'Other'];
