-- =====================================================================
-- PMS PHOTOBOOTH — Booking Management System
-- Supabase schema. Run once in the SQL Editor of the project at
-- https://yslqfjiiuvcodcmwesxf.supabase.co
--
-- Safe to re-run: everything is created with IF NOT EXISTS / OR REPLACE.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Reference counters (BK-2026-0001, INV-2026-0001, ...)
-- ---------------------------------------------------------------------
create table if not exists counters (
  key         text primary key,
  value       integer not null default 0
);

create or replace function next_number(p_key text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into counters (key, value) values (p_key, 1)
  on conflict (key) do update set value = counters.value + 1
  returning value into n;

  return p_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
end;
$$;

-- SECURITY DEFINER bypasses RLS, so keep it away from the anonymous role.
revoke execute on function next_number(text, text) from public, anon;
grant  execute on function next_number(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- touch_updated_at
-- ---------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Company settings (single row, id = 1)
-- ---------------------------------------------------------------------
create table if not exists settings (
  id            integer primary key default 1 check (id = 1),
  company_name  text not null default 'PMS Photobooth',
  tagline       text default 'Photobooth Booking Management',
  address       text default '',
  phone         text default '',
  email         text default '',
  website       text default '',
  tax_id        text default '',
  currency      text not null default 'PHP',
  tax_rate      numeric(5,2) not null default 0,
  invoice_terms text default 'Payable within 7 days. A 50% reservation fee confirms the date.',
  bank_details  text default '',
  updated_at    timestamptz not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company     text default '',
  email       text default '',
  phone       text default '',
  address     text default '',
  notes       text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists clients_name_idx on clients (lower(name));

-- ---------------------------------------------------------------------
-- Packages
-- ---------------------------------------------------------------------
create table if not exists packages (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  description     text default '',
  price           numeric(12,2) not null default 0,
  duration_hours  numeric(4,1) not null default 3,
  inclusions      text[] not null default '{}',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique not null,
  client_id     uuid references clients (id) on delete restrict,
  package_id    uuid references packages (id) on delete set null,
  event_date    date not null,
  start_time    time not null default '18:00',
  end_time      time,
  venue         text default '',
  event_type    text default 'Wedding',
  guest_count   integer default 0,
  status        text not null default 'inquiry'
                check (status in ('inquiry','confirmed','completed','cancelled')),
  package_price numeric(12,2) not null default 0,
  addons_total  numeric(12,2) not null default 0,
  discount      numeric(12,2) not null default 0,
  total_amount  numeric(12,2)
                generated always as
                (coalesce(package_price,0) + coalesce(addons_total,0) - coalesce(discount,0))
                stored,
  notes         text default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists bookings_event_date_idx on bookings (event_date);
create index if not exists bookings_status_idx     on bookings (status);

-- ---------------------------------------------------------------------
-- Payments (Sales)
-- ---------------------------------------------------------------------
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid references bookings (id) on delete cascade,
  amount      numeric(12,2) not null,
  method      text not null default 'cash'
              check (method in ('cash','gcash','maya','bank_transfer','card','other')),
  kind        text not null default 'partial'
              check (kind in ('reservation','partial','full','refund')),
  paid_on     date not null default current_date,
  reference   text default '',
  notes       text default '',
  created_at  timestamptz not null default now()
);

create index if not exists payments_booking_idx on payments (booking_id);
create index if not exists payments_paid_on_idx on payments (paid_on);

-- ---------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------
create table if not exists inventory_items (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique,
  name          text not null,
  category      text not null default 'equipment'
                check (category in ('equipment','consumable','prop','backdrop','other')),
  unit          text not null default 'pc',
  quantity      numeric(12,2) not null default 0,
  reorder_level numeric(12,2) not null default 0,
  unit_cost     numeric(12,2) not null default 0,
  location      text default '',
  notes         text default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists inventory_movements (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references inventory_items (id) on delete cascade,
  delta       numeric(12,2) not null,
  reason      text not null default 'adjustment'
              check (reason in ('purchase','restock','event_use','return','damage','adjustment')),
  booking_id  uuid references bookings (id) on delete set null,
  note        text default '',
  created_at  timestamptz not null default now()
);

create index if not exists inv_moves_item_idx on inventory_movements (item_id);

-- Keep inventory_items.quantity in step with its movements.
create or replace function apply_inventory_movement()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update inventory_items
       set quantity = quantity + new.delta, updated_at = now()
     where id = new.item_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update inventory_items
       set quantity = quantity - old.delta, updated_at = now()
     where id = old.item_id;
    return old;
  elsif (tg_op = 'UPDATE') then
    update inventory_items
       set quantity = quantity - old.delta, updated_at = now()
     where id = old.item_id;
    update inventory_items
       set quantity = quantity + new.delta, updated_at = now()
     where id = new.item_id;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_apply_inventory_movement on inventory_movements;
create trigger trg_apply_inventory_movement
after insert or update or delete on inventory_movements
for each row execute function apply_inventory_movement();

-- ---------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------
create table if not exists invoices (
  id          uuid primary key default gen_random_uuid(),
  number      text unique not null,
  booking_id  uuid references bookings (id) on delete set null,
  client_id   uuid references clients (id) on delete set null,
  issue_date  date not null default current_date,
  due_date    date,
  status      text not null default 'draft'
              check (status in ('draft','sent','paid','void')),
  currency    text not null default 'PHP',
  tax_rate    numeric(5,2) not null default 0,
  discount    numeric(12,2) not null default 0,
  notes       text default '',
  terms       text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices (id) on delete cascade,
  position    integer not null default 0,
  description text not null default '',
  quantity    numeric(12,2) not null default 1,
  unit_price  numeric(12,2) not null default 0,
  amount      numeric(12,2)
              generated always as (coalesce(quantity,0) * coalesce(unit_price,0)) stored
);

create index if not exists invoice_items_invoice_idx on invoice_items (invoice_id, position);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings','clients','packages','bookings','inventory_items','invoices']
  loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$s', t);
    execute format('create trigger trg_touch_%1$s before update on %1$s
                    for each row execute function touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Reporting view: booking + client + package + money position
-- ---------------------------------------------------------------------
create or replace view booking_summary with (security_invoker = true) as
select
  b.*,
  c.name                                as client_name,
  c.email                               as client_email,
  c.phone                               as client_phone,
  p.name                                as package_name,
  p.code                                as package_code,
  coalesce(pay.paid, 0)                 as amount_paid,
  b.total_amount - coalesce(pay.paid, 0) as balance_due
from bookings b
left join clients  c on c.id = b.client_id
left join packages p on p.id = b.package_id
left join lateral (
  select sum(amount) as paid
  from payments
  where booking_id = b.id
) pay on true;

-- ---------------------------------------------------------------------
-- Row Level Security
--
-- The app ships with the PUBLISHABLE (anon) key in a public repository,
-- so anonymous reads/writes are NOT granted. Every policy below requires
-- a signed-in Supabase user. Create your login under
-- Authentication > Users > Add user in the Supabase dashboard.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'counters','settings','clients','packages','bookings','payments',
    'inventory_items','inventory_movements','invoices','invoice_items'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "authenticated_all" on %I', t);
    execute format($f$
      create policy "authenticated_all" on %I
        for all
        to authenticated
        using (true)
        with check (true)
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seed data — starter packages and inventory. Delete what you don't need.
-- ---------------------------------------------------------------------
insert into packages (code, name, description, price, duration_hours, inclusions)
values
  ('PB-BASIC', 'Classic Booth', 'Open-air booth with unlimited 2x6 strips.', 12000, 3,
   array['3 hours unlimited prints','Open-air booth + backdrop','Props box','On-site attendant','Online gallery']),
  ('PB-PLUS',  'Classic Booth Plus', 'Classic booth with 4R prints and a guest book.', 18000, 4,
   array['4 hours unlimited prints','4R borderless prints','Guest scrapbook','Custom print layout','Props box','Online gallery']),
  ('PB-360',   '360 Video Booth', 'Spinning-arm 360 video booth with instant sharing.', 25000, 3,
   array['3 hours unlimited spins','360 platform + LED ring','Instant QR / AirDrop sharing','Custom overlay + music','2 attendants']),
  ('PB-ROAM',  'Roaming Photographer', 'Handheld roaming booth with instant printing.', 15000, 4,
   array['4 hours roaming coverage','Instant 2x6 prints','Custom layout','Edited digital copies'])
on conflict (code) do nothing;

insert into inventory_items (sku, name, category, unit, quantity, reorder_level, unit_cost, location)
values
  ('MED-KP108', 'SELPHY KP-108IN ink + paper', 'consumable', 'set',  12,  6, 1250, 'Studio shelf A'),
  ('MED-2X6',   '2x6 strip media (cut sheets)', 'consumable', 'box',  8,  4,  950, 'Studio shelf A'),
  ('EQP-6D',    'Canon EOS 6D body',            'equipment',  'pc',   2,  1, 45000, 'Dry cabinet'),
  ('EQP-SELPHY','Canon SELPHY CP1500 printer',  'equipment',  'pc',   2,  1,  9500, 'Dry cabinet'),
  ('EQP-360',   '360 spinner platform',         'equipment',  'pc',   1,  1, 60000, 'Storage room'),
  ('BKD-SEQ',   'Sequin backdrop 2.4x2.4m',     'backdrop',   'pc',   3,  1,  3500, 'Storage room'),
  ('PRP-BOX',   'Props box (assorted)',         'prop',       'box',  4,  2,  1800, 'Storage room')
on conflict (sku) do nothing;
