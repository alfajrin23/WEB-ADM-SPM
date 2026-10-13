import {
  CAUSES, CASH_CATEGORIES, downloadCsv, escapeHtml as esc, formatDate, icon, integer,
  inMonth, monthName, orderProgress, rupiah, statusForInvoice,
} from './helpers.js';
import { priceSpecs, pricelist } from './pricelist-data.js';

const money = (value) => rupiah(value);
const smallButton = (label, action, attrs = '', glyph = 'edit', extra = '') =>
  `<button class="icon-button ${extra}" type="button" data-act="${action}" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${icon(glyph, 16)}</button>`;
const actionButton = (label, action, attrs = '', glyph = 'plus', style = 'primary') =>
  `<button class="button ${style}" type="button" data-act="${action}" ${attrs}>${icon(glyph, 17)}<span>${esc(label)}</span></button>`;
const emptyState = (title, text, action = '', label = '', glyph = 'package') => `
  <div class="empty-state"><div class="empty-icon">${icon(glyph, 26)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>
    ${action ? actionButton(label, action) : ''}</div>`;
const periodFilter = (month) => `<label class="month-control"><span>Periode</span><input aria-label="Pilih periode" data-filter="month" type="month" value="${esc(month)}"></label>`;
const card = (label, value, glyph, tone, caption = '') => `
  <article class="metric-card tone-${tone}"><div class="metric-top"><span>${esc(label)}</span><span class="metric-icon">${icon(glyph, 18)}</span></div>
  <strong>${value}</strong>${caption ? `<small>${caption}</small>` : ''}</article>`;
const pageHead = (eyebrow, title, text, actions = '') => `
  <section class="page-heading"><div class="print-brand"><img src="/brand-mark.svg" alt=""><span><strong>CV SURYA PRATAMA MANDIRI</strong><small>Laporan PO supplier</small></span></div><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p>${esc(text)}</p></div><div class="heading-actions">${actions}</div></section>`;
const tableWrap = (content) => `<div class="table-wrap">${content}</div>`;

export function renderSignIn(mode, message = '') {
  const signup = mode === 'signup';
  return `<main class="auth-screen"><section class="auth-card">
    <img src="/brand-mark.svg" alt="" class="auth-logo"><p class="eyebrow">CV SURYA PRATAMA MANDIRI</p>
    <h1>${signup ? 'Mulai ruang kerja Anda' : 'Selamat datang kembali'}</h1>
    <p class="auth-copy">Catatan keuangan dan produksi tersimpan di akun Anda dan bisa dibuka dari perangkat lain.</p>
    ${message ? `<div class="notice notice-info">${icon('alert', 17)}<span>${esc(message)}</span></div>` : ''}
    <form data-form="auth" data-mode="${signup ? 'signup' : 'login'}" class="form-stack">
      <label class="field"><span>Email</span><input required autocomplete="email" type="email" name="email" placeholder="nama@perusahaan.com"></label>
      <label class="field"><span>Kata sandi</span><input required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" type="password" name="password" placeholder="Minimal 8 karakter"></label>
      <button class="button primary button-wide" type="submit">${icon(signup ? 'plus' : 'check', 17)}<span>${signup ? 'Buat akun' : 'Masuk'}</span></button>
    </form>
    <p class="auth-switch">${signup ? 'Sudah memiliki akun?' : 'Belum memiliki akun?'}
      <button type="button" data-act="auth-mode" data-mode="${signup ? 'login' : 'signup'}">${signup ? 'Masuk' : 'Daftar akun'}</button>
    </p>
    <div class="auth-foot">Data akun dipisahkan oleh kebijakan akses Supabase.</div>
  </section></main>`;
}

function statStrip(label, value, caption = '') {
  return `<div class="stat-strip"><span>${esc(label)}</span><strong>${value}</strong>${caption ? `<small>${caption}</small>` : ''}</div>`;
}

