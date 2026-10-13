-- Run this file once in Supabase SQL Editor.
-- The app uses the public anon key only; row access is limited to the signed-in account.

create extension if not exists pgcrypto;

create table if not exists public.company_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  opening_balance numeric(16, 2) not null default 0,
  opening_balance_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cashflow_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_date date not null,
  category text not null,
  requester text not null default '',
  description text not null default '',
  amount numeric(16, 2) not null check (amount >= 0),
  kind text not null check (kind in ('debit', 'credit')),
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key)
);

create table if not exists public.supplier_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier text not null,
  entry_date date not null,
  entry_type text not null check (entry_type in ('bill', 'payment')),
  amount numeric(16, 2) not null check (amount > 0),
  description text not null default '',
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key)
);

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invoice_date date not null,
  due_date date,
  paid_date date,
  customer text not null,
  invoice_number text not null,
  po_number text not null default '',
  amount numeric(16, 2) not null check (amount >= 0),
  paid_amount numeric(16, 2) not null default 0 check (paid_amount >= 0),
  outstanding_amount numeric(16, 2) check (outstanding_amount is null or outstanding_amount >= 0),
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, invoice_number),
  unique (owner_id, source_key)
);

create table if not exists public.supplier_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  po_number text not null,
  supplier text not null,
  customer text not null default '',
  order_date date not null,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, po_number),
  unique (owner_id, source_key)
);

create table if not exists public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_date date,
  due_date date,
  po_number text not null default '',
  customer text not null,
  item text not null,
  size text not null default '',
  qty_order numeric(16, 2) not null default 0 check (qty_order >= 0),
  qty_produced numeric(16, 2) not null default 0 check (qty_produced >= 0),
  qty_delivered numeric(16, 2) not null default 0 check (qty_delivered >= 0),
  unit_price numeric(16, 2) not null default 0 check (unit_price >= 0),
  amount numeric(16, 2) not null default 0 check (amount >= 0),
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key),
  unique (id, owner_id)
);

create table if not exists public.production_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_order_id uuid not null,
  event_date date not null,
  cause_category text not null check (cause_category in ('administrasi', 'material', 'produksi', 'kualitas', 'pengiriman', 'perubahan-pelanggan', 'lainnya')),
  cause_detail text not null,
  affected_qty numeric(16, 2) not null default 0 check (affected_qty >= 0),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_order_id, owner_id)
    references public.customer_orders(id, owner_id) on delete cascade
);

create index if not exists cashflow_owner_date_idx on public.cashflow_transactions (owner_id, transaction_date desc);
create index if not exists supplier_ledger_owner_idx on public.supplier_ledger_entries (owner_id, supplier, entry_date desc);
create index if not exists invoices_owner_date_idx on public.sales_invoices (owner_id, invoice_date desc);
create index if not exists customer_orders_owner_date_idx on public.customer_orders (owner_id, order_date desc);
create index if not exists production_events_owner_date_idx on public.production_events (owner_id, event_date desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'company_settings', 'cashflow_transactions', 'supplier_ledger_entries',
    'sales_invoices', 'supplier_purchase_orders', 'customer_orders', 'production_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('drop policy if exists account_owner_all on public.%I', table_name);
    execute format(
      'create policy account_owner_all on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      table_name
    );
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      table_name
    );
  end loop;
end $$;

grant select, insert, update, delete on public.company_settings to authenticated;
grant select, insert, update, delete on public.cashflow_transactions to authenticated;
grant select, insert, update, delete on public.supplier_ledger_entries to authenticated;
grant select, insert, update, delete on public.sales_invoices to authenticated;
grant select, insert, update, delete on public.supplier_purchase_orders to authenticated;
grant select, insert, update, delete on public.customer_orders to authenticated;
grant select, insert, update, delete on public.production_events to authenticated;

