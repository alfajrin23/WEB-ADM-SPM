begin;

alter table public.customer_receivable_events
  add column if not exists cashflow_transaction_id uuid
  references public.cashflow_transactions(id) on delete set null;

create index if not exists customer_receivable_events_cashflow_idx
  on public.customer_receivable_events (cashflow_transaction_id)
  where cashflow_transaction_id is not null;

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
    (invoice_owner_id, new.workspace_id, coalesce(new.event_date, current_date), 'Cicilan',
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

revoke all on function public.link_customer_receivable_payment_to_cashflow() from public, anon, authenticated;

commit;
