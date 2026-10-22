begin;

alter table public.cashflow_transactions
  drop constraint if exists cashflow_supplier_bill_category_check;

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

update public.cashflow_transactions
set category = case kind
  when 'debit' then 'Cicilan piutang'
  when 'credit' then 'Uang Masuk'
  else category
end
where category = 'Cicilan'
  and kind in ('debit', 'credit');

alter table public.cashflow_transactions
  add constraint cashflow_supplier_bill_category_check
  check (supplier_bill_id is null or (category = 'Cicilan piutang' and kind = 'debit'));

commit;
