# Ruang Kerja CV Surya Pratama Mandiri

Single-page workspace untuk rekap keuangan, invoice, PO, dan performa produksi. Data disimpan di Supabase agar dapat dibuka lintas perangkat. Workbook Excel dibaca di perangkat dan baru dikirim ke basis data setelah pengguna memilih lembar, meninjau pratinjau, lalu menjalankan impor.

## Menyiapkan aplikasi

1. Buat akun Supabase untuk `dev@spm.com` jika belum ada.
2. Jalankan [`supabase/schema.sql`](supabase/schema.sql) pada SQL Editor. Script membuat workspace perusahaan, menghubungkan akun yang sudah ada, dan menetapkan `dev@spm.com` sebagai developer.
3. Buat `.env.local` dari [.env.example](.env.example) dan isi Project URL serta anon/publishable key. `service_role` tidak digunakan oleh aplikasi browser.
4. Jalankan `npm install`, lalu `npm run dev`.

Akun lama yang ada saat schema dijalankan menjadi staff, kecuali `dev@spm.com`. Akun baru mendaftar sebagai staff dan perlu diberi akses dari menu **Log Input** oleh developer. Developer dapat mengubah peran akun lain. Staff dan developer menggunakan data operasional workspace yang sama; hanya developer yang dapat membuka log perubahan dan pengaturan akses akun. RLS Supabase menerapkan akses tersebut di database.

## Deploy ke Vercel

Impor repositori GitHub ke tim Vercel, pilih framework **Vite**, lalu tambahkan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` pada Environment Variables. Jalankan deploy setelah schema Supabase selesai dibuat. Jangan masukkan `SUPABASE_SERVICE_ROLE_KEY` ke environment frontend.

Logo dan favicon menggunakan berkas proyek `favicon logo.png`, yang disalin ke `public/brand-logo.png` dan `public/favicon.png` untuk disajikan oleh Vite.
