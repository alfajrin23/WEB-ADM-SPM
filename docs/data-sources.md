# Pemetaan data awal CV SPM

Dokumen ini mencatat bentuk data sumber yang ditinjau untuk menyusun kolom aplikasi dan alur impor. Berkas Excel tetap berada di folder lokal `bahan awal/`; data bisnisnya tidak disalin ke repositori atau dimasukkan ke basis data secara otomatis.

## Yang dicatat tiap workbook

- `PO COSTUMER 2026.xlsx` memiliki lembar `PO COSTUMER` dengan nomor/tanggal PO, customer, barang, ukuran, jumlah dipesan, jumlah `DELIVERY`, harga, dan nilai penjualan. Ini sumber paling langsung untuk membandingkan jumlah pesanan dengan realisasi kirim. Lembar PO supplier tersedia untuk beberapa bulan (termasuk Januari–Maret, September, dan Oktober) dan berisi rincian item bahan per PO.
- `OS CARTON BOX 2026 AOL.xlsx` memuat rekap outstanding invoice per customer pada lembar bulanan yang tersedia (`OS ... 2026`), dengan tanggal invoice/jatuh tempo, PO, nomor invoice, nilai invoice, pembayaran, saldo, dan tanggal bayar. Lembar `PO SUPLAYER SEPTEMBER` dan `PO SUPLAYER OCTOBER` mencatat jumlah order, jumlah kirim, dan nilai sisa/realisasi bahan.
- `SALDO BRI JANUARI.xlsx` memiliki transaksi rekening dengan tanggal, uraian, debit, kredit, saldo, kategori, dan pengaju. Lembar petty cash berisi rincian kas operasional.
- `CARTON.xlsx` berisi rekap bulanan yang menggabungkan PO customer, pembelian bahan sheet, invoice customer, operasional, dan gaji dalam kolom-kolom berdampingan. Lembar kondisi juga memuat rencana kas, tagihan, dan vendor.

## Cara aplikasi membaca performa

Jumlah pesan, diproduksi, dan dikirim disimpan terpisah. Aplikasi menampilkan selisih jumlah dan status keterlambatan hanya jika tanggal janji sudah diisi; tanggal order saja tidak cukup untuk menyimpulkan bahwa produksi terlambat. Status kendala juga tidak ditebak dari selisih jumlah. Pengguna mencatat kendala pada PO sebagai administrasi, material, produksi, kualitas, pengiriman, perubahan pelanggan, atau lainnya, lalu laporan menghitung penyebab yang benar-benar tercatat.

Berkas sumber tidak menyediakan kategori akar masalah atau tanggal janji kirim yang konsisten pada semua baris. Data yang diimpor tanpa nilai tersebut akan ditandai sebagai “belum dicatat”, bukan dianggap sebagai kegagalan produksi atau administrasi.

## Impor

Menu **Impor data** dapat membaca lembar Excel sumber untuk transaksi kas, invoice outstanding, PO customer, dan PO supplier. Aplikasi menampilkan jumlah dan contoh baris sebelum menyimpan ke akun Supabase. Baris impor diberi kunci sumber agar file/lembar/baris yang sama bisa diperbarui saat diimpor ulang. Aplikasi tidak mengunggah berkas mentah.

