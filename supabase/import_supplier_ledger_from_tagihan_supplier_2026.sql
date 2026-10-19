-- Import TAGIHAN SUPPLIER 2026.xlsx into the Piutang pemasok menu.
-- Run in Supabase SQL Editor after the main workspace schema is installed.
-- 20261019_customer_receivable_history.sql only creates customer receivable history tables; it does not import supplier ledger rows.
-- Idempotent: source_key conflicts are skipped on rerun; existing operational rows are not updated or deleted.
-- Workbook detail: 55 invoice rows are inserted as 54 bills (INDOCORR Excel rows 23 and 24 share an invoice/date and are combined by sum); 1 dated payment is inserted.
-- The dates for two blank ADINA TGL INV cells were supplied by the user: 2025-03-22 and 2025-05-26.
-- The supplier ledger has no due_date column; due dates are retained in descriptions when present.

begin;
do $$
declare
  v_workspace uuid := 'a38a0000-0000-4000-8000-000000000001';
  v_owner uuid;
  v_bill_count integer;
  v_payment_count integer;
begin
  select p.id into v_owner
  from public.profiles p
  where p.workspace_id = v_workspace
  order by case when lower(p.email) = 'dev@spm.com' then 0 else 1 end, p.created_at
  limit 1;

  if v_owner is null then
    raise exception 'Tidak ada akun profil pada workspace CV Surya Pratama Mandiri. Periksa profiles/workspace_id sebelum impor.';
  end if;

  insert into public.supplier_ledger_entries
    (owner_id, workspace_id, supplier, entry_date, entry_type, amount, description, source_key)
  values
      (v_owner, v_workspace, 'PT. ADINA MULTI WAHANA', DATE '2025-03-08', 'bill', 39254235.00, 'Invoice 2503-FP-00146; Jatuh tempo 2025-04-07', 'tagihan-supplier-2026::ADINA::rows-3::bill'),
      (v_owner, v_workspace, 'PT. ADINA MULTI WAHANA', DATE '2025-03-18', 'bill', 32959897.00, 'Invoice 2504-FP-00413; Jatuh tempo 2025-04-17', 'tagihan-supplier-2026::ADINA::rows-4::bill'),
      (v_owner, v_workspace, 'PT. ADINA MULTI WAHANA', DATE '2025-03-22', 'bill', 28204760.00, 'Invoice 2503-FP-00654; Jatuh tempo 2025-04-21', 'tagihan-supplier-2026::ADINA::rows-5::bill'),
      (v_owner, v_workspace, 'PT. ADINA MULTI WAHANA', DATE '2025-03-22', 'bill', 20073813.00, 'Invoice 2503-FP-00702; Tanggal invoice dikonfirmasi pengguna', 'tagihan-supplier-2026::ADINA::rows-6::bill'),
      (v_owner, v_workspace, 'PT. ADINA MULTI WAHANA', DATE '2025-04-26', 'bill', 39992167.00, 'Invoice 2504-FP-00618; Jatuh tempo 2025-05-26', 'tagihan-supplier-2026::ADINA::rows-7::bill'),
      (v_owner, v_workspace, 'PT. ADINA MULTI WAHANA', DATE '2025-05-26', 'bill', 29157628.00, 'Invoice 2505-FP-00696; Jatuh tempo 2025-06-25', 'tagihan-supplier-2026::ADINA::rows-8::bill'),
      (v_owner, v_workspace, 'PT. ADINA MULTI WAHANA', DATE '2025-05-26', 'bill', 21859510.00, 'Invoice 2505-FP-00745; Tanggal invoice dikonfirmasi pengguna', 'tagihan-supplier-2026::ADINA::rows-9::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-10', 'bill', 8919400.00, 'Invoice 254594/SCI/VII/2024; Jatuh tempo 2024-08-09', 'tagihan-supplier-2026::INDOCORR::rows-3::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-10', 'bill', 10902420.00, 'Invoice 254576/SCI/VII/2024; Jatuh tempo 2024-08-09', 'tagihan-supplier-2026::INDOCORR::rows-4::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-18', 'bill', 7584141.00, 'Invoice 254784/SCI/VII/2024; Jatuh tempo 2024-08-17', 'tagihan-supplier-2026::INDOCORR::rows-5::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-19', 'bill', 6572421.00, 'Invoice 254905/SCI/VII/2024; Jatuh tempo 2024-08-18', 'tagihan-supplier-2026::INDOCORR::rows-6::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-20', 'bill', 16276418.00, 'Invoice 254917/SCI/VII/2024; Jatuh tempo 2024-08-19', 'tagihan-supplier-2026::INDOCORR::rows-7::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-24', 'bill', 1334808.00, 'Invoice 255026/SCI/VII/2024; Jatuh tempo 2024-08-23', 'tagihan-supplier-2026::INDOCORR::rows-8::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-24', 'bill', 27750843.00, 'Invoice 255023/SCI/VII/2024; Jatuh tempo 2024-08-23', 'tagihan-supplier-2026::INDOCORR::rows-9::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-24', 'bill', 8024367.00, 'Invoice 255024/SCI/VII/2024; Jatuh tempo 2024-08-23', 'tagihan-supplier-2026::INDOCORR::rows-10::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-24', 'bill', 10692130.00, 'Invoice 255027/SCI/VII/2024; Jatuh tempo 2024-08-23', 'tagihan-supplier-2026::INDOCORR::rows-11::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-29', 'bill', 15106478.00, 'Invoice 255142/SCI/VII/2024; Jatuh tempo 2024-08-28', 'tagihan-supplier-2026::INDOCORR::rows-12::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-29', 'bill', 13223296.00, 'Invoice 255166/SCI/VII/2024; Jatuh tempo 2024-08-28', 'tagihan-supplier-2026::INDOCORR::rows-13::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-29', 'bill', 5361333.00, 'Invoice 255167/SCI/VII/2024; Jatuh tempo 2024-08-28', 'tagihan-supplier-2026::INDOCORR::rows-14::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-29', 'bill', 5726934.00, 'Invoice 255168/SCI/VII/2024; Jatuh tempo 2024-08-28', 'tagihan-supplier-2026::INDOCORR::rows-15::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-29', 'bill', 6158235.00, 'Invoice 255170/SCI/VII/2024; Jatuh tempo 2024-08-28', 'tagihan-supplier-2026::INDOCORR::rows-16::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-29', 'bill', 5706465.00, 'Invoice 255171/SCI/VII/2024; Jatuh tempo 2024-08-28', 'tagihan-supplier-2026::INDOCORR::rows-17::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-30', 'bill', 10045999.00, 'Invoice 255186/SCI/VII/2024; Jatuh tempo 2024-08-29', 'tagihan-supplier-2026::INDOCORR::rows-18::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-30', 'bill', 8485665.00, 'Invoice 255187/SCI/VII/2024; Jatuh tempo 2024-08-29', 'tagihan-supplier-2026::INDOCORR::rows-19::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-30', 'bill', 6408185.00, 'Invoice 255188/SCI/VII/2024; Jatuh tempo 2024-08-29', 'tagihan-supplier-2026::INDOCORR::rows-20::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-30', 'bill', 7715843.00, 'Invoice 255223/SCI/VII/2024; Jatuh tempo 2024-08-29', 'tagihan-supplier-2026::INDOCORR::rows-21::bill'),
      (v_owner, v_workspace, 'PT. INDOCORR', DATE '2024-07-30', 'bill', 25852842.00, 'Invoice 255289/SCI/VII/2024; Jatuh tempo 2024-08-29; Baris Excel 23 + 24 digabung', 'tagihan-supplier-2026::INDOCORR::rows-22-23::bill'),
      (v_owner, v_workspace, 'CV. MINNA PAPER', DATE '2026-09-18', 'bill', 31911751.00, 'Invoice 2026-09/MPI/0514; Jatuh tempo 2026-10-18', 'tagihan-supplier-2026::CV MINNA::rows-3::bill'),
      (v_owner, v_workspace, 'SETIAJAYA', DATE '2025-03-27', 'bill', 33668520.00, 'Invoice 254594/SCI/VII/2024; Jatuh tempo 2025-04-26', 'tagihan-supplier-2026::SETIAJAYA::rows-3::bill'),
      (v_owner, v_workspace, 'TRYUASDA', DATE '2025-10-01', 'bill', 4417800.00, 'Invoice INV.09.2025.866; Jatuh tempo 2025-10-31', 'tagihan-supplier-2026::TRYUASDA::rows-3::bill'),
      (v_owner, v_workspace, 'TRYUASDA', DATE '2025-11-12', 'bill', 1820400.00, 'Invoice INV.11.2025.1052; Jatuh tempo 2025-12-12', 'tagihan-supplier-2026::TRYUASDA::rows-4::bill'),
      (v_owner, v_workspace, 'TRYUASDA', DATE '2026-02-24', 'bill', 2863800.00, 'Invoice INV.02.2026.183; Jatuh tempo 2026-03-26', 'tagihan-supplier-2026::TRYUASDA::rows-5::bill'),
      (v_owner, v_workspace, 'TRYUASDA', DATE '2026-03-04', 'bill', 1776000.00, 'Invoice INV.03.2026.217; Jatuh tempo 2026-04-03', 'tagihan-supplier-2026::TRYUASDA::rows-6::bill'),
      (v_owner, v_workspace, 'TRYUASDA', DATE '2026-04-08', 'bill', 5106000.00, 'Invoice INV.04.2026.309; Jatuh tempo 2026-05-08', 'tagihan-supplier-2026::TRYUASDA::rows-7::bill'),
      (v_owner, v_workspace, 'YOGAMA', DATE '2026-01-14', 'bill', 6410250.00, 'Invoice 018-INV/I/26; Jatuh tempo 2026-02-13', 'tagihan-supplier-2026::YOGAMA::rows-3::bill'),
      (v_owner, v_workspace, 'YOGAMA', DATE '2026-04-15', 'bill', 12820500.00, 'Invoice 139-INV/IV/26; Jatuh tempo 2026-05-15', 'tagihan-supplier-2026::YOGAMA::rows-4::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-04', 'bill', 334665.00, 'Invoice PG-INV-2606510; Jatuh tempo 2026-07-04', 'tagihan-supplier-2026::POLYGRAF::rows-3::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-04', 'bill', 53946.00, 'Invoice PG-INV-2606520; Jatuh tempo 2026-07-04', 'tagihan-supplier-2026::POLYGRAF::rows-4::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-04', 'bill', 226973.00, 'Invoice PG-INV-2606509; Jatuh tempo 2026-07-04', 'tagihan-supplier-2026::POLYGRAF::rows-5::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-04', 'bill', 215784.00, 'Invoice PG-INV-2606508; Jatuh tempo 2026-07-04', 'tagihan-supplier-2026::POLYGRAF::rows-6::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-04', 'bill', 214486.00, 'Invoice PG-INV-26065414; Jatuh tempo 2026-07-04', 'tagihan-supplier-2026::POLYGRAF::rows-7::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-17', 'bill', 580819.00, 'Invoice PG-INV-2607039; Jatuh tempo 2026-07-17', 'tagihan-supplier-2026::POLYGRAF::rows-8::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-17', 'bill', 2078719.00, 'Invoice PG-INV-2607041; Jatuh tempo 2026-07-17', 'tagihan-supplier-2026::POLYGRAF::rows-9::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-17', 'bill', 156044.00, 'Invoice PG-INV-2607040; Jatuh tempo 2026-07-17', 'tagihan-supplier-2026::POLYGRAF::rows-10::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-20', 'bill', 523076.00, 'Invoice PG-INV-2607278; Jatuh tempo 2026-07-20', 'tagihan-supplier-2026::POLYGRAF::rows-11::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-26', 'bill', 206194.00, 'Invoice PG-INV-2607483; Jatuh tempo 2026-07-26', 'tagihan-supplier-2026::POLYGRAF::rows-12::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-26', 'bill', 206194.00, 'Invoice PG-INV-2607485; Jatuh tempo 2026-07-26', 'tagihan-supplier-2026::POLYGRAF::rows-13::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-26', 'bill', 187013.00, 'Invoice PG-INV-2607532; Jatuh tempo 2026-07-26', 'tagihan-supplier-2026::POLYGRAF::rows-14::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-06-26', 'bill', 302297.00, 'Invoice PG-INV-2607482; Jatuh tempo 2026-07-26', 'tagihan-supplier-2026::POLYGRAF::rows-15::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-07-03', 'bill', 170929.00, 'Invoice PG-INV-2607792; Jatuh tempo 2026-08-02', 'tagihan-supplier-2026::POLYGRAF::rows-16::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-07-04', 'bill', 294905.00, 'Invoice PG-INV-2607859; Jatuh tempo 2026-08-03', 'tagihan-supplier-2026::POLYGRAF::rows-17::bill'),
      (v_owner, v_workspace, 'POLYGRAF', DATE '2026-07-28', 'bill', 424575.00, 'Invoice PG-INV-2608866; Jatuh tempo 2026-08-27', 'tagihan-supplier-2026::POLYGRAF::rows-18::bill'),
      (v_owner, v_workspace, 'INTIMAS', DATE '2026-10-05', 'bill', 2708400.00, 'Invoice 03779/V/26; Jatuh tempo 2026-11-04', 'tagihan-supplier-2026::OKTOBER::rows-3::bill'),
      (v_owner, v_workspace, 'YOGAMA', DATE '2026-10-13', 'bill', 6410250.00, 'Invoice 373-INV/X/2026; Jatuh tempo 2026-11-12', 'tagihan-supplier-2026::OKTOBER::rows-9::bill')
  on conflict (workspace_id, source_key) do nothing;
  get diagnostics v_bill_count = row_count;

  insert into public.supplier_ledger_entries
    (owner_id, workspace_id, supplier, entry_date, entry_type, amount, description, source_key)
  values
      (v_owner, v_workspace, 'PT. ADINA MULTI WAHANA', DATE '2026-07-17', 'payment', 25000000.00, 'Pembayaran invoice 2503-FP-00654', 'tagihan-supplier-2026::ADINA::row-5::payment')
  on conflict (workspace_id, source_key) do nothing;
  get diagnostics v_payment_count = row_count;

  raise notice 'Tagihan supplier baru: %, pembayaran supplier baru: %.', v_bill_count, v_payment_count;
end;
$$;
commit;
