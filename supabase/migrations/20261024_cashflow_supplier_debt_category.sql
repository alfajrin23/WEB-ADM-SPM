update public.cashflow_transactions
set category = 'Cicilan hutang'
where lower(btrim(category)) in ('cicilan piutang', 'cicilan hutang supplier');
