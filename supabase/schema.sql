-- Run this script in Supabase SQL Editor.
-- Existing accounts are connected to one shared company workspace. New accounts
-- start as staff and remain pending until a developer grants workspace access.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.workspaces (id, name)
values ('a38a0000-0000-4000-8000-000000000001', 'CV Surya Pratama Mandiri')
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'staff' check (role in ('developer', 'staff')),
  workspace_id uuid references public.workspaces(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Existing users are company accounts. The named developer account is promoted
-- here even if it was created before this schema was installed.
insert into public.profiles (id, email, role, workspace_id)
select
  u.id,
  coalesce(u.email, ''),
  case when lower(coalesce(u.email, '')) = 'dev@spm.com' then 'developer' else 'staff' end,
  case when lower(coalesce(u.email, '')) = 'dev@spm.com'
    then 'a38a0000-0000-4000-8000-000000000001'::uuid
    else 'a38a0000-0000-4000-8000-000000000001'::uuid
  end
from auth.users u
on conflict (id) do update set
  email = excluded.email,
  role = case when lower(excluded.email) = 'dev@spm.com' then 'developer' else public.profiles.role end,
  workspace_id = case when lower(excluded.email) = 'dev@spm.com'
    then 'a38a0000-0000-4000-8000-000000000001'::uuid
    else public.profiles.workspace_id
  end;

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.workspace_id
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, role, workspace_id)
  values (
    new.id,
    coalesce(new.email, ''),
    case when lower(coalesce(new.email, '')) = 'dev@spm.com' then 'developer' else 'staff' end,
    case when lower(coalesce(new.email, '')) = 'dev@spm.com'
      then 'a38a0000-0000-4000-8000-000000000001'::uuid
      else null
    end
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table if not exists public.company_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  opening_balance numeric(16, 2) not null default 0,
  opening_balance_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cashflow_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  transaction_date date not null,
  category text not null,
  requester text not null default '',
  description text not null default '',
  amount numeric(16, 2) not null check (amount >= 0),
  kind text not null check (kind in ('debit', 'credit')),
  supplier_bill_id uuid,
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key)
);

create table if not exists public.supplier_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  supplier text not null,
  entry_date date not null,
  entry_type text not null check (entry_type in ('bill', 'payment')),
  amount numeric(16, 2) not null check (amount > 0),
  description text not null default '',
  linked_bill_id uuid,
  cashflow_transaction_id uuid,
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key)
);

alter table public.supplier_ledger_entries
  add column if not exists linked_bill_id uuid;

alter table public.cashflow_transactions
  add column if not exists supplier_bill_id uuid;

alter table public.supplier_ledger_entries
  add column if not exists cashflow_transaction_id uuid;

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
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

create table if not exists public.customer_receivable_baselines (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  captured_at timestamptz not null default clock_timestamp(),
  opening_balance numeric(16, 2) not null default 0
);

create table if not exists public.customer_receivable_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null,
  cashflow_transaction_id uuid references public.cashflow_transactions(id) on delete set null,
  event_date date,
  event_type text not null check (event_type in ('invoice', 'payment', 'adjustment')),
  balance_delta numeric(16, 2) not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists customer_receivable_events_workspace_date_idx
  on public.customer_receivable_events (workspace_id, event_date, id);
create index if not exists customer_receivable_events_workspace_invoice_idx
  on public.customer_receivable_events (workspace_id, invoice_id, id);
create index if not exists customer_receivable_events_cashflow_idx
  on public.customer_receivable_events (cashflow_transaction_id)
  where cashflow_transaction_id is not null;

