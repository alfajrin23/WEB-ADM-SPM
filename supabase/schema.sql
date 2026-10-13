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
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_key)
);

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
create unique index if not exists supplier_ledger_workspace_source_uidx on public.supplier_ledger_entries (workspace_id, source_key);
create unique index if not exists sales_invoices_workspace_number_uidx on public.sales_invoices (workspace_id, invoice_number);
create unique index if not exists sales_invoices_workspace_source_uidx on public.sales_invoices (workspace_id, source_key);
create unique index if not exists supplier_po_workspace_number_uidx on public.supplier_purchase_orders (workspace_id, po_number);
create unique index if not exists supplier_po_workspace_source_uidx on public.supplier_purchase_orders (workspace_id, source_key);
create unique index if not exists customer_orders_workspace_source_uidx on public.customer_orders (workspace_id, source_key);
create unique index if not exists customer_orders_id_workspace_uidx on public.customer_orders (id, workspace_id);

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
