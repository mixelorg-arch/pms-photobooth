/* =====================================================================
   Data access.

   Two interchangeable adapters behind one API:
     supabase — the real project, gated by Supabase Auth + RLS
     local    — localStorage, seeded with demo rows, so the page is never
                a dead end when the network or the schema is missing
   ===================================================================== */

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { uid, todayISO, num } from './util.js';

export const TABLES = [
  'settings', 'clients', 'packages', 'bookings', 'payments',
  'inventory_items', 'inventory_movements', 'invoices', 'invoice_items',
];

/** Columns Postgres generates for us — never send them on write. */
const GENERATED = {
  bookings:      ['total_amount'],
  invoice_items: ['amount'],
};

const READONLY = ['created_at'];

function scrub(table, row) {
  const out = { ...row };
  for (const k of [...(GENERATED[table] || []), ...READONLY]) delete out[k];
  return out;
}

/* ------------------------------------------------------------------ */
/* Local adapter                                                       */
/* ------------------------------------------------------------------ */

const LS_KEY = 'pms.photobooth.local.v1';
const LS_MODE = 'pms.photobooth.mode';

const localState = {
  data: null,
  load() {
    if (this.data) return this.data;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { this.data = JSON.parse(raw); return this.data; }
    } catch { /* fall through to seed */ }
    this.data = seed();
    this.save();
    return this.data;
  },
  save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch { /* quota */ }
  },
  reset() { this.data = seed(); this.save(); },
};

function computeGenerated(table, row) {
  if (table === 'bookings') {
    row.total_amount = num(row.package_price) + num(row.addons_total) - num(row.discount);
  }
  if (table === 'invoice_items') {
    row.amount = num(row.quantity) * num(row.unit_price);
  }
  return row;
}

const localAdapter = {
  mode: 'local',
  async select(table) {
    return [...(localState.load()[table] || [])];
  },
  async insert(table, row) {
    const data = localState.load();
    data[table] = data[table] || [];
    const rec = computeGenerated(table, {
      id: row.id || uid(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...scrub(table, row),
    });
    data[table].push(rec);
    localState.save();
    return rec;
  },
  async update(table, id, patch) {
    const data = localState.load();
    const list = data[table] || [];
    const i = list.findIndex((r) => String(r.id) === String(id));
    if (i < 0) throw new Error(`${table}: no row ${id}`);
    list[i] = computeGenerated(table, {
      ...list[i], ...scrub(table, patch), updated_at: new Date().toISOString(),
    });
    localState.save();
    return list[i];
  },
  async remove(table, id) {
    const data = localState.load();
    data[table] = (data[table] || []).filter((r) => String(r.id) !== String(id));
    // Emulate the cascades the database would perform for us.
    if (table === 'bookings') {
      data.payments = (data.payments || []).filter((p) => String(p.booking_id) !== String(id));
    }
    if (table === 'invoices') {
      data.invoice_items = (data.invoice_items || [])
        .filter((it) => String(it.invoice_id) !== String(id));
    }
    if (table === 'inventory_items') {
      data.inventory_movements = (data.inventory_movements || [])
        .filter((m) => String(m.item_id) !== String(id));
    }
    localState.save();
    return true;
  },
  async rpc(fn, args = {}) {
    if (fn === 'next_number') {
      const data = localState.load();
      data.counters = data.counters || {};
      const key = args.p_key;
      data.counters[key] = (data.counters[key] || 0) + 1;
      localState.save();
      return `${args.p_prefix}-${new Date().getFullYear()}-${String(data.counters[key]).padStart(4, '0')}`;
    }
    throw new Error(`rpc ${fn} is not available offline`);
  },
  /** Movements drive item quantity in Postgres via trigger; mirror that here. */
  async afterMovement(delta, itemId, previous = 0) {
    const data = localState.load();
    const item = (data.inventory_items || []).find((i) => String(i.id) === String(itemId));
    if (item) { item.quantity = num(item.quantity) - num(previous) + num(delta); localState.save(); }
  },
};

/* ------------------------------------------------------------------ */
/* Supabase adapter                                                    */
/* ------------------------------------------------------------------ */

function supabaseAdapter(client) {
  const unwrap = ({ data, error }) => {
    if (error) throw decorate(error);
    return data;
  };
  return {
    mode: 'supabase',
    client,
    async select(table) {
      return unwrap(await client.from(table).select('*')) || [];
    },
    async insert(table, row) {
      return unwrap(await client.from(table).insert(scrub(table, row)).select().single());
    },
    async update(table, id, patch) {
      return unwrap(await client.from(table).update(scrub(table, patch)).eq('id', id).select().single());
    },
    async remove(table, id) {
      unwrap(await client.from(table).delete().eq('id', id));
      return true;
    },
    async rpc(fn, args = {}) {
      return unwrap(await client.rpc(fn, args));
    },
    async afterMovement() { /* the database trigger already did it */ },
  };
}

function decorate(error) {
  const e = new Error(error.message || 'Database error');
  e.code = error.code;
  if (error.code === 'PGRST205' || error.code === '42P01') {
    e.message = 'The database tables are missing. Run supabase/schema.sql in the Supabase SQL Editor.';
  } else if (error.code === '42501' || /row-level security/i.test(error.message || '')) {
    e.message = 'Blocked by row level security — sign in again, or re-run supabase/schema.sql.';
  }
  return e;
}

/* ------------------------------------------------------------------ */
/* Public façade                                                       */
/* ------------------------------------------------------------------ */

export const db = {
  adapter: localAdapter,
  client: null,
  user: null,
  get mode() { return this.adapter.mode; },
  get isLocal() { return this.adapter.mode === 'local'; },

  /** Load supabase-js and restore any existing session. Never throws. */
  async connect() {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
      this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pms.photobooth.auth' },
      });
      const { data } = await this.client.auth.getSession();
      if (data?.session?.user) {
        this.user = data.session.user;
        this.adapter = supabaseAdapter(this.client);
      }
      return true;
    } catch (err) {
      console.warn('Supabase unavailable:', err);
      this.client = null;
      return false;
    }
  },

  /** True when the operator chose demo mode last time — survives a reload. */
  prefersLocal() {
    try { return localStorage.getItem(LS_MODE) === 'local'; } catch { return false; }
  },

  async signIn(email, password) {
    if (!this.client) throw new Error('Cannot reach Supabase from this browser.');
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    this.user = data.user;
    this.adapter = supabaseAdapter(this.client);
    try { localStorage.removeItem(LS_MODE); } catch { /* ignore */ }
    return data.user;
  },

  async signOut() {
    if (this.client) { try { await this.client.auth.signOut(); } catch { /* ignore */ } }
    this.user = null;
    this.adapter = localAdapter;
    try { localStorage.removeItem(LS_MODE); } catch { /* ignore */ }
  },

  useLocal() {
    this.user = null;
    this.adapter = localAdapter;
    try { localStorage.setItem(LS_MODE, 'local'); } catch { /* ignore */ }
  },

  resetLocal() { localState.reset(); },

  select(t)          { return this.adapter.select(t); },
  insert(t, row)     { return this.adapter.insert(t, row); },
  update(t, id, p)   { return this.adapter.update(t, id, p); },
  remove(t, id)      { return this.adapter.remove(t, id); },
  rpc(fn, args)      { return this.adapter.rpc(fn, args); },
  afterMovement(...a) { return this.adapter.afterMovement(...a); },
};

