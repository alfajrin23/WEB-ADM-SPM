create table if not exists public.supplier_debt_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier text not null check (btrim(supplier) <> ''),
  entry_date date not null default current_date,
  amount numeric(16, 2) not null check (amount < 0),
  description text not null default 'Koreksi total hutang',
  created_at timestamptz not null default now()
);

create index if not exists supplier_debt_adjustments_workspace_supplier_date_idx
  on public.supplier_debt_adjustments (workspace_id, supplier, entry_date, id);

alter table public.supplier_debt_adjustments enable row level security;
revoke all on public.supplier_debt_adjustments from anon, authenticated;
grant select, insert on public.supplier_debt_adjustments to authenticated;

drop policy if exists workspace_member_read on public.supplier_debt_adjustments;
create policy workspace_member_read on public.supplier_debt_adjustments
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

drop policy if exists workspace_member_insert on public.supplier_debt_adjustments;
create policy workspace_member_insert on public.supplier_debt_adjustments
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id()));

drop trigger if exists capture_input_log on public.supplier_debt_adjustments;
create trigger capture_input_log
after insert on public.supplier_debt_adjustments
for each row execute function public.write_input_log();

create or replace function public.validate_supplier_debt_adjustment()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  normalized_supplier text;
  supplier_balance numeric(16, 2);
begin
  if new.amount >= 0 then
    raise exception 'Koreksi hutang harus mengurangi total hutang.';
  end if;

  normalized_supplier := lower(btrim(regexp_replace(new.supplier, '[[:space:]]+', ' ', 'g')));
  perform pg_advisory_xact_lock(hashtext(new.workspace_id::text), hashtext(normalized_supplier));

  select
    coalesce(sum(case when entry.entry_type = 'bill' then entry.amount else -entry.amount end), 0)
      + coalesce((
        select sum(adjustment.amount)
        from public.supplier_debt_adjustments adjustment
        where adjustment.workspace_id = new.workspace_id
          and lower(btrim(regexp_replace(adjustment.supplier, '[[:space:]]+', ' ', 'g'))) = normalized_supplier
          and adjustment.id is distinct from new.id
      ), 0)
  into supplier_balance
  from public.supplier_ledger_entries entry
  where entry.workspace_id = new.workspace_id
    and lower(btrim(regexp_replace(entry.supplier, '[[:space:]]+', ' ', 'g'))) = normalized_supplier;

  if -new.amount > greatest(supplier_balance, 0) then
    raise exception 'Koreksi hutang tidak boleh membuat total hutang lebih kecil dari pembayaran.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_supplier_debt_adjustment on public.supplier_debt_adjustments;
create trigger validate_supplier_debt_adjustment
before insert on public.supplier_debt_adjustments
for each row execute function public.validate_supplier_debt_adjustment();

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

  select
    coalesce(sum(case when entry.entry_type = 'bill' then entry.amount else -entry.amount end), 0)
      + coalesce((
        select sum(adjustment.amount)
        from public.supplier_debt_adjustments adjustment
        where adjustment.workspace_id = new.workspace_id
          and lower(btrim(regexp_replace(adjustment.supplier, '[[:space:]]+', ' ', 'g'))) = normalized_supplier
      ), 0)
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
