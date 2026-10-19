begin;

alter table public.cashflow_transactions
  add column if not exists supplier_bill_id uuid;

alter table public.supplier_ledger_entries
  add column if not exists cashflow_transaction_id uuid;

create unique index if not exists cashflow_id_workspace_uidx
  on public.cashflow_transactions (id, workspace_id);
create unique index if not exists supplier_ledger_id_workspace_uidx
  on public.supplier_ledger_entries (id, workspace_id);
create unique index if not exists supplier_ledger_cashflow_transaction_uidx
  on public.supplier_ledger_entries (cashflow_transaction_id)
  where cashflow_transaction_id is not null;

do $$
begin
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
      check (supplier_bill_id is null or (category = 'Cicilan' and kind = 'debit'));
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

  if new.category <> 'Cicilan' or new.kind <> 'debit' then
    raise exception 'Pembayaran piutang supplier harus memakai kategori Cicilan sebagai uang keluar.';
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

revoke all on function public.sync_cashflow_supplier_payment() from public, anon, authenticated;

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
    (new.owner_id, new.workspace_id, new.entry_date, 'Cicilan', new.supplier, cashflow_description,
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

revoke all on function public.link_supplier_payment_to_cashflow() from public, anon, authenticated;

-- Link payments already recorded by the customer receivable history trigger.
update public.customer_receivable_events
set event_date = event_date
where event_type = 'payment'
  and balance_delta < 0;

commit;
