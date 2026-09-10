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

Built to the [Slush "inflatable sticker universe on pastel paper"](https://styles.refero.design/style/8b6b547f-a357-4f1b-9842-4579c62dd42b)
reference:

- **Pastel ground, paper sheet.** The page sits on Sky Wash `#dceeff`; the app
  body is one 30px-rounded white sheet outlined in 1px black.
- **Hand-cut outlines.** Every card, control, tag and sticker carries a 1px
  `#000000` border. That outline is the visual language, not a fallback.
- **Pill everything.** Buttons, nav links, tags and calendar events are fully
  rounded; cards are 20px and sheets 40px. Nothing is square.
- **The six-colour sticker palette used as a set** — Electric Blue, Mint Pop,
  Lavender, Ember, Sunburst, Voltage Violet — appears as card washes, tag fills
  and bar fills, several per screen, rather than one chosen "brand accent".
- **No shadows, no gradients.** Depth comes from colour bands and black outlines.
- **Display type.** Anton (standing in for Lateral, from the reference's own
  fallback list) at crushed 0.8 line-height for page titles, the invoice
  masthead and the hero figure. Body text is Inter for Aeonik Pro, 500/700, with
  0.032em tracking on uppercase UI labels.
- **The marquee earns its place.** The reference's scrolling black band carries
  the business's live numbers — next event, events this week, outstanding
  balance, items to reorder — instead of a slogan.

Two judgement calls worth knowing about:

**Colour is decoration, and the label always carries the meaning.** The
reference is explicit that green is "a sticker accent, not a semantic state".
Booking and invoice status tags do take consistent sticker fills so they are
learnable at a glance, but the word is always printed in the tag — the app reads
identically in greyscale, on a mono printer, or to a colour-blind user. No state
is encoded in hue alone.

**CTAs are black-fill or outlined-black only.** Electric Blue is a decorative
surface colour in this system, never an action colour, so no button or link is
ever blue.