create table if not exists public.supplier_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
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
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
  order_date date,
  due_date date,
  po_number text not null default '',
  customer text not null,
  spm_skg text not null default '',
  item text not null,
  size text not null default '',
  qty_order numeric(16, 2) not null default 0 check (qty_order >= 0),
  qty_produced numeric(16, 2) not null default 0 check (qty_produced >= 0),
  qty_delivered numeric(16, 2) not null default 0 check (qty_delivered >= 0),
  unit_price numeric(16, 2) not null default 0 check (unit_price >= 0),
  amount numeric(16, 2) not null default 0 check (amount >= 0),
  po_tax_amount numeric(16, 2) not null default 0 check (po_tax_amount >= 0),
  total_price numeric(16, 2) not null default 0 check (total_price >= 0),
  size_sheet text not null default '',
  floot text not null default '',
  score text not null default '',
  height text not null default '',
  score_secondary text not null default '',
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key),
  unique (id, owner_id)
);

create table if not exists public.production_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null default public.current_workspace_id() references public.workspaces(id) on delete cascade,
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

-- Add workspace columns and backfill them when upgrading the previous owner-only schema.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'company_settings', 'cashflow_transactions', 'supplier_ledger_entries',
    'sales_invoices', 'supplier_purchase_orders', 'customer_orders', 'production_events'
  ] loop
    execute format('alter table public.%I add column if not exists workspace_id uuid', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'company_settings', 'cashflow_transactions', 'supplier_ledger_entries',
    'sales_invoices', 'supplier_purchase_orders', 'customer_orders', 'production_events'
  ] loop
    execute format(
      'update public.%I t set workspace_id = p.workspace_id from public.profiles p where t.owner_id = p.id and t.workspace_id is null',
      table_name
    );
    execute format('alter table public.%I alter column workspace_id set default public.current_workspace_id()', table_name);
    execute format('alter table public.%I alter column workspace_id set not null', table_name);
    execute format(
      'create index if not exists %I on public.%I (workspace_id)',
      table_name || '_workspace_idx', table_name
    );
  end loop;
end $$;

create unique index if not exists company_settings_workspace_uidx on public.company_settings (workspace_id);
create unique index if not exists cashflow_workspace_source_uidx on public.cashflow_transactions (workspace_id, source_key);
create unique index if not exists cashflow_id_workspace_uidx on public.cashflow_transactions (id, workspace_id);
create unique index if not exists supplier_ledger_workspace_source_uidx on public.supplier_ledger_entries (workspace_id, source_key);
create unique index if not exists supplier_ledger_id_workspace_uidx on public.supplier_ledger_entries (id, workspace_id);
create index if not exists supplier_ledger_linked_bill_idx
  on public.supplier_ledger_entries (workspace_id, linked_bill_id)
  where entry_type = 'payment' and linked_bill_id is not null;