function metricCards(data, month) {
  const invoices = data.sales_invoices.filter((row) => inMonth(row.invoice_date, month));
  const cash = data.cashflow_transactions.filter((row) => inMonth(row.transaction_date, month));
  const sales = invoices.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const materials = cash.filter((row) => ['material bahan', 'subcon'].includes(String(row.category).toLowerCase()) && row.kind === 'debit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const wages = cash.filter((row) => String(row.category).toLowerCase().includes('gaji') && row.kind === 'debit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const ops = cash.filter((row) => row.kind === 'debit' && !String(row.category).toLowerCase().includes('gaji') && !['material bahan', 'subcon'].includes(String(row.category).toLowerCase())).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const open = data.sales_invoices.reduce((sum, row) => sum + Number(row.outstanding_amount ?? Math.max(Number(row.amount) - Number(row.paid_amount || 0), 0)), 0);
  const expenses = cash.filter((row) => row.kind === 'debit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return [
    card('Penjualan · invoice', money(sales), 'trend', 'green', `${invoices.length} invoice pada periode ini`),
    card('Bahan & subcon', money(materials), 'package', 'orange', 'Dari transaksi kas yang dikategorikan'),
    card('Operasional', money(ops), 'factory', 'blue', 'Termasuk fee market, listrik, dan biaya lain'),
    card('Gaji', money(wages), 'users', 'violet', 'Gaji staff dan produksi'),
    card('Margin indikatif', money(sales - expenses), 'chart', 'gold', 'Invoice dikurangi debit kas tercatat'),
    card('Outstanding invoice', money(open), 'file', 'red', `${data.sales_invoices.filter((row) => statusForInvoice(row)[0] !== 'paid').length} invoice belum lunas`),
  ].join('');
}

function productionSummary(data, month) {
  const orders = data.customer_orders.filter((row) => inMonth(row.order_date, month));
  const ordered = orders.reduce((sum, row) => sum + Number(row.qty_order || 0), 0);
  const produced = orders.reduce((sum, row) => sum + Number(row.qty_produced || 0), 0);
  const delivered = orders.reduce((sum, row) => sum + Number(row.qty_delivered || 0), 0);
  const percent = ordered ? Math.min(100, delivered / ordered * 100) : 0;
  const late = orders.filter((row) => orderProgress(row)[0] === 'late');
  const missingDue = orders.filter((row) => !row.due_date).length;
  const orderIds = new Set(late.map((row) => row.id));
  const assigned = new Set(data.production_events.filter((row) => orderIds.has(row.customer_order_id) && row.status === 'open').map((row) => row.customer_order_id));
  const unassigned = late.filter((row) => !assigned.has(row.id)).length;
  return { orders, ordered, produced, delivered, percent, late, missingDue, unassigned };
}

function monthlyChart(data, month) {
  if (!month) return emptyState('Pilih periode', 'Pilih satu bulan untuk melihat tren penjualan dan pengeluaran.');
  const [year, number] = month.split('-').map(Number);
  const periods = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(year, number - 6 + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
  const rows = periods.map((period) => {
    const sales = data.sales_invoices.filter((row) => inMonth(row.invoice_date, period)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const cost = data.cashflow_transactions.filter((row) => inMonth(row.transaction_date, period) && row.kind === 'debit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { period, sales, cost };
  });
  const maximum = Math.max(1, ...rows.flatMap((row) => [row.sales, row.cost]));
  if (!rows.some((row) => row.sales || row.cost)) return emptyState('Belum ada pergerakan kas', 'Impor invoice atau transaksi kas untuk mulai melihat pola bulanan.', 'open-import', 'Impor data', 'chart');
  return `<div class="trend-chart" role="img" aria-label="Tren nilai invoice dan debit kas selama enam bulan">
    ${rows.map((row) => `<div class="trend-column"><div class="trend-bars"><span class="trend-bar sales-bar" title="Invoice ${money(row.sales)}" style="height:${Math.max(row.sales ? 4 : 0, row.sales / maximum * 100)}%"></span><span class="trend-bar cost-bar" title="Debit ${money(row.cost)}" style="height:${Math.max(row.cost ? 4 : 0, row.cost / maximum * 100)}%"></span></div><small>${esc(new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(new Date(`${row.period}-01T12:00:00`)))}</small></div>`).join('')}
  </div><div class="chart-legend"><span><i class="legend-dot sales-dot"></i>Invoice</span><span><i class="legend-dot cost-dot"></i>Debit kas</span></div>`;
}

function causeChart(data, month) {
  const events = data.production_events.filter((row) => row.status === 'open' && inMonth(row.event_date, month));
  const counts = CAUSES.map(([key, label]) => ({ key, label, count: events.filter((row) => row.cause_category === key).length }));
  const max = Math.max(1, ...counts.map((row) => row.count));
  if (!events.length) return emptyState('Belum ada kendala tercatat', 'Catat penyebab pada PO yang tertahan agar laporan dapat membedakan administrasi, material, dan produksi.', 'new-production', 'Catat PO customer', 'alert');
  return `<div class="cause-list">${counts.filter((row) => row.count).sort((a, b) => b.count - a.count).map((row) => `
    <div class="cause-row"><div><span>${esc(row.label)}</span><b>${row.count}</b></div><div class="cause-track"><i style="width:${row.count / max * 100}%"></i></div></div>`).join('')}</div>
    <p class="subtle-note">Kategori mengikuti kendala yang dicatat pengguna; jumlah selisih saja tidak digunakan untuk menebak penyebab.</p>`;
}

function dashboard(data, state) {
  const month = state.month;
  const [year, selectedMonth] = month.split('-').map(Number);
  const monthPills = `<div class="month-strip"><span class="month-year"><button type="button" aria-label="Tahun sebelumnya" data-act="change-year" data-delta="-1">${icon('chevron', 14)}</button><b>${year}</b><button type="button" aria-label="Tahun berikutnya" data-act="change-year" data-delta="1">${icon('chevron', 14)}</button></span><div class="month-pills">${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'].map((label, index) => `<button type="button" class="month-pill ${index + 1 === selectedMonth ? 'active' : ''}" aria-pressed="${index + 1 === selectedMonth}" data-act="select-month" data-month="${year}-${String(index + 1).padStart(2, '0')}">${label}</button>`).join('')}</div></div>`;
  const perf = productionSummary(data, month);
  const invoices = data.sales_invoices.filter((row) => statusForInvoice(row)[0] !== 'paid').sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).slice(0, 5);
  const adminMissing = perf.orders.filter((row) => !row.customer || !row.po_number || !row.item || !row.due_date).length;
  const balance = Number(data.company_settings[0]?.opening_balance || 0) + data.cashflow_transactions.filter((row) => !data.company_settings[0]?.opening_balance_date || row.transaction_date >= data.company_settings[0].opening_balance_date).reduce((sum, row) => sum + (row.kind === 'credit' ? 1 : -1) * Number(row.amount || 0), 0);
  return `${pageHead('RINGKASAN · ' + monthName(month), 'Kinerja dalam satu pandangan', 'Lihat arus uang, posisi invoice, serta selisih pesanan dengan hasil kirim. Angka mengikuti data yang sudah dicatat.', actionButton('Impor data', 'open-import', '', 'upload', 'secondary'))}${monthPills}
    <div class="metric-grid">${metricCards(data, month)}</div>
    <section class="focus-grid">
      <article class="panel production-focus"><div class="panel-heading"><div><p class="eyebrow">PESANAN CUSTOMER</p><h2>Realisasi kirim</h2><p>Jumlah barang yang dikirim dibanding jumlah yang dipesan.</p></div><span class="focus-icon">${icon('factory', 22)}</span></div>
        <div class="delivery-line"><strong>${integer(perf.delivered)}</strong><span>dari ${integer(perf.ordered)} unit</span></div>
        <div class="progress-track"><i style="width:${perf.percent}%"></i></div><div class="progress-meta"><span>${perf.percent.toFixed(1).replace('.', ',')}% terealisasi</span><span>${integer(Math.max(perf.ordered - perf.delivered, 0))} unit tersisa</span></div>
        <div class="mini-stats">${statStrip('Diproduksi', integer(perf.produced))}${statStrip('Lewat tanggal janji', integer(perf.late.length))}${statStrip('Tanggal janji kosong', integer(perf.missingDue))}</div>
        ${perf.unassigned ? `<div class="notice notice-warn">${icon('alert', 16)}<span>${perf.unassigned} PO lewat tanggal janji belum memiliki kendala tercatat.</span></div>` : ''}
      </article>
      <article class="panel trend-panel"><div class="panel-heading"><div><p class="eyebrow">ARUS BULANAN</p><h2>Invoice & pengeluaran</h2><p>Nilai invoice dan debit kas dalam enam bulan terakhir.</p></div>${icon('chart', 21)}</div>${monthlyChart(data, month)}</article>
    </section>
    <section class="detail-grid">
      <article class="panel"><div class="panel-heading"><div><p class="eyebrow">AKAR KENDALA</p><h2>Kendala yang tercatat</h2><p>Hitung kendala terbuka berdasarkan kategori.</p></div>${icon('alert', 20)}</div>${causeChart(data, month)}</article>
      <article class="panel"><div class="panel-heading"><div><p class="eyebrow">KELENGKAPAN DATA</p><h2>Administrasi PO</h2><p>Kolom yang perlu dilengkapi sebelum keterlambatan bisa dinilai.</p></div>${icon('file', 20)}</div>
        <div class="admin-score"><strong>${perf.orders.length ? Math.round((perf.orders.length - adminMissing) / perf.orders.length * 100) : 0}%</strong><span>PO lengkap untuk penilaian</span></div>
        <div class="admin-checks"><div><span>${icon('check', 15)} Nomor PO, customer & barang</span><b>${integer(perf.orders.filter((row) => row.po_number && row.customer && row.item).length)} / ${integer(perf.orders.length)}</b></div><div><span>${icon('clock', 15)} Tanggal janji kirim</span><b>${integer(perf.orders.filter((row) => row.due_date).length)} / ${integer(perf.orders.length)}</b></div></div>
        <p class="subtle-note">Data sumber tidak selalu memiliki tanggal janji. PO tanpa tanggal janji tidak ditandai terlambat.</p>
      </article>
    </section>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">PIUTANG CUSTOMER</p><h2>Invoice yang masih terbuka</h2></div><div class="heading-actions"><button class="text-button" type="button" data-act="navigate" data-tab="tagihan">Lihat semua ${icon('chevron', 15)}</button><button class="button secondary" type="button" data-act="export" data-kind="dashboard-invoices">${icon('download', 16)}<span>Export CSV</span></button></div></div>
      ${invoices.length ? tableWrap(`<table><thead><tr><th>Customer</th><th>No. invoice</th><th>Jatuh tempo</th><th>Sisa</th><th>Status</th></tr></thead><tbody>${invoices.map((row) => { const [key, label] = statusForInvoice(row); return `<tr><td>${esc(row.customer)}</td><td class="mono">${esc(row.invoice_number)}</td><td>${formatDate(row.due_date)}</td><td class="numeric">${money(row.outstanding_amount ?? Math.max(row.amount - (row.paid_amount || 0), 0))}</td><td><span class="status status-${key}">${esc(label)}</span></td></tr>`; }).join('')}</tbody></table>`) : emptyState('Belum ada invoice', 'Catat invoice atau impor rekap outstanding agar daftar piutang muncul.', 'new-invoice', 'Tambah invoice', 'file')}
    </section><div class="balance-ribbon"><span>${icon('wallet', 18)} Saldo kas berjalan</span><strong>${money(balance)}</strong><small>Berdasarkan saldo awal dan transaksi setelah tanggal saldo awal.</small></div>`;
}

function cashflow(data, state) {
  const month = state.month;
  const all = [...data.cashflow_transactions].sort((a, b) => (a.transaction_date || '').localeCompare(b.transaction_date || ''));
  const settings = data.company_settings[0] || {};
  let running = Number(settings.opening_balance || 0);
  const balanceMap = new Map();
  for (const row of all) {
    if (!settings.opening_balance_date || row.transaction_date >= settings.opening_balance_date) running += (row.kind === 'credit' ? 1 : -1) * Number(row.amount || 0);
    balanceMap.set(row.id, running);
  }
  const filtered = all.filter((row) => inMonth(row.transaction_date, month) && (!state.category || row.category === state.category) && (!state.search || `${row.category} ${row.requester} ${row.description}`.toLowerCase().includes(state.search.toLowerCase())));
  const credit = filtered.filter((row) => row.kind === 'credit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const debit = filtered.filter((row) => row.kind === 'debit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const categories = [...new Set([...CASH_CATEGORIES, ...data.cashflow_transactions.map((row) => row.category)])];
  const categoryPills = categories.map((category) => {
    const total = filtered.filter((row) => row.category === category).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (!total) return '';
    return `<button type="button" class="category-chip ${state.category === category ? 'selected' : ''}" data-act="filter-category" data-category="${esc(category)}"><span>${esc(category)}</span><b>${money(total)}</b></button>`;
  }).join('');
  const groups = new Map();
  filtered.forEach((row) => { const key = String(row.transaction_date || '').slice(0, 7) || 'tanpa tanggal'; groups.set(key, [...(groups.get(key) || []), row]); });
  const tableRows = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([period, entries]) => {
    const periodDebit = entries.filter((row) => row.kind === 'debit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const rows = [...entries].sort((a, b) => (a.transaction_date || '').localeCompare(b.transaction_date || '')).map((row) => `<tr data-row-id="${row.id}"><td>${formatDate(row.transaction_date)}</td><td><span class="tag">${esc(row.category)}</span></td><td>${esc(row.requester || '—')}</td><td>${esc(row.description || '—')}</td><td class="numeric ${row.kind === 'debit' ? 'debit' : ''}">${row.kind === 'debit' ? money(row.amount) : '—'}</td><td class="numeric credit">${row.kind === 'credit' ? money(row.amount) : '—'}</td><td class="numeric">${money(balanceMap.get(row.id))}</td><td class="row-actions">${smallButton('Edit transaksi', 'edit', `data-table="cashflow_transactions" data-id="${row.id}"`)}${smallButton('Hapus transaksi', 'delete', `data-table="cashflow_transactions" data-id="${row.id}"`, 'trash', 'danger-icon')}</td></tr>`).join('');
    return `${rows}<tr class="total-row"><td colspan="4">Total pengeluaran ${esc(period === 'tanpa tanggal' ? '' : monthName(period))}</td><td class="numeric">${money(periodDebit)}</td><td colspan="3"></td></tr>`;
  }).join('');
  const endBalance = Number(settings.opening_balance || 0) + all.filter((row) => !settings.opening_balance_date || row.transaction_date >= settings.opening_balance_date).reduce((sum, row) => sum + (row.kind === 'credit' ? 1 : -1) * Number(row.amount || 0), 0);
  return `${pageHead('KEUANGAN', 'Cashflow', 'Lacak setiap rupiah masuk dan keluar, kategori biaya, serta saldo berjalan.', actionButton('Tambah transaksi', 'new-cashflow', '', 'plus'))}
    <section class="opening-card"><div><p class="eyebrow">SALDO AWAL</p><h2>${money(settings.opening_balance || 0)}</h2><p>Basis saldo dari ${formatDate(settings.opening_balance_date)}</p></div>${actionButton('Atur saldo awal', 'edit-opening', '', 'edit', 'secondary')}</section>
    <div class="summary-grid">${statStrip('Saldo berjalan', money(endBalance))}${statStrip('Uang masuk', money(credit))}${statStrip('Uang keluar', money(debit))}${statStrip('Transaksi periode ini', integer(filtered.length))}</div>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">KATEGORI</p><h2>Ringkas berdasarkan kategori</h2></div>${icon('filter', 20)}</div><div class="category-chips">${categoryPills || '<span class="subtle-note">Belum ada transaksi pada periode ini.</span>'}</div></section>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">BUKU KAS</p><h2>Rincian transaksi</h2></div>${actionButton('Export CSV', 'export', 'data-kind="cashflow"', 'download', 'secondary')}</div>
      <div class="toolbar"><label class="search-field">${icon('search', 17)}<input aria-label="Cari transaksi" data-filter="search" value="${esc(state.search)}" placeholder="Cari pengajuan atau keterangan"></label><select class="select-compact" data-filter="cashCategory"><option value="">Semua kategori</option>${categories.map((category) => `<option value="${esc(category)}" ${category === state.category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></div>
      ${filtered.length ? tableWrap(`<table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Pengaju</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo</th><th></th></tr></thead><tbody>${tableRows}</tbody></table>`) : emptyState('Belum ada transaksi', 'Tambahkan transaksi pertama atau impor mutasi rekening BRI.', 'new-cashflow', 'Tambah transaksi', 'wallet')}
    </section>`;
}

function supplierReceivables(data) {
  const groups = new Map();
  data.supplier_ledger_entries.forEach((row) => groups.set(row.supplier, [...(groups.get(row.supplier) || []), row]));
  const summary = [...groups.entries()].map(([name, rows]) => ({
    name, rows: rows.sort((a, b) => (a.entry_date || '').localeCompare(b.entry_date || '')),
    billed: rows.filter((row) => row.entry_type === 'bill').reduce((sum, row) => sum + Number(row.amount || 0), 0),
    paid: rows.filter((row) => row.entry_type === 'payment').reduce((sum, row) => sum + Number(row.amount || 0), 0),
  })).map((row) => ({ ...row, balance: row.billed - row.paid }));
  return summary;
}

function payables(data, state) {
  const groups = supplierReceivables(data);
  const open = groups.filter((row) => row.balance > 0);
  const openTotal = open.reduce((sum, row) => sum + row.balance, 0);
  const supplierCards = groups.sort((a, b) => a.name.localeCompare(b.name)).map((supplier) => {
    const expanded = state.expandedSuppliers.has(supplier.name);
    let balance = 0;
    const details = supplier.rows.map((row) => {
      balance += row.entry_type === 'bill' ? Number(row.amount) : -Number(row.amount);
      return `<tr><td>${formatDate(row.entry_date)}</td><td>${row.entry_type === 'bill' ? 'Tagihan' : 'Pembayaran'}</td><td>${esc(row.description || '—')}</td><td class="numeric">${row.entry_type === 'payment' ? money(row.amount) : '—'}</td><td class="numeric">${money(balance)}</td><td>${smallButton('Hapus catatan', 'delete', `data-table="supplier_ledger_entries" data-id="${row.id}"`, 'trash', 'danger-icon')}</td></tr>`;
    }).join('');
    return `<article class="supplier-card"><div class="supplier-card-head"><div><span class="eyebrow">PEMASOK</span><h3>${esc(supplier.name)}</h3></div><div class="supplier-balance"><small>Sisa piutang</small><strong>${money(supplier.balance)}</strong></div></div><div class="supplier-card-meta"><span>Total tagihan ${money(supplier.billed)}</span><span>${supplier.rows.length} catatan</span></div><div class="supplier-card-actions">${actionButton('Catat bayar', 'new-supplier-payment', `data-supplier="${esc(supplier.name)}"`, 'wallet', 'secondary')}<button type="button" class="text-button" data-act="toggle-supplier" data-supplier="${esc(supplier.name)}">${icon(expanded ? 'close' : 'file', 15)} ${expanded ? 'Tutup rincian' : 'Rincian pembayaran'}</button></div>${expanded ? tableWrap(`<table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Keterangan</th><th>Dibayar</th><th>Sisa berjalan</th><th></th></tr></thead><tbody>${details}</tbody></table>`) : ''}</article>`;
  }).join('');
  return `${pageHead('KEUANGAN', 'Piutang pemasok', 'Catat tagihan sheet dan pembayaran vendor untuk mengetahui sisa kewajiban.', `${actionButton('Export CSV', 'export', 'data-kind="supplier-ledger"', 'download', 'secondary')}${actionButton('Tagihan baru', 'new-supplier-bill', '', 'plus')}`)}
    <div class="summary-grid">${statStrip('Piutang terbuka', money(openTotal))}${statStrip('Pemasok aktif', integer(open.length))}${statStrip('Sudah lunas', integer(groups.filter((row) => row.billed > 0 && row.balance <= 0).length))}</div>
    <div class="supplier-list">${supplierCards || emptyState('Belum ada catatan pemasok', 'Tambahkan tagihan bahan pertama untuk mulai melacak saldo vendor.', 'new-supplier-bill', 'Tambah tagihan', 'package')}</div>`;
}

function invoices(data, state) {
  const rows = data.sales_invoices.filter((row) => inMonth(row.invoice_date, state.month) && (!state.invoiceStatus || statusForInvoice(row)[0] === state.invoiceStatus) && (!state.search || `${row.customer} ${row.invoice_number} ${row.po_number}`.toLowerCase().includes(state.search.toLowerCase()))).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const balance = rows.reduce((sum, row) => sum + Number(row.outstanding_amount ?? Math.max(row.amount - (row.paid_amount || 0), 0)), 0);
  const table = rows.map((row) => {
    const [key, label] = statusForInvoice(row);
    const amount = Number(row.outstanding_amount ?? Math.max(row.amount - (row.paid_amount || 0), 0));
    return `<tr class="invoice-${key}" data-row-id="${row.id}"><td>${formatDate(row.invoice_date)}</td><td>${formatDate(row.due_date)}</td><td>${esc(row.customer)}</td><td class="mono">${esc(row.invoice_number)}</td><td class="mono">${esc(row.po_number || '—')}</td><td class="numeric">${money(row.amount)}</td><td class="numeric">${money(amount)}</td><td><button class="status status-${key} status-button" type="button" data-act="toggle-invoice" data-id="${row.id}" title="Klik untuk mengubah status">${key === 'paid' ? icon('check', 13) : key === 'late' ? icon('alert', 13) : icon('clock', 13)}${esc(label)}</button></td><td class="row-actions">${smallButton('Edit invoice', 'edit', `data-table="sales_invoices" data-id="${row.id}"`)}${smallButton('Hapus invoice', 'delete', `data-table="sales_invoices" data-id="${row.id}"`, 'trash', 'danger-icon')}</td></tr>`;
  }).join('');
  return `${pageHead('KEUANGAN', 'Tagihan customer', 'Pantau tanggal jatuh tempo dan pembayaran invoice tanpa mencampur nilai tagihan dengan kas masuk.', actionButton('Invoice baru', 'new-invoice', '', 'plus'))}
    <div class="summary-grid">${statStrip('Nilai invoice', money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)))}${statStrip('Outstanding', money(balance))}${statStrip('Terlambat', integer(rows.filter((row) => statusForInvoice(row)[0] === 'late').length))}${statStrip('Invoice', integer(rows.length))}</div>
    <section class="panel"><div class="toolbar"><label class="search-field">${icon('search', 17)}<input aria-label="Cari invoice" data-filter="search" value="${esc(state.search)}" placeholder="Cari customer, PO, atau invoice"></label><select class="select-compact" data-filter="invoiceStatus"><option value="">Semua status</option><option value="open" ${state.invoiceStatus === 'open' ? 'selected' : ''}>Belum dibayar</option><option value="late" ${state.invoiceStatus === 'late' ? 'selected' : ''}>Jatuh tempo</option><option value="partial" ${state.invoiceStatus === 'partial' ? 'selected' : ''}>Sebagian dibayar</option><option value="paid" ${state.invoiceStatus === 'paid' ? 'selected' : ''}>Lunas</option></select>${actionButton('Export CSV', 'export', 'data-kind="invoices"', 'download', 'secondary')}</div>
      ${rows.length ? tableWrap(`<table><thead><tr><th>Tanggal invoice</th><th>Jatuh tempo</th><th>Customer</th><th>No. invoice</th><th>No. PO</th><th>Nilai</th><th>Sisa</th><th>Status</th><th></th></tr></thead><tbody>${table}</tbody></table>`) : emptyState('Belum ada invoice di periode ini', 'Tambahkan tagihan customer atau impor workbook OS CARTON BOX.', 'new-invoice', 'Tambah invoice', 'file')}
    </section>`;
}

function production(data, state) {
  const orders = data.customer_orders.filter((row) => inMonth(row.order_date, state.month) && (!state.search || `${row.po_number} ${row.customer} ${row.item}`.toLowerCase().includes(state.search.toLowerCase()))).sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''));
  const currentIds = new Set(orders.map((row) => row.id));
  const events = data.production_events.filter((row) => inMonth(row.event_date, state.month) && currentIds.has(row.customer_order_id)).sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));
  const ordered = orders.reduce((sum, row) => sum + Number(row.qty_order || 0), 0);
  const delivered = orders.reduce((sum, row) => sum + Number(row.qty_delivered || 0), 0);
  const overdue = orders.filter((row) => orderProgress(row)[0] === 'late').length;
  const lines = orders.map((row) => {
    const [key, label] = orderProgress(row);
    const progress = row.qty_order ? Math.min(100, Number(row.qty_delivered || 0) / Number(row.qty_order) * 100) : 0;
    const reasons = data.production_events.filter((event) => event.customer_order_id === row.id && event.status === 'open');
    return `<tr class="production-${key}" data-row-id="${row.id}"><td>${formatDate(row.order_date)}</td><td>${formatDate(row.due_date)}</td><td class="mono">${esc(row.po_number || '—')}</td><td>${esc(row.customer)}</td><td>${esc(row.item)}<small class="table-sub">${esc(row.size || '')}</small></td><td class="numeric">${integer(row.qty_order)}</td><td class="numeric">${integer(row.qty_produced)}</td><td class="numeric">${integer(row.qty_delivered)}</td><td><div class="table-progress"><i style="width:${progress}%"></i></div><small>${progress.toFixed(0)}%</small></td><td><span class="status status-${key}">${esc(label)}</span>${reasons.length ? `<small class="table-sub">${reasons.length} kendala aktif</small>` : ''}</td><td class="row-actions">${smallButton('Catat kendala', 'new-event', `data-order="${row.id}"`, 'alert')}${smallButton('Update realisasi', 'edit-quantities', `data-id="${row.id}"`)}${smallButton('Edit PO', 'edit', `data-table="customer_orders" data-id="${row.id}"`)}${smallButton('Hapus PO', 'delete', `data-table="customer_orders" data-id="${row.id}"`, 'trash', 'danger-icon')}</td></tr>`;
  }).join('');
  const eventRows = events.map((row) => {
    const order = data.customer_orders.find((item) => item.id === row.customer_order_id);
    const cause = CAUSES.find(([key]) => key === row.cause_category)?.[1] || row.cause_category;
    return `<tr><td>${formatDate(row.event_date)}</td><td>${esc(order?.po_number || '—')} · ${esc(order?.customer || 'PO dihapus')}</td><td><span class="tag">${esc(cause)}</span></td><td>${esc(row.cause_detail)}</td><td class="numeric">${integer(row.affected_qty)}</td><td><button class="status status-${row.status === 'open' ? 'late' : 'paid'} status-button" type="button" data-act="toggle-event" data-id="${row.id}">${row.status === 'open' ? 'Terbuka' : 'Selesai'}</button></td><td class="row-actions">${smallButton('Edit kendala', 'edit', `data-table="production_events" data-id="${row.id}"`)}${smallButton('Hapus kendala', 'delete', `data-table="production_events" data-id="${row.id}"`, 'trash', 'danger-icon')}</td></tr>`;
  }).join('');
  return `${pageHead('OPERASIONAL', 'Performa produksi', 'Bandingkan pesanan, jumlah diproduksi, dan jumlah terkirim. Catat penyebab dengan bukti pada PO yang tertahan.', actionButton('Catat PO customer', 'new-production', '', 'plus'))}
    <div class="summary-grid">${statStrip('Jumlah pesanan', integer(ordered), `${orders.length} baris PO`)}${statStrip('Sudah terkirim', integer(delivered), ordered ? `${(delivered / ordered * 100).toFixed(1).replace('.', ',')}% dari pesanan` : 'Belum ada jumlah pesanan')}${statStrip('Kesenjangan kirim', integer(Math.max(ordered - delivered, 0)))}${statStrip('Lewat tanggal janji', integer(overdue))}</div>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">ALUR CUSTOMER</p><h2>Pesanan & realisasi</h2><p>Baris tanpa tanggal janji tetap terlihat, tetapi tidak dihitung terlambat.</p></div>${actionButton('Export CSV', 'export', 'data-kind="production"', 'download', 'secondary')}</div><div class="toolbar"><label class="search-field">${icon('search', 17)}<input aria-label="Cari PO customer" data-filter="search" value="${esc(state.search)}" placeholder="Cari PO, customer, atau barang"></label></div>
      ${orders.length ? tableWrap(`<table><thead><tr><th>Tanggal PO</th><th>Janji kirim</th><th>No. PO</th><th>Customer</th><th>Barang</th><th>Qty pesan</th><th>Qty produksi</th><th>Qty kirim</th><th>Progres</th><th>Status / kendala</th><th></th></tr></thead><tbody>${lines}</tbody></table>`) : emptyState('Belum ada PO customer', 'Impor lembar PO COSTUMER atau tambahkan pesanan pertama.', 'new-production', 'Tambah PO customer', 'factory')}
    </section>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">CATATAN PENYEBAB</p><h2>Kendala terbuka</h2><p>Rekap ini menunjukkan sebab yang dicatat, bukan sebab yang disimpulkan dari selisih.</p></div><div class="heading-actions">${actionButton('Export CSV', 'export', 'data-kind="events"', 'download', 'secondary')}${actionButton('Catat kendala', 'new-event', '', 'plus', 'secondary')}</div></div>
      ${events.length ? tableWrap(`<table><thead><tr><th>Tanggal</th><th>PO customer</th><th>Kategori</th><th>Catatan</th><th>Unit terdampak</th><th>Status</th><th></th></tr></thead><tbody>${eventRows}</tbody></table>`) : emptyState('Belum ada kendala yang dicatat', 'Pilih sebuah PO lalu catat apakah hambatan berasal dari administrasi, bahan, proses produksi, kualitas, atau pengiriman.', orders.length ? 'new-event' : 'new-production', orders.length ? 'Catat kendala' : 'Tambah PO customer', 'alert')}
    </section>`;
}

function purchaseOrderValues(item) {
  const ordered = Number(item.qtyOrder) || 0;
  const shipped = Number(item.qtyKirim) || 0;
  const price = Number(item.harga) || 0;
  const shortage = Math.max(ordered - shipped, 0);
  const openValue = shortage * price;
  const shippedValue = shipped * price;
  return { ordered, shipped, price, shortage, openValue, openTax: openValue * 0.11, shippedValue, shippedTax: shippedValue * 0.11, payable: shippedValue * 1.11 };
}

function supplierOrders(data, state) {
  const orders = data.supplier_purchase_orders.filter((row) => inMonth(row.order_date, state.month) && (!state.search || `${row.po_number} ${row.supplier} ${row.customer}`.toLowerCase().includes(state.search.toLowerCase()))).sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''));
  const items = orders.flatMap((order) => (order.items || []).map((item, index) => ({ order, item, index, values: purchaseOrderValues(item) })));
  const totals = items.reduce((sum, row) => {
    for (const key of ['ordered', 'shipped', 'shortage', 'openValue', 'openTax', 'shippedValue', 'shippedTax', 'payable']) sum[key] += row.values[key];
    return sum;
  }, { ordered: 0, shipped: 0, shortage: 0, openValue: 0, openTax: 0, shippedValue: 0, shippedTax: 0, payable: 0 });
  const lines = items.map(({ order, item, index, values }) => {
    const ratio = values.ordered ? Math.min(100, values.shipped / values.ordered * 100) : 0;
    const rowTone = values.shipped === 0 ? 'po-unstarted' : values.shortage > 0 ? 'po-partial' : 'po-complete';
    return `<tr class="${rowTone}" data-row-id="${order.id}"><td>${formatDate(order.order_date)}<small class="table-sub">${esc(order.po_number)}</small></td><td>${esc(order.supplier)}</td><td>${esc(order.customer || '—')}</td><td>${esc(item.item || 'SHEET')}<small class="table-sub">${esc(item.qlty || '')} · ${esc(item.sizeSheet || '')}</small></td><td class="numeric">${integer(values.ordered)}</td><td><strong>${integer(values.shortage)}</strong><div class="table-progress"><i style="width:${ratio}%"></i></div><small>${ratio.toFixed(0)}% terkirim</small></td><td class="numeric">${money(values.price)}</td><td class="numeric">${money(values.openValue)}</td><td class="numeric">${money(values.openTax)}</td><td class="numeric">${money(values.openValue + values.openTax)}</td><td><button type="button" class="inline-number" data-act="edit-shipped" data-id="${order.id}" data-index="${index}">${integer(values.shipped)} ${icon('edit', 12)}</button></td><td class="numeric">${money(values.shippedValue)}</td><td class="numeric">${money(values.shippedTax)}</td><td class="numeric">${money(values.payable)}</td><td class="row-actions">${smallButton('Edit PO supplier', 'edit', `data-table="supplier_purchase_orders" data-id="${order.id}"`)}${smallButton('Hapus PO supplier', 'delete', `data-table="supplier_purchase_orders" data-id="${order.id}"`, 'trash', 'danger-icon')}</td></tr>`;
  }).join('');
  return `${pageHead('OPERASIONAL', 'PO supplier', 'Lacak bahan yang dipesan dan yang sudah diterima. Selisih dihitung per item agar kelebihan satu item tidak menutupi kekurangan item lain.', actionButton('Buat PO supplier', 'new-po', '', 'plus'))}
    <div class="summary-grid">${statStrip('Item PO', integer(items.length))}${statStrip('Qty dipesan', integer(totals.ordered))}${statStrip('Qty diterima', integer(totals.shipped))}${statStrip('Kurang diterima', integer(totals.shortage))}</div>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">PESANAN BAHAN</p><h2>Rincian per item</h2></div>${actionButton('Export CSV', 'export', 'data-kind="supplier-po"', 'download', 'secondary')}</div><div class="toolbar"><label class="search-field">${icon('search', 17)}<input aria-label="Cari PO supplier" data-filter="search" value="${esc(state.search)}" placeholder="Cari nomor PO, pemasok, atau customer"></label></div>
      ${items.length ? tableWrap(`<table class="wide-table"><thead><tr><th>Tanggal / No. PO</th><th>Pemasok</th><th>Customer</th><th>Item</th><th>Qty order</th><th>Kurang kirim</th><th>Harga/unit</th><th>Nilai sisa</th><th>PPN sisa</th><th>Total sisa</th><th>Qty kirim</th><th>Nilai kirim</th><th>PPN kirim</th><th>Nilai diterima + PPN</th><th></th></tr></thead><tbody>${lines}<tr class="total-row"><td colspan="4">Total periode</td><td class="numeric">${integer(totals.ordered)}</td><td class="numeric">${integer(totals.shortage)}</td><td></td><td class="numeric">${money(totals.openValue)}</td><td class="numeric">${money(totals.openTax)}</td><td class="numeric">${money(totals.openValue + totals.openTax)}</td><td class="numeric">${integer(totals.shipped)}</td><td class="numeric">${money(totals.shippedValue)}</td><td class="numeric">${money(totals.shippedTax)}</td><td class="numeric">${money(totals.payable)}</td><td></td></tr></tbody></table>`) : emptyState('Belum ada PO supplier', 'Buat PO bahan atau impor lembar PO SUPLAYER dari workbook awal.', 'new-po', 'Buat PO supplier', 'package')}
    </section>`;
}

function calculator(state) {
  const calc = state.calculator;
  const row = pricelist.find((item) => String(item[0]) === String(calc.substance)) || pricelist[0];
  const priceIndex = priceSpecs.indexOf(calc.spec);
  const unit = row?.[2]?.[priceIndex];
  const p = Number(calc.panjang) || 0;
  const l = Number(calc.lebar) || 0;
  const t = Number(calc.tinggi) || 0;
  const pxl = (p + l) * 2 + 4;
  const nl = l + 0.6 + t;
  const susun = nl > 0 ? Math.max(1, Math.ceil(100 / nl)) : 0;
  const raw = nl * susun;
  const paperWidth = susun ? Math.max(100, Math.ceil(raw / 5) * 5) : 0;
  const valid = susun > 0 && raw >= 100 && raw <= 180 && paperWidth <= 180;
  const base = valid ? (paperWidth * pxl * unit / 10000) / susun : 0;
  const discounted = base - base * (Number(calc.diskon) || 0) / 100;
  const beforeTax = discounted * 0.89;
  const sale = beforeTax * (1 + Math.max(0, Number(calc.margin) || 0) / 100);
  const fmt = (value) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(value);
  const table = calc.showPricelist ? `<section class="panel pricelist-panel"><div class="panel-heading"><div><p class="eyebrow">REFERENSI</p><h2>Pricelist material</h2></div><div class="heading-actions"><span class="tag">${pricelist.length} spec</span><button class="button secondary" type="button" data-act="export" data-kind="pricelist">${icon('download', 16)}<span>Export CSV</span></button></div></div>${tableWrap(`<table><thead><tr><th>No</th><th>Fluting</th><th>Medium</th><th>Liner</th>${priceSpecs.map((spec) => `<th>${esc(spec)}</th>`).join('')}</tr></thead><tbody>${pricelist.map((item) => `<tr><td>${item[0]}</td>${item[1].map((label) => `<td>${esc(label)}</td>`).join('')}${item[2].map((value) => `<td class="numeric">${integer(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)}</section>` : '';
  return `${pageHead('ALAT KERJA', 'Kalkulator pricelist', 'Hitung harga karton dari substance, spec material, ukuran, diskon, dan margin.')}
    <section class="calculator-layout"><article class="panel calculator-panel"><div class="panel-heading"><div><p class="eyebrow">01 · BAHAN</p><h2>Spesifikasi material</h2></div><span class="calc-step">1 / 3</span></div>
      <div class="form-grid"><label class="field field-wide"><span>Substance</span><select data-calc="substance">${pricelist.map((item) => `<option value="${item[0]}" ${String(item[0]) === String(calc.substance) ? 'selected' : ''}>${esc(item[1].map((part) => part.replace(/\s+/g, '')).join(' / '))}</option>`).join('')}</select></label><label class="field"><span>Spec material</span><select data-calc="spec">${priceSpecs.map((spec) => `<option ${spec === calc.spec ? 'selected' : ''}>${esc(spec)}</option>`).join('')}</select></label><div class="field output-field"><span>Harga pricelist</span><strong>${integer(unit || 0)}</strong><small>Per kombinasi substance & spec</small></div></div>
      <div class="panel-divider"></div><div class="panel-heading"><div><p class="eyebrow">02 · UKURAN</p><h2>Ukuran karton</h2></div><span class="calc-step">cm</span></div>
      <div class="form-grid three-col">${[['panjang', 'Panjang'], ['lebar', 'Lebar'], ['tinggi', 'Tinggi']].map(([key, label]) => `<label class="field"><span>${label}</span><div class="input-unit"><input type="number" min="0" step="0.1" data-calc="${key}" value="${esc(calc[key])}"><b>cm</b></div></label>`).join('')}</div>
      <div class="calc-derived"><div><small>P × L</small><strong>${fmt(pxl)} cm</strong></div><div><small>L + 0,6 + T</small><strong>${fmt(nl)} cm</strong></div><div><small>Lebar kertas</small><strong>${valid ? `${fmt(paperWidth)} cm` : 'Tidak tersedia'}</strong></div></div>
      <div class="panel-divider"></div><div class="panel-heading"><div><p class="eyebrow">03 · HARGA JUAL</p><h2>Perhitungan harga</h2></div><span class="calc-step">otomatis</span></div>
      <div class="form-grid three-col"><div class="field output-field"><span>Harga dasar</span><strong>${valid ? money(base) : '—'}</strong><small>(Lebar kertas × P×L × pricelist ÷ 10.000) ÷ susun</small></div><label class="field"><span>Diskon</span><div class="input-unit"><input type="number" step="0.1" data-calc="diskon" value="${esc(calc.diskon)}"><b>%</b></div></label><div class="field output-field"><span>Harga setelah diskon</span><strong>${valid ? money(discounted) : '—'}</strong></div><div class="field output-field"><span>Harga sebelum PPN</span><strong>${valid ? money(beforeTax) : '—'}</strong><small>Harga diskon dikurangi 11%</small></div><label class="field"><span>Margin</span><div class="input-unit"><input type="number" min="0" step="0.1" data-calc="margin" value="${esc(calc.margin)}"><b>%</b></div></label><div class="field sale-price"><span>Harga jual</span><strong>${valid ? money(sale) : '—'}</strong><small>Harga sebelum PPN + margin</small></div></div>
      <div class="calculator-actions"><button class="button secondary" type="button" data-act="calculator-reset">${icon('refresh', 16)}<span>Reset contoh</span></button><button class="button secondary" type="button" data-act="toggle-pricelist">${icon('package', 16)}<span>${calc.showPricelist ? 'Sembunyikan' : 'Lihat'} pricelist</span></button>${state.calculatorTarget !== null ? `<button class="button primary" type="button" data-act="use-price" data-price="${valid ? Math.round(sale) : 0}" ${valid ? '' : 'disabled'}>${icon('check', 16)}<span>Gunakan harga ini</span></button>` : ''}</div>
      ${!valid ? `<div class="notice notice-warn">${icon('alert', 16)}<span>Kombinasi ukuran tidak menghasilkan lebar kertas pada rentang tabel 100–180 cm.</span></div>` : ''}
    </article></section>${table}`;
}

function imports(state) {
  const preview = state.importPreview;
  const typeLabels = {
    customer_orders: 'PO customer', supplier_purchase_orders: 'PO supplier',
    sales_invoices: 'Outstanding invoice', cashflow_transactions: 'Transaksi kas',
  };
  return `${pageHead('DATA', 'Impor dari workbook', 'Pilih lembar Excel sumber. Data mentah tetap di perangkat; hanya baris yang sudah dipetakan dikirim ke akun Supabase.')}
    <section class="import-grid"><article class="panel import-step"><span class="step-number">01</span><p class="eyebrow">PILIH SUMBER</p><h2>Buka file Excel</h2><p>Didukung: PO customer, PO supplier, outstanding invoice, dan mutasi rekening kas.</p><label class="file-drop">${icon('upload', 22)}<span>${state.importFile ? esc(state.importFile.name) : 'Pilih berkas .xlsx atau .xls'}</span><input type="file" accept=".xlsx,.xls" data-import-file></label>
      ${preview ? `<label class="field"><span>Lembar workbook</span><select data-import-sheet>${preview.sheets.map((sheet) => `<option value="${esc(sheet.name)}" ${sheet.name === preview.sheetName ? 'selected' : ''}>${esc(sheet.name)}${sheet.type ? ` · ${esc(typeLabels[sheet.type])}` : ''}</option>`).join('')}</select></label>` : ''}</article>
      <article class="panel import-step"><span class="step-number">02</span><p class="eyebrow">PRATINJAU</p><h2>${preview ? esc(typeLabels[preview.type]) : 'Periksa pemetaan'}</h2><p>${preview ? `${integer(preview.records.length)} baris siap dibaca dari lembar ${esc(preview.sheetName)}.` : 'Aplikasi mengenali header workbook lalu menampilkan contoh sebelum menyimpan.'}</p>
        ${preview?.sample.length ? tableWrap(`<table class="preview-table"><thead><tr>${Object.keys(preview.sample[0]).filter((key) => !['source_key', 'created_at'].includes(key)).slice(0, 6).map((key) => `<th>${esc(key.replace(/_/g, ' '))}</th>`).join('')}</tr></thead><tbody>${preview.sample.map((row) => `<tr>${Object.entries(row).filter(([key]) => !['source_key', 'created_at'].includes(key)).slice(0, 6).map(([, value]) => `<td>${esc(typeof value === 'object' ? JSON.stringify(value) : value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`) : `<div class="preview-empty">${icon('file', 22)}<span>${preview ? 'Tidak ada baris transaksi yang dikenali pada lembar ini.' : 'Pratinjau akan muncul di sini.'}</span></div>`}
        <div class="import-actions">${preview ? actionButton('Muat ulang lembar', 'refresh-import', '', 'refresh', 'secondary') : ''}${preview?.records.length ? actionButton(`Impor ${integer(preview.records.length)} baris`, 'confirm-import', '', 'upload') : ''}</div>
      </article></section>
    <div class="notice notice-info">${icon('alert', 17)}<span>Data yang belum memiliki tanggal janji atau catatan kendala tetap diimpor, tetapi tidak akan dilabeli terlambat atau diberi akar masalah otomatis.</span></div>`;
}

export function renderPage(tab, data, state) {
  const pages = {
    dashboard: () => dashboard(data, state),
    cashflow: () => cashflow(data, state),
    piutang: () => payables(data, state),
    tagihan: () => invoices(data, state),
    produksi: () => production(data, state),
    supplier: () => supplierOrders(data, state),
    kalkulator: () => calculator(state),
    impor: () => imports(state),
  };
  return (pages[tab] || pages.dashboard)();
}

export const pageTabs = [
  ['dashboard', 'Ringkasan', 'home'], ['cashflow', 'Cashflow', 'wallet'],
  ['piutang', 'Piutang', 'users'], ['tagihan', 'Tagihan', 'file'],
  ['produksi', 'Produksi', 'factory'], ['supplier', 'PO Supplier', 'package'],
  ['kalkulator', 'Kalkulator', 'calculator'], ['impor', 'Impor data', 'upload'],
];

