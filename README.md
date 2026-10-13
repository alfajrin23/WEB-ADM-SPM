# Ruang Kerja CV Surya Pratama Mandiri

Single-page workspace untuk rekap keuangan, invoice, PO, dan performa produksi. UI memakai JavaScript vanilla; Supabase menyimpan data lintas perangkat. Data Excel awal dibaca lokal dan hanya masuk basis data setelah pengguna memilih lembar, meninjau pratinjau, lalu menjalankan impor.

## Menyiapkan aplikasi

1. Di Supabase, jalankan [`supabase/schema.sql`](supabase/schema.sql) pada SQL Editor.
2. Buat akun email/password pada menu **Authentication → Users** di Supabase, atau gunakan pendaftaran pada layar masuk jika sign-up diaktifkan.
3. Buat `.env.local` dari [.env.example](.env.example) dan isi Project URL serta anon/publishable key. Kunci `service_role` tidak dipakai oleh aplikasi browser.
4. Jalankan `npm install`, lalu `npm run dev`.

## Deploy ke Vercel

Impor repositori GitHub ke tim Vercel, pilih framework **Vite**, lalu tambahkan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` pada Environment Variables. Jalankan deploy setelah schema Supabase selesai dibuat. Jangan tambahkan `SUPABASE_SERVICE_ROLE_KEY` ke environment frontend.

Data mengikuti akun yang digunakan untuk masuk, sehingga akun yang sama dapat dipakai di beberapa perangkat. Kebijakan RLS di schema membatasi setiap akun ke datanya sendiri.

