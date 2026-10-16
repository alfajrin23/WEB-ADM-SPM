-- Import PO Supplier Oktober 2026 (8 nomor PO, 18 baris item).
-- Tanggal PO tidak tersedia di workbook; mengikuti importer aplikasi: 2026-10-01.
-- Aman dijalankan ulang: PO dengan nomor yang sama untuk owner ini tidak diduplikasi.
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

  INSERT INTO public.supplier_purchase_orders (
    owner_id, workspace_id, po_number, supplier, customer, order_date, items, source_key
  )
  VALUES
    (v_owner_id, v_workspace_id, '115/SPM-EDS/X/26', 'TOBA', 'EDS', DATE '2026-10-01',
      $json$[
        {"item":"SHEET","qlty":"BF","sizeSheet":"104 X 116","qtyOrder":300,"qtyKirim":0,"harga":4890},
        {"item":"SHEET","qlty":"BF","sizeSheet":"102 X 83","qtyOrder":300,"qtyKirim":295,"harga":3397},
        {"item":"SHEET","qlty":"BCF","sizeSheet":"146 X 138","qtyOrder":350,"qtyKirim":360,"harga":13642}
      ]$json$::jsonb,
      'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::4'),
    (v_owner_id, v_workspace_id, '116/SPM-BBL/X/26', 'PGC', 'BBL', DATE '2026-10-01',
      $json$[
        {"item":"SHEET","qlty":"BCF","sizeSheet":"238 X 71,6","qtyOrder":800,"qtyKirim":800,"harga":18796}
      ]$json$::jsonb,
      'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::7'),
    (v_owner_id, v_workspace_id, '117/SPM-EDS/X/26', 'TOBA', 'EDS', DATE '2026-10-01',
      $json$[
        {"item":"SHEET","qlty":"BCF","sizeSheet":"123,5 X 123,5","qtyOrder":300,"qtyKirim":300,"harga":10715},
        {"item":"SHEET","qlty":"BCF","sizeSheet":"128,5 X 108,5","qtyOrder":300,"qtyKirim":285,"harga":9863}
      ]$json$::jsonb,
      'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::8'),
    (v_owner_id, v_workspace_id, '118/SPM-EDS/X/26', 'TOBA', 'EDS', DATE '2026-10-01',
      $json$[
        {"item":"SHEET","qlty":"BCF","sizeSheet":"142,5 X 51","qtyOrder":700,"qtyKirim":740,"harga":4773},
        {"item":"SHEET","qlty":"BCF","sizeSheet":"161 X 35","qtyOrder":500,"qtyKirim":0,"harga":3784},
        {"item":"SHEET","qlty":"BF","sizeSheet":"126 X  50","qtyOrder":1000,"qtyKirim":0,"harga":2408},
        {"item":"SHEET","qlty":"BCF","sizeSheet":"96 X 54","qtyOrder":500,"qtyKirim":490,"harga":3423},
        {"item":"SHEET","qlty":"BCF","sizeSheet":"86 X 33,1","qtyOrder":2500,"qtyKirim":1660,"harga":1850}
      ]$json$::jsonb,
      'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::10'),
    (v_owner_id, v_workspace_id, '119/SPM-ERGEBE/X/26', 'TOBA', 'ERGEBE', DATE '2026-10-01',
      $json$[
        {"item":"SHEET","qlty":"BCF","sizeSheet":"192 X 67,6","qtyOrder":300,"qtyKirim":310,"harga":10433}
      ]$json$::jsonb,
      'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::15'),
    (v_owner_id, v_workspace_id, '120/SPM-EDS/X/26', 'TOBA', 'EDS', DATE '2026-10-01',
      $json$[
        {"item":"SHEET","qlty":"BCF","sizeSheet":"198,5 X 96,3","qtyOrder":300,"qtyKirim":300,"harga":13248},
        {"item":"SHEET","qlty":"BCF","sizeSheet":"218 X 89,6","qtyOrder":350,"qtyKirim":350,"harga":14550},
        {"item":"SHEET","qlty":"BCF","sizeSheet":"220 X 120","qtyOrder":300,"qtyKirim":300,"harga":17829}
      ]$json$::jsonb,
      'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::16'),
    (v_owner_id, v_workspace_id, '121/SPM-AKEBONO/X/26', 'TOBA', 'AKEBONO', DATE '2026-10-01',
      $json$[
        {"item":"SHEET","qlty":"BF","sizeSheet":"180 X 33,2","qtyOrder":1500,"qtyKirim":1500,"harga":2575},
        {"item":"SHEET","qlty":"BF","sizeSheet":"180 X 41,1","qtyOrder":600,"qtyKirim":600,"harga":3393}
      ]$json$::jsonb,
      'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::20'),
    (v_owner_id, v_workspace_id, '123/SPM-HM/X/26', 'YOGAMA', 'HANAMASTER', DATE '2026-10-01',
      $json$[
        {"item":"TRAY","qlty":"PET","sizeSheet":"TICNES 0,3","qtyOrder":3000,"qtyKirim":0,"harga":1925}
      ]$json$::jsonb,
      'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::21')
  ON CONFLICT (owner_id, po_number) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'PO supplier Oktober baru dimasukkan: % dari 8.', v_inserted;
END $$;

COMMIT;

-- Ringkasan verifikasi: hanya PO dari workbook ini pada Oktober 2026.
SELECT
  COUNT(*) AS jumlah_po,
  COALESCE(SUM(jsonb_array_length(items)), 0) AS jumlah_baris_item,
  MIN(order_date) AS tanggal_awal,
  MAX(order_date) AS tanggal_akhir
FROM public.supplier_purchase_orders
WHERE workspace_id = 'a38a0000-0000-4000-8000-000000000001'
  AND source_key LIKE 'po supplier oktober.xlsx::PO SUPLAYER OCTOBER::%'
  AND order_date >= DATE '2026-10-01'
  AND order_date < DATE '2026-11-01';
