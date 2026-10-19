begin;

create table if not exists public.customer_receivable_baselines (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  captured_at timestamptz not null default clock_timestamp(),
  opening_balance numeric(16, 2) not null default 0
);

create table if not exists public.customer_receivable_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null,
  event_date date,
  event_type text not null check (event_type in ('invoice', 'payment', 'adjustment')),
  balance_delta numeric(16, 2) not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists customer_receivable_events_workspace_date_idx
  on public.customer_receivable_events (workspace_id, event_date, id);
create index if not exists customer_receivable_events_workspace_invoice_idx
  on public.customer_receivable_events (workspace_id, invoice_id, id);

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

revoke all on function public.record_customer_receivable_event() from public, anon, authenticated;
revoke all on function public.initialize_customer_receivable_baseline() from public, anon, authenticated;

commit;
