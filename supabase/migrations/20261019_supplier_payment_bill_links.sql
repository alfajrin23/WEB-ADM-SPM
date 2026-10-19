begin;

alter table public.supplier_ledger_entries
  add column if not exists linked_bill_id uuid;

create unique index if not exists supplier_ledger_id_workspace_uidx
  on public.supplier_ledger_entries (id, workspace_id);

create index if not exists supplier_ledger_linked_bill_idx
  on public.supplier_ledger_entries (workspace_id, linked_bill_id)
  where entry_type = 'payment' and linked_bill_id is not null;

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

revoke all on function public.validate_supplier_payment_bill_link() from public, anon, authenticated;

commit;
