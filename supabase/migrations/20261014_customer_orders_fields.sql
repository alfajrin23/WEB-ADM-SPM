-- Run in Supabase SQL Editor to add PO and production performance fields.
-- Existing customer PO rows are kept; their total_price is initialized from
-- the saved order amount and any previously recorded PO tax.

alter table public.customer_orders
  add column if not exists spm_skg text not null default '',
  add column if not exists po_tax_amount numeric(16, 2) not null default 0 check (po_tax_amount >= 0),
  add column if not exists total_price numeric(16, 2) not null default 0 check (total_price >= 0),
  add column if not exists size_sheet text not null default '',
  add column if not exists floot text not null default '',
  add column if not exists score text not null default '',
  add column if not exists height text not null default '',
  add column if not exists score_secondary text not null default '';

update public.customer_orders
set total_price = amount + po_tax_amount
where total_price = 0 and amount > 0;