create unique index if not exists sales_invoices_workspace_number_uidx on public.sales_invoices (workspace_id, invoice_number);
create unique index if not exists sales_invoices_workspace_source_uidx on public.sales_invoices (workspace_id, source_key);
create unique index if not exists supplier_po_workspace_number_uidx on public.supplier_purchase_orders (workspace_id, po_number);
create unique index if not exists supplier_po_workspace_source_uidx on public.supplier_purchase_orders (workspace_id, source_key);
create unique index if not exists customer_orders_workspace_source_uidx on public.customer_orders (workspace_id, source_key);
create unique index if not exists customer_orders_id_workspace_uidx on public.customer_orders (id, workspace_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_ledger_linked_bill_workspace_fkey'
      and conrelid = 'public.supplier_ledger_entries'::regclass
  ) then
    alter table public.supplier_ledger_entries
      add constraint supplier_ledger_linked_bill_workspace_fkey
      foreign key (linked_bill_id, workspace_id)
      references public.supplier_ledger_entries (id, workspace_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_ledger_linked_bill_payment_check'
      and conrelid = 'public.supplier_ledger_entries'::regclass
  ) then
    alter table public.supplier_ledger_entries
      add constraint supplier_ledger_linked_bill_payment_check
      check (linked_bill_id is null or entry_type = 'payment');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cashflow_supplier_bill_workspace_fkey'
      and conrelid = 'public.cashflow_transactions'::regclass
  ) then
    alter table public.cashflow_transactions
      add constraint cashflow_supplier_bill_workspace_fkey
      foreign key (supplier_bill_id, workspace_id)
      references public.supplier_ledger_entries (id, workspace_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_ledger_cashflow_transaction_workspace_fkey'
      and conrelid = 'public.supplier_ledger_entries'::regclass
  ) then
    alter table public.supplier_ledger_entries
      add constraint supplier_ledger_cashflow_transaction_workspace_fkey
      foreign key (cashflow_transaction_id, workspace_id)
      references public.cashflow_transactions (id, workspace_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cashflow_supplier_bill_category_check'
      and conrelid = 'public.cashflow_transactions'::regclass
  ) then
    alter table public.cashflow_transactions
      add constraint cashflow_supplier_bill_category_check
      check (supplier_bill_id is null or (category = 'Cicilan piutang' and kind = 'debit'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_ledger_cashflow_payment_check'
      and conrelid = 'public.supplier_ledger_entries'::regclass
  ) then
    alter table public.supplier_ledger_entries
      add constraint supplier_ledger_cashflow_payment_check
      check (cashflow_transaction_id is null or (entry_type = 'payment' and linked_bill_id is not null));
  end if;
end;
$$;

create unique index if not exists supplier_ledger_cashflow_transaction_uidx
  on public.supplier_ledger_entries (cashflow_transaction_id)
  where cashflow_transaction_id is not null;

alter table public.production_events
  drop constraint if exists production_events_customer_order_id_owner_id_fkey;
alter table public.production_events
  drop constraint if exists production_events_customer_order_id_workspace_id_fkey;
alter table public.production_events
  add constraint production_events_customer_order_id_workspace_id_fkey
  foreign key (customer_order_id, workspace_id)
  references public.customer_orders(id, workspace_id) on delete cascade;

create index if not exists cashflow_workspace_date_idx on public.cashflow_transactions (workspace_id, transaction_date desc);
create index if not exists supplier_ledger_workspace_supplier_idx on public.supplier_ledger_entries (workspace_id, supplier, entry_date desc);
create index if not exists invoices_workspace_date_idx on public.sales_invoices (workspace_id, invoice_date desc);
create index if not exists customer_orders_workspace_date_idx on public.customer_orders (workspace_id, order_date desc);
create index if not exists production_events_workspace_date_idx on public.production_events (workspace_id, event_date desc);

create table if not exists public.input_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null default '',
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists input_logs_workspace_date_idx on public.input_logs (workspace_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_supplier_payment_bill_link()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  linked_bill public.supplier_ledger_entries%rowtype;
  normalized_supplier text;
  linked_payment_total numeric(16, 2);
  supplier_balance numeric(16, 2);
begin
  normalized_supplier := lower(btrim(regexp_replace(new.supplier, '[[:space:]]+', ' ', 'g')));
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext(new.workspace_id::text), hashtext(normalized_supplier));
  end if;

  if new.entry_type = 'bill' then
    if new.linked_bill_id is not null then
      raise exception 'Tagihan supplier tidak dapat ditautkan sebagai pembayaran.';
    end if;
    select coalesce(sum(payment.amount), 0)
    into linked_payment_total
    from public.supplier_ledger_entries payment
    where payment.workspace_id = new.workspace_id
      and payment.entry_type = 'payment'
      and payment.linked_bill_id = new.id
      and payment.id is distinct from new.id;
    if new.amount < linked_payment_total then
      raise exception 'Nilai tagihan tidak boleh lebih kecil dari pembayaran yang sudah ditautkan.';
    end if;
    if exists (
      select 1
      from public.supplier_ledger_entries payment
      where payment.workspace_id = new.workspace_id
        and payment.entry_type = 'payment'
        and payment.linked_bill_id = new.id
        and lower(btrim(regexp_replace(payment.supplier, '[[:space:]]+', ' ', 'g'))) <> normalized_supplier
    ) then
      raise exception 'Nama supplier tidak dapat diubah karena tagihan sudah memiliki pembayaran tertaut.';
    end if;
    return new;
  end if;

  if new.linked_bill_id is null then
    return new;
  end if;

  if new.entry_type <> 'payment' then
    raise exception 'Hanya pembayaran supplier yang dapat ditautkan ke tagihan.';
  end if;

  select *
  into linked_bill
  from public.supplier_ledger_entries bill
  where bill.id = new.linked_bill_id
    and bill.workspace_id = new.workspace_id
  for update;

  if not found or linked_bill.entry_type <> 'bill' then
    raise exception 'Tagihan supplier yang dipilih tidak ditemukan.';
  end if;
  if lower(btrim(regexp_replace(linked_bill.supplier, '[[:space:]]+', ' ', 'g'))) <> normalized_supplier then
    raise exception 'Pembayaran dan tagihan harus berasal dari supplier yang sama.';
  end if;

  select coalesce(sum(payment.amount), 0)
  into linked_payment_total
  from public.supplier_ledger_entries payment
  where payment.workspace_id = new.workspace_id
    and payment.entry_type = 'payment'
    and payment.linked_bill_id = new.linked_bill_id
    and payment.id is distinct from new.id;

  if new.amount > greatest(linked_bill.amount - linked_payment_total, 0) then
    raise exception 'Pembayaran melebihi sisa tagihan yang dipilih.';
  end if;

  select coalesce(sum(case when entry.entry_type = 'bill' then entry.amount else -entry.amount end), 0)
  into supplier_balance
  from public.supplier_ledger_entries entry
  where entry.workspace_id = new.workspace_id
    and lower(btrim(regexp_replace(entry.supplier, '[[:space:]]+', ' ', 'g'))) = normalized_supplier
    and entry.id is distinct from new.id;

  if new.amount > greatest(supplier_balance, 0) then
    raise exception 'Pembayaran melebihi saldo tagihan supplier.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_supplier_payment_bill_link on public.supplier_ledger_entries;
create trigger validate_supplier_payment_bill_link
before insert or update on public.supplier_ledger_entries
for each row execute function public.validate_supplier_payment_bill_link();

create or replace function public.write_input_log()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_workspace uuid;
  actor_email text;
  before_row jsonb := '{}'::jsonb;
  after_row jsonb := '{}'::jsonb;
  changes jsonb := '{}'::jsonb;
  field_name text;
  current_row jsonb;
  record_uuid uuid;
begin
  select p.workspace_id into current_workspace
  from public.profiles p
  where p.id = (select auth.uid());

  if current_workspace is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  actor_email := coalesce(auth.jwt() ->> 'email', '');
  if tg_op = 'INSERT' then
    after_row := to_jsonb(new);
    changes := after_row - array['id', 'owner_id', 'workspace_id', 'created_at', 'updated_at'];
    current_row := after_row;
  elsif tg_op = 'UPDATE' then
    before_row := to_jsonb(old);
    after_row := to_jsonb(new);
    for field_name in select jsonb_object_keys(before_row) union select jsonb_object_keys(after_row) loop
      if before_row -> field_name is distinct from after_row -> field_name then
        changes := changes || jsonb_build_object(field_name, jsonb_build_object('sebelum', before_row -> field_name, 'sesudah', after_row -> field_name));
      end if;
    end loop;
    current_row := after_row;
  else
    before_row := to_jsonb(old);
    changes := before_row - array['id', 'owner_id', 'workspace_id', 'created_at', 'updated_at'];
    current_row := before_row;
  end if;

  record_uuid := nullif(coalesce(current_row ->> 'id', current_row ->> 'workspace_id'), '')::uuid;
  insert into public.input_logs (workspace_id, actor_id, actor_email, table_name, record_id, action, changes)
  values (current_workspace, (select auth.uid()), actor_email, tg_table_name, record_uuid, lower(tg_op), changes);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.list_workspace_users()
returns table (user_id uuid, email text, role text, workspace_id uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  caller_workspace uuid;
  caller_role text;
begin
  select p.workspace_id, p.role into caller_workspace, caller_role
  from public.profiles p where p.id = (select auth.uid());
  if caller_role <> 'developer' or caller_workspace is null then
    raise exception 'Akses developer diperlukan.' using errcode = '42501';
  end if;
  return query
    select p.id, p.email, p.role, p.workspace_id, p.created_at
    from public.profiles p
    where p.workspace_id is null or p.workspace_id = caller_workspace
    order by p.created_at desc;
end;
$$;

create or replace function public.set_workspace_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_workspace uuid;
  caller_role text;
  target_email text;
  previous_role text;
  previous_workspace uuid;
begin
  select p.workspace_id, p.role into caller_workspace, caller_role
  from public.profiles p where p.id = (select auth.uid());
  if caller_role <> 'developer' or caller_workspace is null then
    raise exception 'Akses developer diperlukan.' using errcode = '42501';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'Peran akun aktif tidak dapat diubah dari menu ini.' using errcode = '42501';
  end if;
  if new_role not in ('developer', 'staff') then
    raise exception 'Peran tidak dikenal.' using errcode = '22023';
  end if;

  select p.email, p.role, p.workspace_id
  into target_email, previous_role, previous_workspace
  from public.profiles p
  where p.id = target_user_id
    and (p.workspace_id is null or p.workspace_id = caller_workspace);
  if not found then
    raise exception 'Akun tidak ditemukan atau sudah terhubung ke ruang kerja lain.' using errcode = '22023';
  end if;

  update public.profiles p
  set role = new_role, workspace_id = caller_workspace
  where p.id = target_user_id
    and (p.workspace_id is null or p.workspace_id = caller_workspace);
  if not found then
    raise exception 'Akun tidak ditemukan atau sudah terhubung ke ruang kerja lain.' using errcode = '22023';
  end if;

  insert into public.input_logs (workspace_id, actor_id, actor_email, table_name, record_id, action, changes)
  values (
    caller_workspace,
    (select auth.uid()),
    coalesce(auth.jwt() ->> 'email', ''),
    'profiles',
    target_user_id,
    'update',
    jsonb_build_object(
      'email', target_email,
      'role', jsonb_build_object('sebelum', previous_role, 'sesudah', new_role),
      'workspace_access', jsonb_build_object('sebelum', previous_workspace, 'sesudah', caller_workspace)
    )
  );
end;
$$;

create or replace function public.record_customer_receivable_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  outstanding numeric(16, 2);
  payment_delta numeric(16, 2);
  old_outstanding numeric(16, 2);
  balance_delta numeric(16, 2);
  adjustment_delta numeric(16, 2);
begin
  if tg_op = 'INSERT' then
    if new.amount <> 0 then
      insert into public.customer_receivable_events
        (workspace_id, invoice_id, event_date, event_type, balance_delta)
      values (new.workspace_id, new.id, new.invoice_date, 'invoice', new.amount);
    end if;
    if new.paid_amount <> 0 then
      insert into public.customer_receivable_events
        (workspace_id, invoice_id, event_date, event_type, balance_delta)
      values (new.workspace_id, new.id, new.paid_date, 'payment', -new.paid_amount);
    end if;
    outstanding := coalesce(new.outstanding_amount, greatest(new.amount - new.paid_amount, 0));
    adjustment_delta := outstanding - (new.amount - new.paid_amount);
    if adjustment_delta <> 0 then
      insert into public.customer_receivable_events
        (workspace_id, invoice_id, event_date, event_type, balance_delta)
      values (new.workspace_id, new.id, current_date, 'adjustment', adjustment_delta);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    outstanding := coalesce(old.outstanding_amount, greatest(old.amount - old.paid_amount, 0));
    if outstanding <> 0 then
      insert into public.customer_receivable_events
        (workspace_id, invoice_id, event_date, event_type, balance_delta)
      values (old.workspace_id, old.id, current_date, 'adjustment', -outstanding);
    end if;
    return old;
  end if;

  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'Invoice workspace cannot be changed.';
  end if;

  old_outstanding := coalesce(old.outstanding_amount, greatest(old.amount - old.paid_amount, 0));
  outstanding := coalesce(new.outstanding_amount, greatest(new.amount - new.paid_amount, 0));
  payment_delta := new.paid_amount - old.paid_amount;
  balance_delta := outstanding - old_outstanding;
  if payment_delta > 0 then
    insert into public.customer_receivable_events
      (workspace_id, invoice_id, event_date, event_type, balance_delta)
    values (new.workspace_id, new.id, new.paid_date, 'payment', -payment_delta);
  end if;

  adjustment_delta := balance_delta - case when payment_delta > 0 then -payment_delta else 0 end;
  if adjustment_delta <> 0 then
    insert into public.customer_receivable_events
      (workspace_id, invoice_id, event_date, event_type, balance_delta)
    values (new.workspace_id, new.id, current_date, 'adjustment', adjustment_delta);
  end if;

  if payment_delta = 0 and new.paid_date is distinct from old.paid_date then
    update public.customer_receivable_events target_event
    set event_date = new.paid_date
    where target_event.id = (
      select candidate.id
      from public.customer_receivable_events candidate
      where candidate.workspace_id = new.workspace_id
        and candidate.invoice_id = new.id
        and candidate.event_type = 'payment'
      order by candidate.id desc
      limit 1
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_customer_receivable_event on public.sales_invoices;
create trigger record_customer_receivable_event
after insert or update or delete on public.sales_invoices
for each row execute function public.record_customer_receivable_event();

create or replace function public.link_customer_receivable_payment_to_cashflow()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  invoice_owner_id uuid;
  invoice_customer text;
  invoice_number text;
  cashflow_id uuid;
begin
  if new.event_type <> 'payment' or new.balance_delta >= 0 then
    return new;
  end if;

  select invoice.owner_id, invoice.customer, invoice.invoice_number
  into invoice_owner_id, invoice_customer, invoice_number
  from public.sales_invoices invoice
  where invoice.id = new.invoice_id
    and invoice.workspace_id = new.workspace_id;

  if not found then
    return new;
  end if;

  insert into public.cashflow_transactions
    (owner_id, workspace_id, transaction_date, category, requester, description, amount, kind, source_key)
  values
    (invoice_owner_id, new.workspace_id, coalesce(new.event_date, current_date), 'Uang Masuk',
      invoice_customer, format('Pembayaran invoice %s · %s', invoice_number, invoice_customer),
      -new.balance_delta, 'credit', 'customer-receivable-event:' || new.id::text)
  on conflict (workspace_id, source_key) do update
    set transaction_date = excluded.transaction_date,
        category = excluded.category,
        requester = excluded.requester,
        description = excluded.description,
        amount = excluded.amount,
        kind = excluded.kind
  returning id into cashflow_id;

  update public.customer_receivable_events
  set cashflow_transaction_id = cashflow_id
  where id = new.id
    and cashflow_transaction_id is distinct from cashflow_id;

  return new;
end;
$$;

drop trigger if exists link_customer_receivable_payment_to_cashflow on public.customer_receivable_events;
create trigger link_customer_receivable_payment_to_cashflow
after insert or update of event_date on public.customer_receivable_events
for each row execute function public.link_customer_receivable_payment_to_cashflow();

create or replace function public.sync_cashflow_supplier_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  supplier_bill public.supplier_ledger_entries%rowtype;
  payment_description text;
  supplier_payment_id uuid;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.supplier_bill_id is null then
    delete from public.supplier_ledger_entries
    where cashflow_transaction_id = new.id;
    return new;
  end if;

  if new.category <> 'Cicilan piutang' or new.kind <> 'debit' then
    raise exception 'Pembayaran piutang supplier harus memakai kategori Cicilan piutang sebagai uang keluar.';
  end if;

  select *
  into supplier_bill
  from public.supplier_ledger_entries bill
  where bill.id = new.supplier_bill_id
    and bill.workspace_id = new.workspace_id
  for update;

  if not found or supplier_bill.entry_type <> 'bill' then
    raise exception 'Tagihan supplier yang dipilih tidak ditemukan.';
  end if;

  payment_description := coalesce(
    nullif(btrim(new.description), ''),
    format('Pembayaran %s', coalesce(nullif(btrim(supplier_bill.description), ''), 'tagihan supplier'))
  );

  select payment.id
  into supplier_payment_id
  from public.supplier_ledger_entries payment
  where payment.workspace_id = new.workspace_id
    and payment.entry_type = 'payment'
    and payment.cashflow_transaction_id = new.id
  for update;

  if not found and new.source_key is not null then
    select payment.id
    into supplier_payment_id
    from public.supplier_ledger_entries payment
    where payment.workspace_id = new.workspace_id
      and payment.entry_type = 'payment'
      and new.source_key = 'supplier-ledger-payment:' || payment.id::text
    for update;
  end if;

  if supplier_payment_id is not null then
    update public.supplier_ledger_entries
    set supplier = supplier_bill.supplier,
        entry_date = new.transaction_date,
        entry_type = 'payment',
        amount = new.amount,
        description = payment_description,
        linked_bill_id = new.supplier_bill_id,
        cashflow_transaction_id = new.id,
        updated_at = clock_timestamp()
    where id = supplier_payment_id;
  else
    insert into public.supplier_ledger_entries
      (owner_id, workspace_id, supplier, entry_date, entry_type, amount, description,
       linked_bill_id, cashflow_transaction_id, source_key)
    values
      (supplier_bill.owner_id, new.workspace_id, supplier_bill.supplier, new.transaction_date,
       'payment', new.amount, payment_description, new.supplier_bill_id, new.id,
       'cashflow-supplier-payment:' || new.id::text);
  end if;

  return new;
end;
$$;

drop trigger if exists sync_cashflow_supplier_payment on public.cashflow_transactions;
create trigger sync_cashflow_supplier_payment
after insert or update on public.cashflow_transactions
for each row execute function public.sync_cashflow_supplier_payment();

create or replace function public.link_supplier_payment_to_cashflow()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  supplier_bill public.supplier_ledger_entries%rowtype;
  cashflow_id uuid;
  cashflow_description text;
begin
  if new.entry_type <> 'payment' or new.linked_bill_id is null or new.cashflow_transaction_id is not null then
    return new;
  end if;

  select *
  into supplier_bill
  from public.supplier_ledger_entries bill
  where bill.id = new.linked_bill_id
    and bill.workspace_id = new.workspace_id
    and bill.entry_type = 'bill';

  if not found then
    raise exception 'Tagihan supplier yang dipilih tidak ditemukan.';
  end if;

  cashflow_description := format(
    'Pembayaran %s%s',
    coalesce(nullif(btrim(supplier_bill.description), ''), 'tagihan supplier'),
    case when nullif(btrim(new.description), '') is null then '' else ' · ' || btrim(new.description) end
  );

  insert into public.cashflow_transactions
    (owner_id, workspace_id, transaction_date, category, requester, description, amount, kind, supplier_bill_id, source_key)
  values
    (new.owner_id, new.workspace_id, new.entry_date, 'Cicilan piutang', new.supplier, cashflow_description,
     new.amount, 'debit', new.linked_bill_id, 'supplier-ledger-payment:' || new.id::text)
  on conflict (workspace_id, source_key) do update
    set transaction_date = excluded.transaction_date,
        category = excluded.category,
        requester = excluded.requester,
        description = excluded.description,
        amount = excluded.amount,
        kind = excluded.kind,
        supplier_bill_id = excluded.supplier_bill_id
  returning id into cashflow_id;

  update public.supplier_ledger_entries
  set cashflow_transaction_id = cashflow_id
  where id = new.id
    and cashflow_transaction_id is distinct from cashflow_id;

  return new;
end;
$$;

drop trigger if exists link_supplier_payment_to_cashflow on public.supplier_ledger_entries;
create trigger link_supplier_payment_to_cashflow
after insert on public.supplier_ledger_entries
for each row execute function public.link_supplier_payment_to_cashflow();

create unique index if not exists supplier_ledger_cashflow_transaction_uidx
  on public.supplier_ledger_entries (cashflow_transaction_id)
  where cashflow_transaction_id is not null;

insert into public.customer_receivable_baselines (workspace_id, captured_at, opening_balance)
select
  workspace.id,
  clock_timestamp(),
  coalesce(sum(coalesce(invoice.outstanding_amount, greatest(invoice.amount - invoice.paid_amount, 0))), 0)
from public.workspaces workspace
left join public.sales_invoices invoice on invoice.workspace_id = workspace.id
group by workspace.id
on conflict (workspace_id) do nothing;

create or replace function public.initialize_customer_receivable_baseline()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.customer_receivable_baselines (workspace_id, captured_at, opening_balance)
  values (new.id, clock_timestamp(), 0)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_customer_receivable_baseline on public.workspaces;
create trigger initialize_customer_receivable_baseline
after insert on public.workspaces
for each row execute function public.initialize_customer_receivable_baseline();

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
    execute format('drop policy if exists workspace_member_all on public.%I', table_name);
    execute format(
      'create policy workspace_member_all on public.%I for all to authenticated using (workspace_id = (select public.current_workspace_id())) with check (workspace_id = (select public.current_workspace_id()))',
      table_name
    );
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      table_name
    );
    execute format('drop trigger if exists capture_input_log on public.%I', table_name);
    execute format(
      'create trigger capture_input_log after insert or update or delete on public.%I for each row execute function public.write_input_log()',
      table_name
    );
  end loop;
end $$;

alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon, authenticated;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;
drop policy if exists profile_read_self on public.profiles;
create policy profile_read_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));

