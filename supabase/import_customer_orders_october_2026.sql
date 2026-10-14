-- Import PO Customer Oktober 2026 saja (33 baris item, 4 nomor PO).
-- Prasyarat: jalankan supabase/migrations/20261014_customer_orders_fields.sql lebih dulu.
-- Aman dijalankan ulang: source_key yang sudah ada akan dilewati tanpa mengubah data produksi/delivery.
-- Owner dipilih dari profil pada workspace perusahaan; utamakan role developer.

BEGIN;

DO $$
DECLARE
  v_workspace_id uuid := 'a38a0000-0000-4000-8000-000000000001';
  v_owner_id uuid;
  v_inserted integer;
BEGIN
  SELECT p.id
    INTO v_owner_id
  FROM public.profiles AS p
  WHERE p.workspace_id = v_workspace_id
  ORDER BY (p.role = 'developer') DESC, p.created_at
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Tidak ditemukan profil pada workspace %. Pastikan schema dan profil Supabase sudah tersedia.', v_workspace_id;
  END IF;

  INSERT INTO public.customer_orders (
    owner_id, workspace_id, order_date, po_number, customer, spm_skg, item, size,
    qty_order, qty_produced, qty_delivered, unit_price, amount, po_tax_amount,
    total_price, size_sheet, floot, score, height, score_secondary, source_key
  )
  VALUES
    (v_owner_id, v_workspace_id, '2026-10-05', 'SUAI.SPM.862609-001', 'PT. SUAI SUBANG', 'SPM', 'BOX PT 56', '100 X 50 X 31', 100, 0, 0, 91300, 9130000, 1004300, 10134300, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::370'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'PO00786904', 'PT. ISMAYA', 'SPM', 'BOX TAKE AWAY GIANT PIZZA', '48 X 48 X 5', 1500, 0, 0, 7100, 10650000, 0, 10650000, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::371'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'BOTTOM HINO HJP', '', 30, 0, 0, 43045, 1291350, 0, 1291350, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::372'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'BOTTOM CARTON SF HIACE', '', 150, 0, 0, 41526, 6228900, 0, 6228900, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::373'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'LAYER SEGI 4 SF HIACE', '', 600, 0, 0, 2529, 1517400, 0, 1517400, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::374'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'LAYER SEGI 3 TYPE C', '', 2160, 0, 0, 628, 1356480, 0, 1356480, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::375'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'LINNING HINO HJP', '', 100, 0, 0, 12225, 1222500, 0, 1222500, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::376'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'LINNING SF HIACE', '', 300, 0, 0, 15708, 4712400, 0, 4712400, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::377'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'SEGI 3 HINO HJP', '', 750, 0, 0, 1202, 901500, 0, 901500, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::378'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'SEGI 3 K 250 E SF HIACE', '', 1200, 0, 0, 1020, 1224000, 0, 1224000, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::379'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'SEGI 3 T 150 Z SF HIACE', '', 600, 0, 0, 859, 515400, 0, 515400, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::380'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'SEGI 3 T 250 A SF HIACE', '', 600, 0, 0, 1350, 810000, 0, 810000, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::381'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'SEGI 3 T 250 KHUSUS D', '', 1800, 0, 0, 1350, 2430000, 0, 2430000, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::382'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'TOP HINO HJP', '', 125, 0, 0, 16060, 2007500, 0, 2007500, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::383'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'TOP CARTON SF HIACE', '', 150, 0, 0, 15355, 2303250, 0, 2303250, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::384'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'TOP POLYTENER PT 37 NEW', '', 30, 0, 0, 20778, 623340, 0, 623340, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::385'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-001', 'PT. EDS', 'SPM', 'TOP POLYTENER PT 56 NEW', '', 100, 0, 0, 20778, 2077800, 0, 2077800, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::386'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'BOTTOM HINO HJP', '', 185, 0, 0, 43405, 8029925, 0, 8029925, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::387'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'BOTTOM CARTON SF HIACE', '', 150, 0, 0, 41526, 6228900, 0, 6228900, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::388'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'LAYER SEGI 4 SF HIACE', '', 600, 0, 0, 2529, 1517400, 0, 1517400, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::389'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'LAYER SEGI 3 TYPE C', '', 2400, 0, 0, 628, 1507200, 0, 1507200, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::390'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'LINNING HINO HJP', '', 370, 0, 0, 12225, 4523250, 0, 4523250, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::391'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'LINNING SF HIACE', '', 300, 0, 0, 15708, 4712400, 0, 4712400, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::392'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'SEGI 3 HINO HJP', '', 1110, 0, 0, 1202, 1334220, 0, 1334220, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::393'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'SEGI 3 K 250 E SF HIACE', '', 1200, 0, 0, 1020, 1224000, 0, 1224000, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::394'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'SEGI 3 T 150 Z SF HIACE', '', 600, 0, 0, 859, 515400, 0, 515400, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::395'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'SEGI 3 T 250 A SF HIACE', '', 600, 0, 0, 1350, 810000, 0, 810000, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::396'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'SEGI 3 T 250 KHUSUS D', '', 1800, 0, 0, 1350, 2430000, 0, 2430000, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::397'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'SEGI 7 HINO HJP', '', 740, 0, 0, 3864, 2859360, 0, 2859360, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::398'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'TOP HINO HJP', '', 190, 0, 0, 16060, 3051400, 0, 3051400, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::399'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'TOP CARTON SF HIACE', '', 150, 0, 0, 15355, 2303250, 0, 2303250, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::400'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'TOP POLYTENER PT 37 NEW', '', 70, 0, 0, 20778, 1454460, 0, 1454460, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::401'),
    (v_owner_id, v_workspace_id, '2026-10-09', 'EDS/CSP/12G12610-002', 'PT. EDS', 'SPM', 'TOP POLYTENER PT 56 NEW', '', 100, 0, 0, 20778, 2077800, 0, 2077800, '', '', '', '', '', 'PO COSTUMER 2026.xlsx::PO COSTUMER::402')
  ON CONFLICT (workspace_id, source_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Baris PO Oktober baru dimasukkan: % dari 33.', v_inserted;
END $$;

COMMIT;

-- Ringkasan verifikasi: hanya sumber workbook ini dan tanggal Oktober 2026.
SELECT
  COUNT(*) AS jumlah_baris_item,
  COUNT(DISTINCT po_number) AS jumlah_nomor_po,
  COALESCE(SUM(total_price), 0) AS total_po_termasuk_ppn,
  MIN(order_date) AS tanggal_awal,
  MAX(order_date) AS tanggal_akhir
FROM public.customer_orders
WHERE workspace_id = 'a38a0000-0000-4000-8000-000000000001'
  AND source_key LIKE 'PO COSTUMER 2026.xlsx::PO COSTUMER::%'
  AND order_date >= DATE '2026-10-01'
  AND order_date < DATE '2026-11-01';
