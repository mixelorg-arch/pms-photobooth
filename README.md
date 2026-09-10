# PMS Photobooth — Booking Management System

A browser-based management system for a photobooth business: packages, scheduling,
sales, inventory, a dashboard and an invoice generator. No build step, no framework —
plain ES modules talking to Supabase.

**Live:** https://mixelorg-arch.github.io/pms-photobooth/

---

## What it does

| Section | What it covers |
|---|---|
| **Dashboard** | Cash collected this month, events in the next 30 days, outstanding balance, low stock, and a "needs attention" strip of unconfirmed bookings, unpaid past events and items to reorder. |
| **Scheduling** | Month calendar and list view. Bookings carry client, package, date/time, venue, guest count, status and money. Double-booking warning when a date already has a live event. Payments are recorded on the booking. |
| **Packages** | The price list. Name, code, price, duration, inclusions. Inclusions print on the invoice. Archive rather than delete once a package has been booked. |
| **Sales** | Cash actually received by period, by package and by method; a payment ledger; and a receivables table of everything still owed. |
| **Inventory** | Equipment, consumables, props and backdrops. Quantity is driven by a movement log (stock in / stock out), so the history explains every number. Reorder levels flag low stock. |
| **Invoices** | Generates an invoice from a booking — line items drafted from the package and its inclusions — then prints to paper or PDF. Tax, discount, payments received and balance due are all on the document. |
| **Clients** | Address book with lifetime value, amount owing and each client's booking history. |

Every table view exports CSV.

---

## Setup

### 1. Create the database

Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/yslqfjiiuvcodcmwesxf/sql)
and run [`supabase/schema.sql`](supabase/schema.sql) once. It creates every table, the
reference-number function, the inventory trigger, the RLS policies and a few starter
packages and inventory items. It is safe to run again — nothing is dropped.

### 2. Create your login

In the Supabase dashboard go to **Authentication → Users → Add user**, set an email and
password, and tick *Auto Confirm User*. That is the account you sign in with.

There is no sign-up screen on purpose: this is a back office, not a public app.

### 3. Open the app

Visit the live URL and sign in. That's it.

---

## Security

The publishable (anon) key is in `assets/js/config.js` and this repository is public.
That is safe **only because** every table has row level security enabled with a policy
that requires an authenticated user. Verified against Postgres 17:

- the anon role sees **0 rows** in every table and in `booking_summary`
- the anon role cannot insert (`new row violates row-level security policy`)
- the anon role cannot call `next_number` (it is `security definer`, so execute is
  revoked from `public` and `anon`)
- the authenticated role sees and writes everything

If you ever loosen a policy to `to anon`, the whole database becomes world-writable.
Don't.

---

## Offline / demo mode

If Supabase is unreachable, or you click **Explore with demo data** on the sign-in
screen, the app runs against `localStorage` with a seeded demo business — four packages,
four clients, six bookings, payments and inventory. Every feature works, including
invoice printing. The choice is remembered across reloads; **Settings → Reset demo data**
puts it back, and **Sign in** in the nav returns to the real database.

This exists so the page is never a dead end.

---

## Running locally

Any static file server will do — ES modules need HTTP, not `file://`:

```bash
python3 -m http.server 8731
```

Then open http://localhost:8731.

---

## Layout

```
index.html                  app shell
assets/css/app.css          the whole design system
assets/js/
  config.js                 Supabase URL + publishable key
  util.js                   dates, money, CSV, small helpers
  db.js                     Supabase adapter + localStorage adapter behind one API
  store.js                  domain layer: one snapshot, joins and totals computed in JS
  ui.js                     tables, sheets, fields, tags, bar charts
  app.js                    boot, auth gate, navigation, settings
  views/                    dashboard, scheduling, packages, sales, inventory, invoices, clients
supabase/schema.sql         run this once
```

`db.js` is the only file that knows whether the data is remote or local; `store.js`
computes every join and total in JavaScript so both adapters behave identically.

---

## Design

Built to the [Thomas Hedger "Silent frame, loud prints"](https://styles.refero.design/style/9fe18d8b-58b7-404d-bcc6-9e8a73b8862c)
reference: a closed two-tone palette (`#ffffff`, `#000000`, `#29242b`, `#e5e5e5`), zero
border radius, zero shadows, and a strict 9 / 13 / 19 / 26 px type scale.

The reference forbids semantic colour, so **state is carried by fill and weight instead
of hue** — a confirmed booking is a filled black label, an inquiry is a dashed outline,
a cancelled one is struck through. Charts are hairline bars for the same reason. This is
a deliberate reading of the system rather than a departure from it; if you want a green
"paid" badge, that is the one rule you would be breaking.