alter table public.input_logs enable row level security;
revoke all on public.input_logs from anon;
revoke insert, update, delete on public.input_logs from authenticated;
grant select on public.input_logs to authenticated;
drop policy if exists developer_read_input_logs on public.input_logs;
create policy developer_read_input_logs on public.input_logs
  for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and (select public.current_user_role()) = 'developer'
  );

grant select, insert, update, delete on public.company_settings to authenticated;
grant select, insert, update, delete on public.cashflow_transactions to authenticated;
grant select, insert, update, delete on public.supplier_ledger_entries to authenticated;
grant select, insert, update, delete on public.sales_invoices to authenticated;
grant select, insert, update, delete on public.supplier_purchase_orders to authenticated;
grant select, insert, update, delete on public.customer_orders to authenticated;
grant select, insert, update, delete on public.production_events to authenticated;

alter table public.customer_receivable_baselines enable row level security;
alter table public.customer_receivable_events enable row level security;
revoke all on public.customer_receivable_baselines from anon, authenticated;
revoke all on public.customer_receivable_events from anon, authenticated;
grant select on public.customer_receivable_baselines to authenticated;
grant select on public.customer_receivable_events to authenticated;

drop policy if exists workspace_member_read on public.customer_receivable_baselines;
create policy workspace_member_read on public.customer_receivable_baselines
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

drop policy if exists workspace_member_read on public.customer_receivable_events;
create policy workspace_member_read on public.customer_receivable_events
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

revoke all on sequence public.input_logs_id_seq from anon, authenticated;

revoke all on function public.current_workspace_id() from public, anon;
revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_workspace_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
revoke all on function public.list_workspace_users() from public, anon;
grant execute on function public.list_workspace_users() to authenticated;
revoke all on function public.set_workspace_user_role(uuid, text) from public, anon;
grant execute on function public.set_workspace_user_role(uuid, text) to authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.write_input_log() from public, anon, authenticated;
revoke all on function public.record_customer_receivable_event() from public, anon, authenticated;
revoke all on function public.link_customer_receivable_payment_to_cashflow() from public, anon, authenticated;
revoke all on function public.sync_cashflow_supplier_payment() from public, anon, authenticated;
revoke all on function public.link_supplier_payment_to_cashflow() from public, anon, authenticated;
revoke all on function public.initialize_customer_receivable_baseline() from public, anon, authenticated;
revoke all on function public.validate_supplier_payment_bill_link() from public, anon, authenticated;