/* ------------------------------------------------------------------ */
/* Demo seed for offline mode                                          */
/* ------------------------------------------------------------------ */

function shift(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seed() {
  const pk = (code, name, description, price, hours, inclusions) =>
    ({ id: uid(), code, name, description, price, duration_hours: hours,
       inclusions, active: true, created_at: new Date().toISOString() });

  const packages = [
    pk('PB-BASIC', 'Classic Booth', 'Open-air booth with unlimited 2x6 strips.', 12000, 3,
      ['3 hours unlimited prints', 'Open-air booth + backdrop', 'Props box', 'On-site attendant', 'Online gallery']),
    pk('PB-PLUS', 'Classic Booth Plus', 'Classic booth with 4R prints and a guest book.', 18000, 4,
      ['4 hours unlimited prints', '4R borderless prints', 'Guest scrapbook', 'Custom print layout', 'Props box', 'Online gallery']),
    pk('PB-360', '360 Video Booth', 'Spinning-arm 360 video booth with instant sharing.', 25000, 3,
      ['3 hours unlimited spins', '360 platform + LED ring', 'Instant QR / AirDrop sharing', 'Custom overlay + music', '2 attendants']),
    pk('PB-ROAM', 'Roaming Photographer', 'Handheld roaming booth with instant printing.', 15000, 4,
      ['4 hours roaming coverage', 'Instant 2x6 prints', 'Custom layout', 'Edited digital copies']),
  ];

  const clients = [
    { id: uid(), name: 'Andrea & Miguel Reyes', company: '', email: 'andrea.reyes@example.com', phone: '0917 555 0142', address: 'Alabang, Muntinlupa', notes: 'Referred by Casa Blanca events.' },
    { id: uid(), name: 'Bella Santos',          company: 'Northwind Corp.', email: 'bsantos@northwind.example', phone: '0918 555 0199', address: 'BGC, Taguig', notes: 'Company Christmas party, annual.' },
    { id: uid(), name: 'Cruz Family',           company: '', email: 'joncruz@example.com', phone: '0920 555 0173', address: 'Quezon City', notes: 'Debut — 18 roses segment at 8pm.' },
    { id: uid(), name: 'Mabuhay Realty',        company: 'Mabuhay Realty Inc.', email: 'events@mabuhay.example', phone: '02 8555 0110', address: 'Ortigas, Pasig', notes: 'Needs an official receipt with TIN.' },
  ].map((c) => ({ ...c, created_at: new Date().toISOString() }));

  const bk = (n, client, pkg, date, time, venue, type, guests, status, addons = 0, discount = 0, notes = '') => ({
    id: uid(),
    reference: `BK-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`,
    client_id: client.id,
    package_id: pkg.id,
    event_date: date,
    start_time: time,
    end_time: null,
    venue, event_type: type, guest_count: guests, status,
    package_price: pkg.price, addons_total: addons, discount,
    total_amount: pkg.price + addons - discount,
    notes,
    created_at: new Date().toISOString(),
  });

  const bookings = [
    bk(1, clients[0], packages[1], shift(12), '17:00', 'Casa Blanca Garden, Tagaytay', 'Wedding', 180, 'confirmed', 3500, 0, 'Cream backdrop. Ceremony ends 4:30pm.'),
    bk(2, clients[1], packages[2], shift(26), '19:00', 'Grand Ballroom, Shangri-La BGC', 'Corporate', 250, 'confirmed', 0, 2000, 'Brand overlay supplied by their marketing team.'),
    bk(3, clients[2], packages[0], shift(5),  '18:30', 'Blue Leaf Filipinas, Paranaque', 'Debut', 120, 'confirmed', 1500, 0, 'Pink sequin backdrop requested.'),
    bk(4, clients[3], packages[3], shift(48), '10:00', 'Mabuhay Tower Lobby, Ortigas', 'Corporate', 90, 'inquiry', 0, 0, 'Awaiting their board approval.'),
    bk(5, clients[0], packages[0], shift(-21), '16:00', 'San Antonio Parish Hall, Makati', 'Anniversary', 60, 'completed', 0, 1000, 'Delivered on time. Client happy.'),
    bk(6, clients[1], packages[1], shift(-54), '18:00', 'Seda Hotel, BGC', 'Corporate', 140, 'completed', 2500, 0, ''),
  ];

  const pay = (booking, amount, kind, method, daysAgo, ref = '') => ({
    id: uid(), booking_id: booking.id, amount, kind, method,
    paid_on: shift(-daysAgo), reference: ref, notes: '', created_at: new Date().toISOString(),
  });

  const payments = [
    pay(bookings[0], 10750, 'reservation', 'gcash', 20, 'GC-88213'),
    pay(bookings[1], 11500, 'reservation', 'bank_transfer', 14, 'BPI-4471'),
    pay(bookings[2], 6750, 'reservation', 'gcash', 9, 'GC-88540'),
    pay(bookings[2], 6750, 'partial', 'cash', 2, ''),
    pay(bookings[4], 11000, 'full', 'cash', 21, ''),
    pay(bookings[5], 20500, 'full', 'bank_transfer', 54, 'BPI-4102'),
  ];

  const item = (sku, name, category, unit, quantity, reorder, cost, location) =>
    ({ id: uid(), sku, name, category, unit, quantity, reorder_level: reorder,
       unit_cost: cost, location, notes: '', active: true, created_at: new Date().toISOString() });

  const inventory_items = [
    item('MED-KP108', 'SELPHY KP-108IN ink + paper', 'consumable', 'set', 4, 6, 1250, 'Studio shelf A'),
    item('MED-2X6', '2x6 strip media (cut sheets)', 'consumable', 'box', 8, 4, 950, 'Studio shelf A'),
    item('EQP-6D', 'Canon EOS 6D body', 'equipment', 'pc', 2, 1, 45000, 'Dry cabinet'),
    item('EQP-SELPHY', 'Canon SELPHY CP1500 printer', 'equipment', 'pc', 2, 1, 9500, 'Dry cabinet'),
    item('EQP-360', '360 spinner platform', 'equipment', 'pc', 1, 1, 60000, 'Storage room'),
    item('BKD-SEQ', 'Sequin backdrop 2.4x2.4m', 'backdrop', 'pc', 3, 1, 3500, 'Storage room'),
    item('PRP-BOX', 'Props box (assorted)', 'prop', 'box', 4, 2, 1800, 'Storage room'),
  ];

  return {
    settings: [{
      id: 1,
      company_name: 'PMS Photobooth',
      tagline: 'Photobooth Booking Management',
      address: 'Metro Manila, Philippines',
      phone: '0917 000 0000',
      email: 'hello@pmsphotobooth.example',
      website: 'pmsphotobooth.example',
      tax_id: '',
      currency: 'PHP',
      tax_rate: 0,
      invoice_terms: 'Payable within 7 days. A 50% reservation fee confirms the date.',
      bank_details: 'GCash 0917 000 0000 — PMS Photobooth',
    }],
    clients, packages, bookings, payments,
    inventory_items,
    inventory_movements: [],
    invoices: [],
    invoice_items: [],
    counters: { booking: 6, invoice: 0 },
  };
}
