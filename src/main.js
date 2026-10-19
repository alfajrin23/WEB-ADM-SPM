import {
  supabase, isConfigured, loadProfile, loadWorkspace, loadReceivableHistory, loadInputLogs, loadWorkspaceUsers,
  setWorkspaceId, setWorkspaceUserRole, saveRow, deleteRow, upsertRows,
} from './db.js';
import { inspectWorkbook } from './importer.js';
import {
  CAUSES, CASH_CATEGORIES, customerOrderFinancials, downloadCsv, escapeHtml as esc, formatDate, formatNumberInput, icon, isoToday, localISODate,
  monthName, orderProgress, rupiah, statusForInvoice, toNumber,
} from './helpers.js';
import { pageTabs, renderPage, renderSignIn } from './views.js';
import { downloadReportCsv, reportCategoryOptions } from './reports.js';
import { priceSpecs, pricelist } from './pricelist-data.js';
import './style.css';

const emptyData = () => ({
  company_settings: [], cashflow_transactions: [], supplier_ledger_entries: [], sales_invoices: [],
  supplier_purchase_orders: [], customer_orders: [], production_events: [],
});
const tablesByTab = {
  dashboard: ['company_settings', 'cashflow_transactions', 'sales_invoices', 'customer_orders', 'production_events'],
  cashflow: ['company_settings', 'cashflow_transactions'],
  piutang: ['supplier_ledger_entries'],
  tagihan: ['sales_invoices'],
  'po-customer': ['customer_orders'],
  laporan: ['cashflow_transactions', 'sales_invoices', 'supplier_ledger_entries', 'customer_orders'],
  produksi: ['customer_orders', 'production_events'],
  supplier: ['supplier_purchase_orders'],
  kalkulator: [],
  impor: [],
  'logs-input': [],
};
const tableByAction = {
  'save-cashflow': 'cashflow_transactions', 'save-opening': 'company_settings',
  'save-supplier-entry': 'supplier_ledger_entries', 'save-invoice': 'sales_invoices', 'mark-invoice-paid': 'sales_invoices',
  'save-customer-order': 'customer_orders', 'save-production-event': 'production_events',
  'save-po': 'supplier_purchase_orders', 'save-shipped': 'supplier_purchase_orders',
  'save-quantities': 'customer_orders',
};

const state = {
  session: null,
  profile: null,
  profileLoading: false,
  profileError: '',
  tab: 'dashboard',
  authMode: 'login',
  authMessage: '',
  authMessageType: 'info',
  loading: false,
  loadError: '',
  data: emptyData(),
  loadedTables: new Set(),
  tableLoadedAt: new Map(),
  inputLogs: [],
  inputLogsMonth: '',
  inputLogsLoadedAt: 0,
  profiles: [],
  profilesLoaded: false,
  month: localISODate(new Date()).slice(0, 7),
  reportMonth: localISODate(new Date()).slice(0, 7),
  reportCategories: null,
  reportCategoryKnownCategories: [],
  reportCategoryStorageKey: '',
  reportCategoryPreferenceError: false,
  reportReceivableHistory: null,
  reportReceivableHistoryLoadedAt: 0,
  reportFiltersOpen: false,
  reportIncomeWeek: null,
  reportIncomePlanPeriod: 'week',
  incomeWeek: null,
  incomePlanPeriod: 'week',
  category: '',
  invoiceStatus: '',
  search: '',
  modal: null,
  pendingDelete: null,
  expandedSuppliers: new Set(),
  expandedSupplierCustomers: new Set(),
  importFile: null,
  importPreview: null,
  calculator: { substance: '3', spec: 'BC/F', panjang: '18', lebar: '18', tinggi: '28.5', diskon: '3', margin: '40', showPricelist: false },
  calculatorTarget: null,
  poDraft: null,
  toastTimer: null,
  searchTimer: null,
  busy: false,
};

const app = document.querySelector('#app');
let authHydration = 0;
let activeDataLoads = 0;
let dataLoadGeneration = 0;

function persistReportCategoryPreferences() {
  if (!state.reportCategoryStorageKey || !state.reportCategories) return;
  try {
    localStorage.setItem(state.reportCategoryStorageKey, JSON.stringify({
      categories: state.reportCategoryKnownCategories,
      selected: state.reportCategories,
    }));
    state.reportCategoryPreferenceError = false;
  } catch {
    state.reportCategoryPreferenceError = true;
  }
}

function syncReportCategoryPreferences() {
  const userId = state.session?.user?.id;
  const workspaceId = state.profile?.workspace_id;
  if (!userId || !workspaceId) return;
  const key = `spm-report-categories:${userId}:${workspaceId}`;
  const options = reportCategoryOptions(state.data);
  if (state.reportCategoryStorageKey !== key) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      state.reportCategoryPreferenceError = true;
    }
    const known = Array.isArray(saved?.categories) ? saved.categories : [];
    state.reportCategoryStorageKey = key;
    state.reportCategoryKnownCategories = [...new Set([...known, ...(Array.isArray(saved?.selected) ? saved.selected : []), ...options])];
    state.reportCategories = Array.isArray(saved?.selected)
      ? [...new Set([...saved.selected, ...options.filter((category) => !known.includes(category))])]
      : [...options];
    persistReportCategoryPreferences();
    return;
  }
  const newCategories = options.filter((category) => !state.reportCategoryKnownCategories.includes(category));
  if (newCategories.length) {
    state.reportCategoryKnownCategories = [...state.reportCategoryKnownCategories, ...newCategories];
    state.reportCategories = [...new Set([...(state.reportCategories || []), ...newCategories])];
    persistReportCategoryPreferences();
  }
}

function toast(message, type = 'success') {
  clearTimeout(state.toastTimer);
  const host = document.querySelector('.toast-stack');
  if (!host) return;
  host.innerHTML = `<div class="toast toast-${type}" role="status">${icon(type === 'error' ? 'alert' : type === 'info' ? 'file' : 'check', 17)}<span>${esc(message)}</span><button type="button" aria-label="Tutup notifikasi" data-act="dismiss-toast">${icon('close', 15)}</button></div>`;
  state.toastTimer = setTimeout(() => { const current = document.querySelector('.toast-stack'); if (current) current.innerHTML = ''; }, 3200);
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Terjadi kesalahan.');
  if (/relation .* does not exist|schema cache|could not find the table/i.test(message)) {
    return 'Tabel aplikasi belum dibuat. Jalankan supabase/schema.sql pada SQL Editor Supabase, lalu muat ulang halaman.';
  }
  if (/invalid login credentials/i.test(message)) return 'Email atau kata sandi belum cocok.';
  if (/email not confirmed/i.test(message)) return 'Konfirmasi alamat email dari tautan yang dikirim Supabase, lalu masuk kembali.';
  return message;
}

function render() {
  document.body.dataset.tab = state.tab;
  if (!isConfigured) {
    app.innerHTML = `<main class="auth-screen"><section class="auth-card"><img src="/brand-logo.png" class="auth-logo" alt="Logo CV Surya Pratama Mandiri"><p class="eyebrow">PENYIAPAN APLIKASI</p><h1>Hubungkan ruang kerja</h1><p class="auth-copy">Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local, lalu jalankan ulang server.</p><div class="notice notice-info">${icon('alert', 17)}<span>Kunci service role tidak diperlukan pada aplikasi browser.</span></div></section></main>`;
    return;
  }
  if (!state.session) {
    app.innerHTML = `${renderSignIn(state.authMode, state.authMessage, state.authMessageType, state.busy)}<div class="toast-stack"></div>`;
    return;
  }
  if (state.profileLoading) {
    app.innerHTML = `<main class="auth-screen"><section class="auth-card"><img src="/brand-logo.png" class="auth-logo" alt="Logo CV Surya Pratama Mandiri"><p class="eyebrow">CV SURYA PRATAMA MANDIRI</p><h1>Memeriksa akses akun</h1><p class="auth-copy">Menghubungkan akun ke ruang kerja perusahaan.</p><div class="loading-grid"><div class="skeleton-card"></div></div></section></main>`;
    return;
  }
  if (state.profileError) {
    app.innerHTML = `<main class="auth-screen"><section class="auth-card"><img src="/brand-logo.png" class="auth-logo" alt="Logo CV Surya Pratama Mandiri"><p class="eyebrow">CV SURYA PRATAMA MANDIRI</p><h1>Akses akun belum siap</h1><div class="notice notice-warn">${icon('alert', 17)}<span>${esc(state.profileError)}</span></div><button type="button" class="button secondary button-wide" data-act="signout">Keluar</button></section></main>`;
    return;
  }
  if (!state.profile?.workspace_id) {
    app.innerHTML = `<main class="auth-screen"><section class="auth-card"><img src="/brand-logo.png" class="auth-logo" alt="Logo CV Surya Pratama Mandiri"><p class="eyebrow">CV SURYA PRATAMA MANDIRI</p><h1>Akun menunggu akses</h1><p class="auth-copy">Akun <strong>${esc(state.session.user?.email || '')}</strong> sudah masuk, tetapi belum ditautkan ke ruang kerja. Minta developer memberi akses melalui menu Log Input.</p><button type="button" class="button secondary button-wide" data-act="signout">Keluar</button></section></main>`;
    return;
  }
  const displayName = state.session.user?.email || 'Akun SPM';
  const visibleTabs = pageTabs.filter(([key]) => key !== 'logs-input' || state.profile.role === 'developer');
  if (!visibleTabs.some(([key]) => key === state.tab)) state.tab = state.profile.role === 'staff' ? 'produksi' : 'dashboard';
  if (state.tab === 'laporan') syncReportCategoryPreferences();
  const tabs = visibleTabs.map(([key, label, glyph]) => `<button class="nav-tab ${state.tab === key ? 'active' : ''}" type="button" data-act="navigate" data-tab="${key}">${icon(glyph, 17)}<span>${esc(label)}</span></button>`).join('');
  app.innerHTML = `<div class="app-shell">
    <header class="topbar"><a class="brand" href="#" data-act="navigate" data-tab="dashboard"><img src="/brand-logo.png" alt="Logo CV Surya Pratama Mandiri"/><span><strong>CV Surya Pratama Mandiri</strong><small>${state.profile.role === 'developer' ? 'Developer' : 'Staff'} · Ruang kerja operasional</small></span></a>
      <a class="copyright-link" href="https://github.com/alfajrin23" target="_blank" rel="noopener noreferrer">Copyright 2026 by Al Fajrin A Alamsyah</a>
      <nav class="main-nav" aria-label="Menu utama">${tabs}</nav>
      <div class="account-menu"><span class="account-dot"></span><span class="account-email">${esc(displayName)}</span><button type="button" class="icon-button" aria-label="Keluar" title="Keluar" data-act="signout">${icon('logout', 17)}</button></div>
    </header>
    <main class="workspace"><div class="workspace-tools"><div><span class="live-dot"></span><span>Data tersimpan di Supabase</span></div>${['tagihan', 'produksi', 'po-customer', 'supplier', 'laporan'].includes(state.tab) ? '' : `<label class="month-control"><span>Periode</span><input aria-label="Pilih periode" data-filter="month" type="month" value="${esc(state.month)}"></label>`}</div>
      ${state.loadError ? `<div class="notice notice-warn setup-notice">${icon('alert', 18)}<span>${esc(state.loadError)}</span></div>` : ''}
      ${state.loading ? `<div class="loading-grid">${Array.from({ length: 6 }, () => '<div class="skeleton-card"></div>').join('')}</div>` : renderPage(state.tab, state.data, state)}
      <footer class="app-footer"><span>CV Surya Pratama Mandiri</span><span>Keuangan · PO · Produksi</span></footer>
    </main>${renderModal()}<div class="toast-stack"></div>
  </div>`;
}

function renderModal() {
  if (!state.modal) return '';
  const { title, body, action = '', submit = 'Simpan', width = '' } = state.modal;
  const form = action
    ? `<form class="form-stack modal-form" data-form="modal" data-action="${esc(action)}" ${state.modal.attrs || ''}>${body}<div class="modal-actions"><button type="button" class="button secondary" data-act="close-modal">${icon('close', 16)}<span>Batal</span></button><button class="button primary" type="submit" ${state.busy ? 'disabled' : ''}>${icon('save', 16)}<span>${esc(submit)}</span></button></div></form>`
    : `${body}<div class="modal-actions"><button type="button" class="button secondary" data-act="close-modal">${icon('close', 16)}<span>Tutup</span></button></div>`;
  return `<div class="modal-backdrop" data-act="backdrop"><section class="modal-card ${width}" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal-card><header class="modal-heading"><div><p class="eyebrow">CV SURYA PRATAMA MANDIRI</p><h2 id="modal-title">${esc(title)}</h2></div><button type="button" class="icon-button" aria-label="Tutup" data-act="close-modal">${icon('close', 18)}</button></header>${form}</section></div>`;
}

function updateLocalRow(table, row) {
  if (!table || !row) return;
  if (table === 'company_settings') {
    state.data.company_settings = [row];
  } else {
    const rows = state.data[table] || [];
    const index = rows.findIndex((item) => item.id === row.id);
    state.data[table] = index < 0
      ? [row, ...rows]
      : rows.map((item, rowIndex) => rowIndex === index ? row : item);
  }
  state.loadedTables.add(table);
  state.tableLoadedAt.set(table, Date.now());
}

function removeLocalRow(table, id) {
  if (!table || !id || !state.data[table]) return;
  state.data[table] = state.data[table].filter((row) => row.id !== id);
  state.tableLoadedAt.set(table, Date.now());
}

async function refreshData({
  tables = tablesByTab[state.tab] || [], forceTables = false,
  includeAdmin = state.tab === 'logs-input', forceLogs = false, forceProfiles = false,
  showLoading = true,
} = {}) {
  const tablesToLoad = [...new Set(tables)].filter((table) => forceTables
    || !state.loadedTables.has(table)
    || Date.now() - (state.tableLoadedAt.get(table) || 0) > 60_000);
  const isDeveloper = state.profile?.role === 'developer' && includeAdmin;
  const requestedLogMonth = state.month;
  const shouldLoadLogs = isDeveloper && (forceLogs || state.inputLogsMonth !== requestedLogMonth || Date.now() - state.inputLogsLoadedAt > 60_000);
  const shouldLoadProfiles = isDeveloper && (forceProfiles || !state.profilesLoaded);
  const shouldLoadReceivableHistory = state.tab === 'laporan'
    && Date.now() - state.reportReceivableHistoryLoadedAt > 60_000;
  if (!tablesToLoad.length && !shouldLoadLogs && !shouldLoadProfiles && !shouldLoadReceivableHistory) {
    if (showLoading) render();
    return;
  }

  const userId = state.session?.user?.id;
  const generation = dataLoadGeneration;
  state.loadError = '';
  if (showLoading) {
    activeDataLoads += 1;
    state.loading = true;
    render();
  }
  try {
    const [workspace, logs, profiles, receivableHistory] = await Promise.all([
      tablesToLoad.length ? loadWorkspace(tablesToLoad) : Promise.resolve(null),
      shouldLoadLogs ? loadInputLogs(requestedLogMonth) : Promise.resolve(null),
      shouldLoadProfiles ? loadWorkspaceUsers() : Promise.resolve(null),
      shouldLoadReceivableHistory ? loadReceivableHistory() : Promise.resolve(null),
    ]);
    if (state.session?.user?.id !== userId) return;
    if (workspace) {
      state.data = { ...state.data, ...workspace };
      tablesToLoad.forEach((table) => {
        state.loadedTables.add(table);
        state.tableLoadedAt.set(table, Date.now());
      });
    }
    if (logs && state.month === requestedLogMonth) {
      state.inputLogs = logs;
      state.inputLogsMonth = requestedLogMonth;
      state.inputLogsLoadedAt = Date.now();
    }
    if (profiles) {
      state.profiles = profiles;
      state.profilesLoaded = true;
    }
    if (receivableHistory) {
      state.reportReceivableHistory = receivableHistory;
      state.reportReceivableHistoryLoadedAt = Date.now();
    }
  } catch (error) {
    if (state.session?.user?.id === userId) state.loadError = friendlyError(error);
  } finally {
    if (showLoading) {
      if (generation === dataLoadGeneration) activeDataLoads = Math.max(0, activeDataLoads - 1);
      state.loading = activeDataLoads > 0;
    }
    render();
  }
}

function inputField(label, name, value = '', type = 'text', options = {}) {
  const attrs = options.attrs || '';
  const placeholder = options.placeholder ? `placeholder="${esc(options.placeholder)}"` : '';
  const required = options.required ? 'required' : '';
  const min = options.min !== undefined ? `${options.money ? 'data-min' : 'min'}="${options.min}"` : '';
  const max = options.max !== undefined ? `data-max="${options.max}"` : '';
  const step = options.step ? `${options.money ? 'data-step' : 'step'}="${options.step}"` : '';
  const inputType = options.money ? 'text' : type;
  const inputMode = options.money ? 'inputmode="decimal" data-money-input autocomplete="off"' : '';
  const inputValue = options.money ? formatNumberInput(value) : value;
  const full = options.full ? 'field-wide' : '';
  const hint = options.hint ? `<small>${esc(options.hint)}</small>` : '';
  if (type === 'textarea') return `<label class="field ${full}"><span>${esc(label)}</span><textarea name="${esc(name)}" ${required} ${placeholder} ${attrs}>${esc(value)}</textarea>${hint}</label>`;
  return `<label class="field ${full}"><span>${esc(label)}</span><input name="${esc(name)}" type="${inputType}" value="${esc(inputValue)}" ${required} ${min} ${max} ${step} ${inputMode} ${placeholder} ${attrs}>${hint}</label>`;
}

function selectField(label, name, choices, selected, options = {}) {
  return `<label class="field ${options.full ? 'field-wide' : ''}"><span>${esc(label)}</span><select name="${esc(name)}" ${options.required ? 'required' : ''}>${choices.map(([value, title]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select>${options.hint ? `<small>${esc(options.hint)}</small>` : ''}</label>`;
}

function openModal(modal) {
  state.modal = modal;
  render();
  setTimeout(() => document.querySelector('.modal-card input:not([type="hidden"]), .modal-card select, .modal-card textarea')?.focus(), 40);
}

function cashflowModal(row = {}) {
  const category = row.category || CASH_CATEGORIES[0];
  const kind = ['Uang Masuk', 'Dana Talang'].includes(category) ? 'credit' : (row.kind || 'debit');
  openModal({
    title: row.id ? 'Edit transaksi kas' : 'Transaksi kas baru', action: 'save-cashflow', submit: row.id ? 'Simpan perubahan' : 'Simpan transaksi',
    attrs: row.id ? `data-id="${row.id}"` : '',
    body: `<div class="form-grid">${inputField('Tanggal transaksi', 'transaction_date', row.transaction_date || isoToday(), 'date', { required: true })}${selectField('Kategori', 'category', CASH_CATEGORIES.map((item) => [item, item]), category, { required: true })}${inputField('Nama pengajuan', 'requester', row.requester || '', 'text', { placeholder: 'Nama pemohon' })}${inputField('Nominal', 'amount', row.amount ?? '', 'number', { required: true, min: 0, step: '0.01', money: true })}${inputField('Keterangan', 'description', row.description || '', 'textarea', { full: true, placeholder: 'Tujuan pengeluaran atau sumber dana' })}<input type="hidden" name="kind" value="${kind}"></div><p class="form-hint">Kategori Uang Masuk dan Dana Talang menambah saldo; kategori lain dicatat sebagai debit.</p>`,
  });
}

function invoiceCustomerField(value = '') {
  const customerNames = state.data.sales_invoices.reduce((names, invoice) => {
    const name = String(invoice.customer || '').trim();
    if (name && !names.has(name.toLocaleLowerCase('id-ID'))) names.set(name.toLocaleLowerCase('id-ID'), name);
    return names;
  }, new Map());
  const customers = [...customerNames.values()].sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
  return `<label class="field"><span>Nama customer</span><input name="customer" type="text" value="${esc(value)}" list="invoice-customer-suggestions" autocomplete="off" required><datalist id="invoice-customer-suggestions">${customers.map((customer) => `<option value="${esc(customer)}"></option>`).join('')}</datalist><small>Pilih nama customer yang sudah tersimpan atau ketik nama baru.</small></label>`;
}

function invoiceModal(row = {}) {
  openModal({
    title: row.id ? 'Edit invoice customer' : 'Invoice baru', action: 'save-invoice', submit: row.id ? 'Simpan perubahan' : 'Simpan invoice',
    attrs: row.id ? `data-id="${row.id}"` : '',
    body: `<div class="form-grid">${inputField('Tanggal invoice', 'invoice_date', row.invoice_date || isoToday(), 'date', { required: true })}${inputField('Jatuh tempo', 'due_date', row.due_date || '', 'date')}${invoiceCustomerField(row.customer || '')}${inputField('Nomor invoice', 'invoice_number', row.invoice_number || '', 'text', { required: true })}${inputField('Nomor PO', 'po_number', row.po_number || '')}${inputField('Nilai invoice', 'amount', row.amount ?? '', 'number', { required: true, min: 0, step: '0.01', money: true })}${inputField('Sudah dibayar', 'paid_amount', row.paid_amount || 0, 'number', { min: 0, step: '0.01', money: true })}${inputField('Tanggal pembayaran terakhir', 'paid_date', row.paid_date || '', 'date')}</div><p class="form-hint">Status dihitung dari sisa tagihan dan tanggal jatuh tempo.</p>`,
  });
}

function invoicePaymentDateModal(invoice) {
  const balance = Number(invoice.outstanding_amount ?? Math.max(Number(invoice.amount) - Number(invoice.paid_amount || 0), 0));
  openModal({
    title: 'Catat pembayaran invoice', action: 'mark-invoice-paid', submit: 'Simpan pembayaran',
    attrs: `data-id="${esc(invoice.id)}"`,
    body: `<p class="confirm-copy">Catat pembayaran untuk invoice <strong>${esc(invoice.invoice_number || '')}</strong>. Sisa tercatat ${rupiah(balance)}.</p><div class="form-grid">${inputField('Jumlah pembayaran', 'payment_amount', balance, 'number', { required: true, min: 0.01, step: '0.01', money: true })}${inputField('Tanggal pembayaran', 'paid_date', isoToday(), 'date', { required: true })}</div><p class="form-hint">Pembayaran dapat dicatat sebagian. Setiap perubahan jumlah dan tanggal tersimpan pada riwayat piutang setelah migration dijalankan.</p>`,
  });
}

function normalizeSupplierName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
}

function supplierBalanceFor(entries, supplier, excludeId = '') {
  const key = normalizeSupplierName(supplier);
  return entries
    .filter((row) => row.id !== excludeId && normalizeSupplierName(row.supplier) === key)
    .reduce((balance, row) => balance + (row.entry_type === 'bill' ? 1 : -1) * Number(row.amount || 0), 0);
}

function linkedBillBalanceFor(entries, billId, excludeId = '') {
  const bill = entries.find((row) => row.id === billId && row.entry_type === 'bill');
  if (!bill) return null;
  const linkedPaid = entries
    .filter((row) => row.id !== excludeId && row.entry_type === 'payment' && row.linked_bill_id === billId)
    .reduce((total, row) => total + Number(row.amount || 0), 0);
  return Math.max(Number(bill.amount || 0) - linkedPaid, 0);
}

function supplierEntryModal(type, supplier = '', row = {}) {
  const payment = type === 'payment';
  const entries = state.data.supplier_ledger_entries;
  const supplierBalance = payment ? supplierBalanceFor(entries, supplier, row.id || '') : 0;
  if (payment && supplierBalance <= 0) {
    toast('Supplier ini tidak memiliki sisa tagihan untuk dibayar.', 'info');
    return;
  }
  const selectedBillId = row.linked_bill_id || '';
  const supplierBills = payment
    ? entries.filter((entry) => entry.entry_type === 'bill' && normalizeSupplierName(entry.supplier) === normalizeSupplierName(supplier))
      .map((bill) => {
        const remaining = linkedBillBalanceFor(entries, bill.id, row.id || '');
        return { ...bill, remaining, paymentLimit: Math.min(Math.max(supplierBalance, 0), remaining || 0) };
      })
      .filter((bill) => bill.paymentLimit > 0 || bill.id === selectedBillId)
      .sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
    : [];
  if (payment && !supplierBills.length) {
    toast('Tidak ada tagihan supplier yang dapat dipilih untuk pembayaran ini.', 'info');
    return;
  }
  const selectedBill = supplierBills.find((bill) => bill.id === selectedBillId);
  const initialLimit = payment ? (selectedBill?.paymentLimit ?? Math.max(supplierBalance, 0)) : undefined;
  const unlinkedPaymentCount = payment
    ? entries.filter((entry) => entry.entry_type === 'payment' && !entry.linked_bill_id && normalizeSupplierName(entry.supplier) === normalizeSupplierName(supplier)).length
    : 0;
  const supplierNames = [...new Set(entries.map((entry) => String(entry.supplier || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id'));
  const supplierField = payment
    ? `<label class="field field-wide"><span>Nama supplier</span><input value="${esc(supplier)}" disabled><input type="hidden" name="supplier" value="${esc(supplier)}"></label>`
    : `${inputField('Nama supplier', 'supplier', row.supplier || '', 'text', { required: true, placeholder: 'Nama supplier', attrs: 'list="supplier-ledger-vendors"' })}<datalist id="supplier-ledger-vendors">${supplierNames.map((name) => `<option value="${esc(name)}"></option>`).join('')}</datalist>`;
  const billField = payment
    ? `<label class="field field-wide"><span>Pilih tagihan yang dibayar</span><select name="linked_bill_id" data-supplier-bill-select ${!row.id || selectedBillId ? 'required' : ''}><option value="" ${selectedBillId ? '' : 'selected'}>Pilih tanggal, keterangan, dan nominal tagihan</option>${supplierBills.map((bill) => {
      const description = bill.description || 'Tanpa keterangan';
      return `<option value="${esc(bill.id)}" ${bill.id === selectedBillId ? 'selected' : ''} data-payment-limit="${bill.paymentLimit}" data-bill-date="${esc(formatDate(bill.entry_date))}" data-bill-description="${esc(description)}" data-bill-amount="${esc(rupiah(bill.amount))}" data-bill-remaining="${esc(rupiah(bill.remaining))}">${esc(formatDate(bill.entry_date))} · ${esc(description)} · ${esc(rupiah(bill.amount))} · sisa tertaut ${esc(rupiah(bill.remaining))}</option>`;
    }).join('')}</select></label>`
    : '';
  const paymentPreview = payment
    ? `<p class="supplier-payment-preview" data-supplier-bill-preview>${selectedBill ? `Tagihan dipilih: ${formatDate(selectedBill.entry_date)} · ${selectedBill.description || 'Tanpa keterangan'} · ${rupiah(selectedBill.amount)}. Sisa berdasarkan pembayaran tertaut: ${rupiah(selectedBill.remaining)}.` : 'Pilih tagihan berdasarkan tanggal, keterangan, dan nilai tagihan.'}</p>`
    : '';
  const legacyPaymentNotice = unlinkedPaymentCount
    ? `<p class="form-hint">Ada ${unlinkedPaymentCount} pembayaran supplier yang belum ditautkan ke tagihan tertentu. Pembayaran tersebut tidak dialokasikan otomatis.</p>`
    : '';
  const paymentLimitNote = payment
    ? `<p class="form-hint" data-supplier-payment-limit>Maksimum pembayaran saat ini ${rupiah(initialLimit)}; sisa seluruh tagihan supplier ${rupiah(Math.max(supplierBalance, 0))}.</p>${legacyPaymentNotice}`
    : '';
  const formAttrs = [row.id ? `data-id="${esc(row.id)}"` : '', payment ? `data-supplier-balance="${Math.max(supplierBalance, 0)}"` : ''].filter(Boolean).join(' ');
  const dateField = inputField(payment ? 'Tanggal pembayaran' : 'Tanggal', 'entry_date', row.entry_date || isoToday(), 'date', { required: true });
  const amountField = inputField(payment ? 'Nominal bayar' : 'Nominal piutang', 'amount', row.amount ?? '', 'number', { required: true, min: 0.01, max: payment ? initialLimit : undefined, step: '0.01', money: true });
  const paymentFields = payment ? `${amountField}${dateField}` : `${dateField}${amountField}`;
  openModal({
    title: row.id ? (payment ? 'Edit pembayaran supplier' : 'Edit tagihan supplier') : payment ? `Pembayaran supplier · ${supplier}` : 'Tagihan baru',
    action: 'save-supplier-entry', submit: row.id ? 'Simpan perubahan' : payment ? 'Simpan pembayaran' : 'Simpan tagihan',
    attrs: formAttrs,
    body: `<div class="form-grid">${supplierField}${billField}${paymentPreview}${paymentFields}${inputField(payment ? 'Keterangan pembayaran (opsional)' : 'Keterangan (opsional)', 'description', row.description || '', 'text', { placeholder: payment ? 'Misalnya pembayaran sebagian' : 'No. invoice atau jenis bahan' })}<input type="hidden" name="entry_type" value="${payment ? 'payment' : 'bill'}"></div>${paymentLimitNote}`,
  });
}

function updateSupplierPaymentSelection(select) {
  const form = select.closest('form');
  if (!form) return;
  const option = select.selectedOptions[0];
  const limit = option?.value ? Number(option.dataset.paymentLimit) : Number(form.dataset.supplierBalance || 0);
  const amount = form.elements.namedItem('amount');
  if (amount) amount.dataset.max = String(Math.max(limit || 0, 0));
  const preview = form.querySelector('[data-supplier-bill-preview]');
  if (preview) {
    preview.textContent = option?.value
      ? `Tagihan dipilih: ${option.dataset.billDate} · ${option.dataset.billDescription} · ${option.dataset.billAmount}. Sisa berdasarkan pembayaran tertaut: ${option.dataset.billRemaining}.`
      : 'Pilih tagihan berdasarkan tanggal, keterangan, dan nilai tagihan.';
  }
  const note = form.querySelector('[data-supplier-payment-limit]');
  if (note) note.textContent = `Maksimum pembayaran saat ini ${rupiah(Math.max(limit || 0, 0))}; sisa seluruh tagihan supplier ${rupiah(Number(form.dataset.supplierBalance || 0))}.`;
}

function customerOrderModal(row = {}) {
  const amount = Number(row.qty_order || 0) * Number(row.unit_price || 0);
  const tax = Number(row.po_tax_amount || 0);
  openModal({
    title: row.id ? 'Edit PO customer' : 'PO customer baru', action: 'save-customer-order', submit: row.id ? 'Simpan perubahan' : 'Simpan PO', attrs: row.id ? `data-id="${row.id}"` : '',
    body: `<div class="form-grid">${inputField('Tanggal PO', 'order_date', row.order_date || isoToday(), 'date', { required: true })}${inputField('Tanggal janji kirim', 'due_date', row.due_date || '', 'date', { hint: 'Opsional; dipakai untuk menilai PO yang terlambat.' })}${inputField('No PO', 'po_number', row.po_number || '', 'text', { required: true })}${inputField('Customer', 'customer', row.customer || '', 'text', { required: true })}${inputField('SPM/SKG', 'spm_skg', row.spm_skg || 'SPM', 'text', { required: true, placeholder: 'SPM atau SKG' })}${inputField('QTY PO', 'qty_order', row.qty_order ?? '', 'number', { required: true, min: 0, step: '0.01', attrs: 'data-customer-order-calc' })}${inputField('PRICE', 'unit_price', row.unit_price ?? '', 'number', { required: true, min: 0, step: '0.01', money: true, attrs: 'data-customer-order-calc' })}${inputField('PPN PO', 'po_tax_amount', row.po_tax_amount ?? 0, 'number', { min: 0, step: '0.01', money: true, attrs: 'data-customer-order-calc' })}${inputField('SIZE', 'size', row.size || '')}${inputField('ITEM', 'item', row.item || '', 'text', { required: true })}</div><div class="order-total-preview"><div><span>Total Harga</span><strong data-customer-order-preview="amount">${rupiah(amount)}</strong><small>QTY PO × PRICE</small></div><div><span>PPN</span><strong data-customer-order-preview="tax">${rupiah(tax)}</strong><small>Nilai PPN yang dicatat pada PO</small></div><div><span>Total Price</span><strong data-customer-order-preview="total">${rupiah(amount + tax)}</strong><small>Total Harga + PPN</small></div></div><p class="form-hint">Delivery dan spesifikasi proses dicatat pada halaman Produksi. Kekurangan kirim serta nilai jual dihitung dari data PO dan realisasi.</p>`,
  });
}

function updateCustomerOrderPreview(target) {
  const form = target.closest('form');
  if (!form) return;
  const read = (name) => toNumber(form.elements.namedItem(name)?.value);
  const amount = read('qty_order') * read('unit_price');
  const tax = read('po_tax_amount');
  const values = { amount, tax, total: amount + tax };
  Object.entries(values).forEach(([key, value]) => {
    const output = form.querySelector(`[data-customer-order-preview="${key}"]`);
    if (output) output.textContent = rupiah(value);
  });
}

function productionEventModal(orderId = '', row = {}) {
  const orderChoices = state.data.customer_orders.map((item) => [item.id, `${item.po_number || 'Tanpa PO'} · ${item.customer} · ${item.item}`]);
  if (orderId && !orderChoices.some(([id]) => id === orderId)) orderChoices.unshift([orderId, 'PO terpilih']);
  openModal({
    title: row.id ? 'Edit catatan kendala' : 'Catat kendala produksi', action: 'save-production-event', submit: row.id ? 'Simpan perubahan' : 'Simpan kendala', attrs: row.id ? `data-id="${row.id}"` : '',
    body: `<div class="form-grid">${selectField('PO customer', 'customer_order_id', orderChoices, row.customer_order_id || orderId, { required: true, full: true })}${inputField('Tanggal kendala', 'event_date', row.event_date || isoToday(), 'date', { required: true })}${selectField('Kategori penyebab', 'cause_category', CAUSES, row.cause_category || 'administrasi', { required: true })}${inputField('Jumlah unit terdampak', 'affected_qty', row.affected_qty || 0, 'number', { min: 0, step: '0.01' })}${inputField('Catatan / bukti', 'cause_detail', row.cause_detail || '', 'textarea', { required: true, full: true, placeholder: 'Apa yang terjadi, kapan diketahui, dan dampaknya ke pesanan?' })}${selectField('Status kendala', 'status', [['open', 'Terbuka'], ['resolved', 'Selesai']], row.status || 'open')}</div>`,
  });
}

function supplierOrderModal(row = {}) {
  const draft = {
    id: row.id || '', po_number: row.po_number || '', supplier: row.supplier || '', customer: row.customer || '',
    order_date: row.order_date || isoToday(), items: row.items?.length ? row.items : [{ item: 'SHEET', qlty: 'BF', sizeSheet: '', qtyOrder: '', qtyKirim: 0, harga: '' }],
  };
  state.poDraft = draft;
  openModal({ title: draft.id ? 'Edit PO supplier' : 'PO supplier baru', action: 'save-po', submit: draft.id ? 'Simpan perubahan' : 'Simpan PO', attrs: draft.id ? `data-id="${draft.id}"` : '', width: 'modal-wide', body: supplierPoForm(draft) });
}

function supplierPoForm(draft) {
  const itemRows = draft.items.map((item, index) => supplierPoItem(item, index)).join('');
  const suppliers = [...new Set(state.data.supplier_purchase_orders.map((row) => String(row.supplier || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id-ID'));
  const supplierField = `<label class="field"><span>Pemasok</span><input name="supplier" value="${esc(draft.supplier)}" list="supplier-po-suggestions" autocomplete="off" required><small>Pilih nama yang pernah dipakai atau ketik pemasok baru, termasuk nama perorangan, CV, atau PT.</small><datalist id="supplier-po-suggestions">${suppliers.map((supplier) => `<option value="${esc(supplier)}"></option>`).join('')}</datalist></label>`;
  return `<div class="form-grid">${inputField('Tanggal PO', 'order_date', draft.order_date, 'date', { required: true })}${inputField('Nomor PO', 'po_number', draft.po_number, 'text', { required: true })}${supplierField}${inputField('Customer', 'customer', draft.customer, 'text')}</div>
    <div class="po-item-heading"><div><p class="eyebrow">RINCIAN</p><h3>Item bahan</h3></div><button type="button" class="button secondary" data-act="add-po-item">${icon('plus', 16)}<span>Tambah item</span></button></div>
    <div class="po-item-list">${itemRows}</div>`;
}

function supplierPoItem(item, index) {
  const calc = {
    kurang: Math.max(Number(item.qtyOrder || 0) - Number(item.qtyKirim || 0), 0),
    actual: toNumber(item.qtyKirim) * toNumber(item.harga),
  };
  return `<section class="po-item-row" data-po-item><div class="po-item-top"><strong>Item ${index + 1}</strong><button type="button" class="icon-button danger-icon" aria-label="Hapus item" title="Hapus item" data-act="remove-po-item">${icon('trash', 15)}</button></div>
    <div class="po-item-fields"><label class="field"><span>Nama item</span><input name="item-item" value="${esc(item.item || 'SHEET')}" required></label><label class="field"><span>QLTY</span><select name="item-qlty">${['BF', 'CF', 'AF', 'BC/F', 'BA/F', 'E/F'].map((value) => `<option ${value === item.qlty ? 'selected' : ''}>${value}</option>`).join('')}</select></label><label class="field"><span>SIZE SHEET</span><input name="item-size" value="${esc(item.sizeSheet || '')}" placeholder="104 X 116"></label><label class="field"><span>Qty order dari supplier</span><input name="item-ordered" data-po-calc type="number" min="0" step="0.01" value="${esc(item.qtyOrder)}" required></label><label class="field"><span>Qty kirim ke customer</span><input name="item-shipped" data-po-calc type="number" min="0" step="0.01" value="${esc(item.qtyKirim || 0)}"></label><label class="field"><span>Harga / unit</span><div class="price-input-row"><input name="item-price" data-po-calc data-money-input data-min="0" data-step="0.01" inputmode="decimal" autocomplete="off" type="text" value="${esc(formatNumberInput(item.harga))}" required><button class="text-button" type="button" data-act="calculator-for" data-index="${index}">${icon('calculator', 14)} Hitung harga</button></div></label></div>
    <div class="po-item-calc"><span>Stock tersedia <b data-calc-short>${new Intl.NumberFormat('id-ID').format(calc.kurang)}</b></span><span>Nilai terkirim ke customer <b data-calc-value>${rupiah(calc.actual)}</b></span></div></section>`;
}

function confirmDelete(table, id) {
  const labels = {
    cashflow_transactions: 'transaksi kas', supplier_ledger_entries: 'catatan pemasok', sales_invoices: 'invoice',
    supplier_purchase_orders: 'PO supplier', customer_orders: 'PO customer', production_events: 'catatan kendala',
  };
  state.pendingDelete = { table, id };
  openModal({ title: `Hapus ${labels[table] || 'data'}?`, action: 'confirm-delete', submit: 'Hapus data', body: `<p class="confirm-copy">Data ini akan dihapus dari akun Anda. Tindakan ini tidak dapat dibatalkan.</p>`, attrs: `data-table="${esc(table)}" data-id="${esc(id)}"` });
}

function editByTable(table, id) {
  const row = state.data[table]?.find((item) => item.id === id);
  if (!row) return;
  if (table === 'cashflow_transactions') cashflowModal(row);
  if (table === 'supplier_ledger_entries') supplierEntryModal(row.entry_type, row.supplier, row);
  if (table === 'sales_invoices') invoiceModal(row);
  if (table === 'customer_orders') customerOrderModal(row);
  if (table === 'supplier_purchase_orders') supplierOrderModal(row);
  if (table === 'production_events') productionEventModal(row.customer_order_id, row);
}

const csvNumericCell = (value, minimumFractionDigits = 0, maximumFractionDigits = 2) => ({
  __csvNumeric: true,
  value: new Intl.NumberFormat('id-ID', { minimumFractionDigits, maximumFractionDigits }).format(Number(value) || 0),
});
const csvMoney = (value) => csvNumericCell(value, 2, 2);
const csvQuantity = (value) => csvNumericCell(value, 0, 2);
const csvDate = (value) => value ? formatDate(value) : '—';
const reportPeriod = () => monthName(state.month);

function downloadReport(filename, title, period, summary, headers, details, totalRow = null) {
  const exportedAt = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta',
  }).format(new Date());
  const rows = [
    ['LAPORAN CV SURYA PRATAMA MANDIRI'],
    ['Nama laporan', title],
    ['Periode', period],
    ['Waktu ekspor', exportedAt],
    [],
    ['REKAPAN'],
    ['Indikator', 'Nilai'],
    ...summary,
    [],
    ['RINCIAN DATA'],
    headers,
    ...details,
    ...(totalRow ? [totalRow] : []),
  ];
  downloadCsv(filename, rows);
}

function exportData(kind) {
  const period = reportPeriod();
  if (kind === 'cashflow') {
    const all = state.data.cashflow_transactions;
    const rows = all.filter((row) => row.transaction_date?.startsWith(state.month))
      .sort((a, b) => (a.transaction_date || '').localeCompare(b.transaction_date || '') || (a.created_at || '').localeCompare(b.created_at || ''));
    const debit = rows.filter((row) => row.kind === 'debit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const credit = rows.filter((row) => row.kind === 'credit').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const settings = state.data.company_settings[0] || {};
    const balance = Number(settings.opening_balance || 0) + all.filter((row) => !settings.opening_balance_date || row.transaction_date >= settings.opening_balance_date)
      .reduce((sum, row) => sum + (row.kind === 'credit' ? 1 : -1) * Number(row.amount || 0), 0);
    const details = rows.map((row) => [
      csvDate(row.transaction_date), row.category, row.requester || '—', row.description || '—',
      row.kind === 'debit' ? csvMoney(row.amount) : '', row.kind === 'credit' ? csvMoney(row.amount) : '',
    ]);
    downloadReport(`spm-cashflow-${state.month}.csv`, 'Cashflow dan transaksi kas', period, [
      ['Jumlah transaksi', csvQuantity(rows.length)], ['Total uang masuk (Rp)', csvMoney(credit)],
      ['Total uang keluar (Rp)', csvMoney(debit)], ['Arus kas bersih periode (Rp)', csvMoney(credit - debit)],
      ['Saldo berjalan saat ekspor (Rp)', csvMoney(balance)],
    ], ['Tanggal', 'Kategori', 'Pengaju', 'Keterangan', 'Debit (Rp)', 'Kredit (Rp)'], details,
    ['TOTAL PERIODE', '', '', '', csvMoney(debit), csvMoney(credit)]);
  } else if (kind === 'invoices') {
    const rows = [...state.data.sales_invoices].sort((a, b) => (a.customer || '').localeCompare(b.customer || '', 'id-ID', { sensitivity: 'base' })
      || (a.invoice_date || '').localeCompare(b.invoice_date || '') || (a.invoice_number || '').localeCompare(b.invoice_number || '', 'id-ID'));
    const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalPaid = rows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
    const totalOutstanding = rows.reduce((sum, row) => sum + Number(row.outstanding_amount ?? Math.max(Number(row.amount || 0) - Number(row.paid_amount || 0), 0)), 0);
    const statusCounts = rows.reduce((counts, row) => {
      const status = statusForInvoice(row)[1]; counts[status] = (counts[status] || 0) + 1; return counts;
    }, {});
    const details = rows.map((row) => [
      row.customer, csvDate(row.invoice_date), csvDate(row.due_date), csvDate(row.paid_date), row.invoice_number, row.po_number || '—',
      csvMoney(row.amount), csvMoney(row.paid_amount), csvMoney(row.outstanding_amount ?? Math.max(Number(row.amount || 0) - Number(row.paid_amount || 0), 0)), statusForInvoice(row)[1],
    ]);
    downloadReport('spm-invoice-semua-periode.csv', 'Tagihan customer', 'Semua periode', [
      ['Jumlah invoice', csvQuantity(rows.length)], ['Jumlah customer', csvQuantity(new Set(rows.map((row) => row.customer).filter(Boolean)).size)],
      ['Nilai seluruh invoice (Rp)', csvMoney(totalAmount)], ['Total pembayaran tercatat (Rp)', csvMoney(totalPaid)],
      ['Total outstanding (Rp)', csvMoney(totalOutstanding)], ...Object.entries(statusCounts).map(([status, count]) => [`Invoice ${status.toLocaleLowerCase('id-ID')}`, csvQuantity(count)]),
    ], ['Customer', 'Tanggal invoice', 'Jatuh tempo', 'Tanggal pelunasan', 'No. invoice', 'No. PO', 'Nilai invoice (Rp)', 'Sudah dibayar (Rp)', 'Outstanding (Rp)', 'Status'], details,
    ['TOTAL SEMUA CUSTOMER', '', '', '', '', '', csvMoney(totalAmount), csvMoney(totalPaid), csvMoney(totalOutstanding), '']);
  } else if (kind === 'production') {
    const rows = state.data.customer_orders.filter((row) => row.order_date?.startsWith(state.month))
      .sort((a, b) => (a.customer || '').localeCompare(b.customer || '', 'id-ID', { sensitivity: 'base' }) || (a.order_date || '').localeCompare(b.order_date || '') || (a.po_number || '').localeCompare(b.po_number || '', 'id-ID'));
    const totals = rows.reduce((sum, row) => {
      const values = customerOrderFinancials(row);
      sum.ordered += values.qtyOrder;
      sum.produced += Number(row.qty_produced || 0);
      sum.delivered += values.qtyDelivered;
      sum.qtyDelta += values.qtyDelta;
      sum.shortage += Math.max(-values.qtyDelta, 0);
      sum.amount += values.amount;
      sum.tax += values.tax;
      sum.totalPrice += values.totalPrice;
      sum.realizedAmount += values.realizedAmount;
      sum.realizedTax += values.realizedTax;
      sum.realizedTotal += values.realizedTotal;
      sum.salesShortfall += values.salesShortfall;
      return sum;
    }, { ordered: 0, produced: 0, delivered: 0, qtyDelta: 0, shortage: 0, amount: 0, tax: 0, totalPrice: 0, realizedAmount: 0, realizedTax: 0, realizedTotal: 0, salesShortfall: 0 });
    const details = rows.map((row) => {
      const values = customerOrderFinancials(row);
      return [
        csvDate(row.order_date), csvDate(row.due_date), row.po_number || '—', row.customer || '—', row.spm_skg || '—', row.item || '—', row.size || '—',
        csvQuantity(values.qtyOrder), csvQuantity(row.qty_produced), csvQuantity(values.qtyDelivered), csvQuantity(values.qtyDelta),
        csvMoney(values.unitPrice), csvMoney(values.amount), csvMoney(values.tax), csvMoney(values.totalPrice),
        csvMoney(values.realizedAmount), csvMoney(values.realizedTax), csvMoney(values.realizedTotal), csvMoney(values.salesShortfall),
        row.size_sheet || '—', row.floot || '—', row.score || '—', row.height || '—', row.score_secondary || '—', orderProgress(row)[1],
      ];
    });
    downloadReport(`spm-produksi-${state.month}.csv`, 'Performa produksi dan pesanan customer', period, [
      ['Jumlah baris pesanan', csvQuantity(rows.length)], ['Jumlah PO unik', csvQuantity(new Set(rows.map((row) => row.po_number).filter(Boolean)).size)],
      ['Total qty dipesan', csvQuantity(totals.ordered)], ['Total qty diproduksi', csvQuantity(totals.produced)],
      ['Total qty terkirim', csvQuantity(totals.delivered)], ['Total kekurangan kirim', csvQuantity(totals.shortage)],
      ['Total harga PO sebelum PPN (Rp)', csvMoney(totals.amount)], ['PPN PO (Rp)', csvMoney(totals.tax)], ['Total price PO (Rp)', csvMoney(totals.totalPrice)],
      ['Jumlah jual (Rp)', csvMoney(totals.realizedAmount)], ['PPN jual (Rp)', csvMoney(totals.realizedTax)],
      ['Jumlah jual termasuk PPN (Rp)', csvMoney(totals.realizedTotal)], ['Kurang jual (Rp)', csvMoney(totals.salesShortfall)],
      ['Pesanan lewat janji', csvQuantity(rows.filter((row) => orderProgress(row)[0] === 'late').length)],
    ], ['Tanggal PO', 'Janji kirim', 'No. PO', 'Customer', 'SPM/SKG', 'Item', 'Size', 'QTY PO', 'Qty diproduksi', 'Delivery', 'Close/Kurang kirim', 'Price (Rp)', 'Total harga (Rp)', 'PPN PO (Rp)', 'Total price PO (Rp)', 'Jumlah jual (Rp)', 'PPN jual (Rp)', 'Jumlah jual+PPN (Rp)', 'Kurang jual (Rp)', 'Size Sheet', 'Floot', 'Scoor', 'Tinggi', 'Scoor 2', 'Status pesanan'], details,
    ['TOTAL PERIODE', '', '', '', '', '', '', csvQuantity(totals.ordered), csvQuantity(totals.produced), csvQuantity(totals.delivered), csvQuantity(totals.qtyDelta), '', csvMoney(totals.amount), csvMoney(totals.tax), csvMoney(totals.totalPrice), csvMoney(totals.realizedAmount), csvMoney(totals.realizedTax), csvMoney(totals.realizedTotal), csvMoney(totals.salesShortfall), '', '', '', '', '', '']);
  } else if (kind === 'supplier-po') {
    const orders = state.data.supplier_purchase_orders.filter((order) => order.order_date?.startsWith(state.month))
      .sort((a, b) => (a.order_date || '').localeCompare(b.order_date || '') || (a.po_number || '').localeCompare(b.po_number || '', 'id-ID'));
    const items = orders.flatMap((order) => (order.items || []).map((item) => {
      const ordered = Number(item.qtyOrder) || 0; const shipped = Number(item.qtyKirim) || 0; const price = Number(item.harga) || 0;
      const stock = Math.max(ordered - shipped, 0); const stockValue = stock * price; const shippedValue = shipped * price;
      return { order, item, ordered, shipped, price, stock, stockValue, stockTax: stockValue * .11, shippedValue, shippedTax: shippedValue * .11, shippedTotal: shippedValue * 1.11 };
    }));
    const totals = items.reduce((sum, row) => {
      for (const key of ['ordered', 'shipped', 'stock', 'stockValue', 'stockTax', 'shippedValue', 'shippedTax', 'shippedTotal']) sum[key] += row[key];
      return sum;
    }, { ordered: 0, shipped: 0, stock: 0, stockValue: 0, stockTax: 0, shippedValue: 0, shippedTax: 0, shippedTotal: 0 });
    const details = items.map(({ order, item, ordered, shipped, price, stock, stockValue, stockTax, shippedValue, shippedTax, shippedTotal }) => [
      csvDate(order.order_date), order.po_number || '—', order.supplier || '—', order.customer || '—', item.item || 'SHEET',
      item.qlty || '—', item.sizeSheet || '—', csvQuantity(ordered), csvQuantity(stock), csvMoney(price), csvMoney(stockValue),
      csvMoney(stockTax), csvQuantity(shipped), csvMoney(shippedValue), csvMoney(shippedTax), csvMoney(shippedTotal),
    ]);
    downloadReport(`spm-po-supplier-${state.month}.csv`, 'Rekap stock bahan PO supplier', period, [
      ['Jumlah PO', csvQuantity(new Set(orders.map((order) => order.po_number).filter(Boolean)).size)],
      ['Jumlah supplier', csvQuantity(new Set(orders.map((order) => String(order.supplier || '').trim().toLocaleLowerCase('id-ID')).filter(Boolean)).size)],
      ['Jumlah baris item', csvQuantity(items.length)], ['Total qty dipesan dari supplier', csvQuantity(totals.ordered)],
      ['Total qty terkirim ke customer', csvQuantity(totals.shipped)], ['Total stock tersedia', csvQuantity(totals.stock)],
      ['Nilai stock sebelum PPN (Rp)', csvMoney(totals.stockValue)], ['PPN stock (Rp)', csvMoney(totals.stockTax)],
      ['Total nilai stock termasuk PPN (Rp)', csvMoney(totals.stockTotal)],
    ], ['Tanggal PO', 'No. PO', 'Supplier', 'Customer', 'Item', 'QLTY', 'Ukuran sheet', 'Qty order dari supplier', 'Stock tersedia', 'Harga/unit (Rp)', 'Nilai stock (Rp)', 'PPN stock (Rp)', 'Qty kirim ke customer', 'Nilai terkirim (Rp)', 'PPN terkirim (Rp)', 'Total terkirim + PPN (Rp)'], details,
    ['TOTAL PERIODE', '', '', '', '', '', '', csvQuantity(totals.ordered), csvQuantity(totals.stock), '', csvMoney(totals.stockValue), csvMoney(totals.stockTax), csvQuantity(totals.shipped), csvMoney(totals.shippedValue), csvMoney(totals.shippedTax), csvMoney(totals.shippedTotal)]);
  } else if (kind === 'supplier-ledger') {
    const all = state.data.supplier_ledger_entries;
    const supplierKey = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
    const billsById = new Map(all.filter((row) => row.entry_type === 'bill').map((row) => [row.id, row]));
    const chronological = [...all].sort((a, b) => supplierKey(a.supplier).localeCompare(supplierKey(b.supplier), 'id-ID')
      || (a.entry_date || '').localeCompare(b.entry_date || '') || (a.created_at || '').localeCompare(b.created_at || '') || String(a.id || '').localeCompare(String(b.id || '')));
    const balances = new Map(); const balanceAfterEntry = new Map();
    chronological.forEach((row) => {
      const key = supplierKey(row.supplier); const next = (balances.get(key) || 0) + (row.entry_type === 'bill' ? 1 : -1) * Number(row.amount || 0);
      balances.set(key, next); balanceAfterEntry.set(row.id, next);
    });
    const rows = chronological.filter((row) => row.entry_date?.startsWith(state.month));
    const bills = rows.filter((row) => row.entry_type === 'bill').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const payments = rows.filter((row) => row.entry_type === 'payment').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const currentBalances = [...balances.values()].map((value) => Math.max(value, 0));
    const currentOutstanding = currentBalances.reduce((sum, value) => sum + value, 0);
    const details = rows.map((row) => {
      const linkedBill = row.linked_bill_id ? billsById.get(row.linked_bill_id) : null;
      const linkedBillLabel = linkedBill
        ? `${csvDate(linkedBill.entry_date)} · ${linkedBill.description || 'Tanpa keterangan'} · ${csvMoney(linkedBill.amount)}`
        : row.entry_type === 'payment' ? 'Belum ditautkan ke tagihan tertentu' : '';
      return [
        csvDate(row.entry_date), row.supplier, row.entry_type === 'bill' ? 'Tagihan' : 'Pembayaran',
        row.entry_type === 'bill' ? csvMoney(row.amount) : '', row.entry_type === 'payment' ? csvMoney(row.amount) : '',
        csvMoney(Math.max(balanceAfterEntry.get(row.id) || 0, 0)), linkedBillLabel, row.description || '—',
      ];
    });
    downloadReport(`spm-piutang-pemasok-${state.month}.csv`, 'Tagihan dan pembayaran supplier', period, [
      ['Jumlah transaksi periode', csvQuantity(rows.length)], ['Total tagihan periode (Rp)', csvMoney(bills)],
      ['Total pembayaran periode (Rp)', csvMoney(payments)], ['Perubahan saldo periode (Rp)', csvMoney(bills - payments)],
      ['Sisa piutang seluruh supplier saat ekspor (Rp)', csvMoney(currentOutstanding)],
      ['Supplier dengan piutang aktif saat ekspor', csvQuantity(currentBalances.filter((value) => value > 0).length)],
    ], ['Tanggal', 'Supplier', 'Jenis transaksi', 'Tagihan (Rp)', 'Pembayaran (Rp)', 'Sisa supplier setelah transaksi (Rp)', 'Tagihan yang dibayar', 'Keterangan'], details,
    ['TOTAL PERIODE', '', '', csvMoney(bills), csvMoney(payments), '', '', '']);
  } else if (kind === 'events') {
    const rows = state.data.production_events.filter((row) => row.event_date?.startsWith(state.month))
      .sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '') || String(a.id || '').localeCompare(String(b.id || '')));
    const causeLabel = (value) => CAUSES.find(([key]) => key === value)?.[1] || value || '—';
    const linked = rows.map((row) => ({ row, order: state.data.customer_orders.find((item) => item.id === row.customer_order_id) }));
    const affected = rows.reduce((sum, row) => sum + Number(row.affected_qty || 0), 0);
    const details = linked.map(({ row, order }) => [
      csvDate(row.event_date), order?.customer || 'PO dihapus/tidak ditemukan', order?.po_number || '—', order?.item || '—',
      causeLabel(row.cause_category), row.cause_detail || '—', csvQuantity(row.affected_qty), row.status === 'open' ? 'Terbuka' : 'Selesai',
    ]);
    downloadReport(`spm-kendala-produksi-${state.month}.csv`, 'Kendala dan penyebab produksi', period, [
      ['Jumlah catatan kendala', csvQuantity(rows.length)], ['Kendala masih terbuka', csvQuantity(rows.filter((row) => row.status === 'open').length)],
      ['Kendala selesai', csvQuantity(rows.filter((row) => row.status === 'resolved').length)], ['Total unit terdampak', csvQuantity(affected)],
    ], ['Tanggal', 'Customer', 'No. PO', 'Barang', 'Kategori penyebab', 'Catatan', 'Unit terdampak', 'Status'], details,
    ['TOTAL PERIODE', '', '', '', '', '', csvQuantity(affected), '']);
  } else if (kind === 'dashboard-invoices') {
    const rows = state.data.sales_invoices.filter((row) => Number(row.outstanding_amount ?? Math.max(Number(row.amount || 0) - Number(row.paid_amount || 0), 0)) > 0)
      .sort((a, b) => (a.customer || '').localeCompare(b.customer || '', 'id-ID', { sensitivity: 'base' }) || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const outstanding = (row) => Number(row.outstanding_amount ?? Math.max(Number(row.amount || 0) - Number(row.paid_amount || 0), 0));
    const overdue = rows.filter((row) => statusForInvoice(row)[0] === 'late');
    const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalPaid = rows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
    const totalOutstanding = rows.reduce((sum, row) => sum + outstanding(row), 0);
    const details = rows.map((row) => [
      row.customer || '—', row.invoice_number, row.po_number || '—', csvDate(row.invoice_date), csvDate(row.due_date),
      csvMoney(row.amount), csvMoney(row.paid_amount), csvMoney(outstanding(row)), statusForInvoice(row)[1],
    ]);
    downloadReport('spm-outstanding-invoice-semua-periode.csv', 'Invoice customer yang belum lunas', 'Semua periode', [
      ['Jumlah invoice outstanding', csvQuantity(rows.length)], ['Jumlah customer', csvQuantity(new Set(rows.map((row) => row.customer).filter(Boolean)).size)],
      ['Nilai invoice (Rp)', csvMoney(totalAmount)], ['Pembayaran tercatat (Rp)', csvMoney(totalPaid)],
      ['Total outstanding (Rp)', csvMoney(totalOutstanding)], ['Invoice terlambat', csvQuantity(overdue.length)],
      ['Outstanding terlambat (Rp)', csvMoney(overdue.reduce((sum, row) => sum + outstanding(row), 0))],
    ], ['Customer', 'No. invoice', 'No. PO', 'Tanggal invoice', 'Jatuh tempo', 'Nilai invoice (Rp)', 'Sudah dibayar (Rp)', 'Outstanding (Rp)', 'Status'], details,
    ['TOTAL OUTSTANDING', '', '', '', '', csvMoney(totalAmount), csvMoney(totalPaid), csvMoney(totalOutstanding), '']);
  } else if (kind === 'pricelist') {
    const prices = pricelist.flatMap((row) => row[2].map(Number));
    const minimum = Math.min(...prices); const maximum = Math.max(...prices);
    const average = prices.reduce((sum, value) => sum + value, 0) / (prices.length || 1);
    const details = pricelist.map((row) => [row[0], ...row[1], ...row[2].map((value) => csvNumericCell(value, 0, 0))]);
    downloadReport('spm-pricelist-karton.csv', 'Daftar harga karton', 'Tidak berlaku', [
      ['Jumlah komposisi material', csvQuantity(pricelist.length)], ['Varian harga per komposisi', csvQuantity(priceSpecs.length)],
      ['Harga minimum (Rp)', csvNumericCell(minimum, 0, 0)], ['Harga maksimum (Rp)', csvNumericCell(maximum, 0, 0)],
      ['Rata-rata harga (Rp)', csvNumericCell(average, 0, 0)],
    ], ['No.', 'Fluting', 'Medium', 'Liner', ...priceSpecs.map((spec) => `${spec} (Rp)`)], details);
  }
}

async function saveModal(form) {
  const formData = new FormData(form);
  const values = Object.fromEntries(formData.entries());
  const id = form.dataset.id || '';
  const action = form.dataset.action;
  const num = (key) => toNumber(values[key]);
  if (action === 'save-cashflow') {
    const category = values.category;
    const result = await saveRow('cashflow_transactions', {
      transaction_date: values.transaction_date, category, requester: values.requester.trim(), description: values.description.trim(),
      amount: num('amount'), kind: ['Uang Masuk', 'Dana Talang'].includes(category) ? 'credit' : 'debit',
    }, id);
    return result;
  }
  if (action === 'save-opening') {
    const userId = state.session.user.id;
    const valuesToSave = {
      owner_id: userId, workspace_id: state.profile.workspace_id,
      opening_balance: num('opening_balance'), opening_balance_date: values.opening_balance_date,
    };
    const { error } = await supabase.from('company_settings').upsert({
      ...valuesToSave,
    }, { onConflict: 'workspace_id' });
    if (error) throw error;
    return valuesToSave;
  }
  if (action === 'save-supplier-entry') {
    const supplier = String(values.supplier || '').trim().replace(/\s+/g, ' ');
    const amount = num('amount');
    if (!supplier) throw new Error('Nama supplier wajib diisi.');
    if (!values.entry_date) throw new Error('Tanggal transaksi wajib diisi.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Nominal harus lebih besar dari Rp 0.');
    const linkedBillId = String(values.linked_bill_id || '').trim() || null;
    if (values.entry_type === 'payment') {
      if (!id && !linkedBillId) throw new Error('Pilih tagihan supplier yang akan dibayar.');
      const balance = supplierBalanceFor(state.data.supplier_ledger_entries, supplier, id);
      if (amount > balance) throw new Error(`Nominal bayar melebihi sisa seluruh tagihan supplier ${rupiah(Math.max(balance, 0))}.`);
      if (linkedBillId) {
        const linkedBill = state.data.supplier_ledger_entries.find((row) => row.id === linkedBillId && row.entry_type === 'bill');
        if (!linkedBill || normalizeSupplierName(linkedBill.supplier) !== normalizeSupplierName(supplier)) {
          throw new Error('Tagihan yang dipilih tidak cocok dengan supplier ini.');
        }
        const billBalance = linkedBillBalanceFor(state.data.supplier_ledger_entries, linkedBillId, id);
        if (billBalance === null || amount > billBalance) {
          throw new Error(`Nominal bayar melebihi sisa tagihan terpilih ${rupiah(Math.max(billBalance || 0, 0))}.`);
        }
      }
    }
    const normalizedSupplier = normalizeSupplierName(supplier);
    const existingSupplier = state.data.supplier_ledger_entries.find((row) => normalizeSupplierName(row.supplier) === normalizedSupplier)?.supplier;
    const saved = await saveRow('supplier_ledger_entries', {
      supplier, entry_date: values.entry_date, entry_type: values.entry_type,
      amount, description: values.description.trim(), linked_bill_id: values.entry_type === 'payment' ? linkedBillId : null,
    }, id);
    state.expandedSuppliers.add(String(existingSupplier || supplier).trim().replace(/\s+/g, ' '));
    state.expandedSuppliers.add(supplier);
    return saved;
  }
  if (action === 'save-invoice') {
    const amount = num('amount');
    const paidAmount = Math.min(num('paid_amount'), amount);
    const existingInvoice = id ? state.data.sales_invoices.find((row) => row.id === id) : null;
    if (paidAmount > Number(existingInvoice?.paid_amount || 0) && !values.paid_date) {
      throw new Error('Tanggal pembayaran wajib diisi saat menambah jumlah yang sudah dibayar.');
    }
    if (amount > 0 && paidAmount >= amount && !values.paid_date) {
      throw new Error('Tanggal pelunasan wajib diisi untuk invoice yang sudah lunas.');
    }
    return saveRow('sales_invoices', {
      invoice_date: values.invoice_date, due_date: values.due_date || null, paid_date: values.paid_date || null,
      customer: values.customer.trim(), invoice_number: values.invoice_number.trim(), po_number: values.po_number.trim(),
      amount, paid_amount: paidAmount, outstanding_amount: null,
    }, id);
  }
  if (action === 'mark-invoice-paid') {
    const invoice = state.data.sales_invoices.find((row) => row.id === id);
    if (!invoice) throw new Error('Invoice tidak ditemukan. Muat ulang halaman lalu coba lagi.');
    if (!values.paid_date) throw new Error('Tanggal pelunasan wajib diisi.');
    const paymentAmount = num('payment_amount');
    const outstanding = Number(invoice.outstanding_amount ?? Math.max(Number(invoice.amount) - Number(invoice.paid_amount || 0), 0));
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new Error('Jumlah pembayaran harus lebih besar dari Rp 0.');
    if (paymentAmount > outstanding || Number(invoice.paid_amount || 0) + paymentAmount > Number(invoice.amount)) {
      throw new Error(`Pembayaran melebihi sisa invoice ${rupiah(Math.max(outstanding, 0))}.`);
    }
    return saveRow('sales_invoices', {
      paid_date: values.paid_date, paid_amount: Number(invoice.paid_amount || 0) + paymentAmount, outstanding_amount: null,
    }, id);
  }
  if (action === 'save-customer-order') {
    const qtyOrder = num('qty_order');
    const unitPrice = num('unit_price');
    const tax = num('po_tax_amount');
    if (qtyOrder <= 0) throw new Error('QTY PO harus lebih besar dari 0.');
    if (!values.order_date) throw new Error('Tanggal PO wajib diisi.');
    return saveRow('customer_orders', {
      order_date: values.order_date, due_date: values.due_date || null, po_number: values.po_number.trim(), customer: values.customer.trim(),
      spm_skg: values.spm_skg.trim().toUpperCase(), item: values.item.trim(), size: values.size.trim(), qty_order: qtyOrder,
      unit_price: unitPrice, amount: qtyOrder * unitPrice, po_tax_amount: tax, total_price: qtyOrder * unitPrice + tax,
    }, id);
  }
  if (action === 'save-production-event') {
    if (!values.customer_order_id) throw new Error('Pilih PO customer untuk mengaitkan kendala.');
    return saveRow('production_events', {
      customer_order_id: values.customer_order_id, event_date: values.event_date,
      cause_category: values.cause_category, cause_detail: values.cause_detail.trim(), affected_qty: num('affected_qty'), status: values.status,
    }, id);
  }
  if (action === 'save-po') {
    const items = [...form.querySelectorAll('[data-po-item]')].map((section) => ({
      item: section.querySelector('[name="item-item"]').value.trim(),
      qlty: section.querySelector('[name="item-qlty"]').value,
      sizeSheet: section.querySelector('[name="item-size"]').value.trim(),
      qtyOrder: toNumber(section.querySelector('[name="item-ordered"]').value),
      qtyKirim: toNumber(section.querySelector('[name="item-shipped"]').value),
      harga: toNumber(section.querySelector('[name="item-price"]').value),
    }));
    if (!items.length) throw new Error('Tambahkan setidaknya satu item pada PO.');
    return saveRow('supplier_purchase_orders', {
      order_date: values.order_date, po_number: values.po_number.trim(), supplier: values.supplier.trim(), customer: values.customer.trim(), items,
    }, id);
  }
  if (action === 'save-shipped') {
    const order = state.data.supplier_purchase_orders.find((item) => item.id === values.po_id);
    if (!order) throw new Error('PO supplier tidak ditemukan.');
    const items = [...(order.items || [])];
    items[Number(values.item_index)].qtyOrder = num('qtyOrder');
    items[Number(values.item_index)].qtyKirim = num('qtyKirim');
    return saveRow('supplier_purchase_orders', { items }, order.id);
  }
  if (action === 'save-quantities') {
    return saveRow('customer_orders', {
      qty_produced: num('qty_produced'), qty_delivered: num('qty_delivered'), size_sheet: values.size_sheet.trim(),
      floot: values.floot.trim(), score: values.score.trim(), height: values.height.trim(), score_secondary: values.score_secondary.trim(),
    }, values.order_id);
  }
  if (action === 'confirm-delete') {
    const pending = state.pendingDelete;
    if (!pending) throw new Error('Data yang akan dihapus tidak ditemukan.');
    await deleteRow(pending.table, pending.id);
    state.pendingDelete = null;
    return { deleted: true, table: pending.table, id: pending.id };
  }
  throw new Error('Form ini belum memiliki aksi penyimpanan.');
}

async function runImport() {
  const preview = state.importPreview;
  if (!preview?.records.length) throw new Error('Tidak ada baris yang dapat diimpor.');
  const tablesToRefresh = [preview.type];
  const conflict = preview.type === 'supplier_purchase_orders' ? 'workspace_id,po_number' : 'workspace_id,source_key';
  await upsertRows(preview.type, preview.records, conflict);
  if (preview.type === 'sales_invoices') state.reportReceivableHistoryLoadedAt = 0;
  if (preview.type === 'cashflow_transactions' && preview.openingBalance != null) {
    const { error } = await supabase.from('company_settings').upsert({
      owner_id: state.session.user.id, workspace_id: state.profile.workspace_id,
      opening_balance: preview.openingBalance,
      opening_balance_date: preview.openingBalanceDate || `${state.month}-01`,
    }, { onConflict: 'workspace_id' });
    if (error) throw error;
    tablesToRefresh.push('company_settings');
  }
  toast(`${preview.records.length} baris berhasil diimpor.`, 'success');
  state.importPreview = null;
  state.importFile = null;
  await refreshData({ tables: tablesToRefresh, forceTables: true, showLoading: false });
}

function updatePoPreview(target) {
  const item = target.closest('[data-po-item]');
  if (!item) return;
  const ordered = toNumber(item.querySelector('[name="item-ordered"]').value);
  const shipped = toNumber(item.querySelector('[name="item-shipped"]').value);
  const price = toNumber(item.querySelector('[name="item-price"]').value);
  const short = item.querySelector('[data-calc-short]');
  const actual = item.querySelector('[data-calc-value]');
  if (short) short.textContent = new Intl.NumberFormat('id-ID').format(Math.max(ordered - shipped, 0));
  if (actual) actual.textContent = rupiah(shipped * price);
}

function formatMoneyInput(target) {
  const previousValue = target.value;
  const previousCaret = target.selectionStart ?? previousValue.length;
  const sourceBeforeCaret = previousValue.slice(0, previousCaret);
  const raw = previousValue.replace(/[^\d,]/g, '');
  const decimalIndex = raw.indexOf(',');
  const integerPart = (decimalIndex < 0 ? raw : raw.slice(0, decimalIndex)).replace(/\D/g, '');
  const decimalPart = decimalIndex < 0 ? '' : raw.slice(decimalIndex + 1).replace(/\D/g, '');
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const formatted = `${groupedInteger}${decimalIndex < 0 ? '' : `,${decimalPart}`}`;
  if (formatted !== previousValue) {
    const tokensBeforeCaret = (sourceBeforeCaret.match(/[\d,]/g) || []).length;
    let nextCaret = 0;
    let seenTokens = 0;
    while (nextCaret < formatted.length && seenTokens < tokensBeforeCaret) {
      if (/[\d,]/.test(formatted[nextCaret])) seenTokens += 1;
      nextCaret += 1;
    }
    target.value = formatted;
    target.setSelectionRange(nextCaret, nextCaret);
  }
}

function validateMoneyInputs(form) {
  for (const input of form.querySelectorAll('[data-money-input]')) {
    const value = input.value.trim();
    let message = '';
    if (input.required && !value) message = 'Nominal wajib diisi.';
    else if (value && !/\d/.test(value)) message = 'Masukkan nominal yang valid.';
    else if (value) {
      const amount = toNumber(value);
      const min = input.dataset.min === undefined ? null : Number(input.dataset.min);
      const max = input.dataset.max === undefined ? null : Number(input.dataset.max);
      const decimalCount = value.match(/,(\d*)$/)?.[1].length || 0;
      if (min !== null && amount < min) message = `Nominal minimal ${formatNumberInput(min)}.`;
      else if (max !== null && amount > max) message = `Nominal maksimal ${formatNumberInput(max)}.`;
      else if (input.dataset.step === '0.01' && decimalCount > 2) message = 'Maksimal dua angka di belakang koma.';
    }
    if (message) {
      input.setCustomValidity(message);
      input.reportValidity();
      input.setCustomValidity('');
      return false;
    }
  }
  return true;
}

function preservePoDraft() {
  const form = document.querySelector('.modal-form[data-action="save-po"]');
  if (!form) return;
  const data = new FormData(form);
  state.poDraft = {
    id: form.dataset.id || '', po_number: data.get('po_number'), supplier: data.get('supplier'), customer: data.get('customer'), order_date: data.get('order_date'),
    items: [...form.querySelectorAll('[data-po-item]')].map((section) => ({
      item: section.querySelector('[name="item-item"]').value, qlty: section.querySelector('[name="item-qlty"]').value,
      sizeSheet: section.querySelector('[name="item-size"]').value, qtyOrder: section.querySelector('[name="item-ordered"]').value,
      qtyKirim: section.querySelector('[name="item-shipped"]').value, harga: section.querySelector('[name="item-price"]').value,
    })),
  };
}

function setSearch(target) {
  state.search = target.value;
  const filter = target.dataset.filter;
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    render();
    const input = document.querySelector(`[data-filter="${filter}"]`);
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }, 160);
}

async function handleClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const action = button.dataset.act;
  if (action === 'backdrop' && event.target === button) { state.modal = null; render(); return; }
  if (action === 'dismiss-toast') { document.querySelector('.toast-stack').innerHTML = ''; return; }
  if (action === 'close-modal') { state.modal = null; state.pendingDelete = null; render(); return; }
  if (action === 'auth-mode') { state.authMode = button.dataset.mode; state.authMessage = ''; state.authMessageType = 'info'; render(); return; }
  if (action === 'navigate') {
    if (button.dataset.tab === 'logs-input' && state.profile?.role !== 'developer') return;
    state.tab = button.dataset.tab; state.search = ''; state.modal = null;
    void refreshData({ forceLogs: state.tab === 'logs-input', forceProfiles: state.tab === 'logs-input' });
    return;
  }
  if (action === 'toggle-report-filters') { state.reportFiltersOpen = !state.reportFiltersOpen; render(); return; }
  if (action === 'toggle-customer-stock') {
    const customer = button.dataset.customer || '';
    state.expandedSupplierCustomers.has(customer)
      ? state.expandedSupplierCustomers.delete(customer)
      : state.expandedSupplierCustomers.add(customer);
    render(); return;
  }
  if (action === 'fullscreen-report-chart') {
    const chart = document.querySelector('[data-report-chart]');
    try {
      if (document.fullscreenElement === chart) await document.exitFullscreen();
      else if (chart?.requestFullscreen) await chart.requestFullscreen();
      else throw new Error('Mode layar penuh tidak didukung browser ini.');
    } catch (error) { toast(friendlyError(error), 'error'); }
    return;
  }
  if (action === 'report-select-all') {
    syncReportCategoryPreferences();
    state.reportCategories = [...state.reportCategoryKnownCategories];
    persistReportCategoryPreferences();
    render(); return;
  }
  if (action === 'report-reset-categories') {
    syncReportCategoryPreferences();
    state.reportCategories = [];
    persistReportCategoryPreferences();
    render(); return;
  }
  if (action === 'print-report') { window.print(); return; }
  if (action === 'export-report') { downloadReportCsv(state.data, state); return; }
  if (action === 'select-month') { state.month = button.dataset.month; render(); return; }
  if (action === 'change-year') {
    const [year, month] = state.month.split('-').map(Number);
    state.month = `${year + Number(button.dataset.delta)}-${String(month).padStart(2, '0')}`;
    render(); return;
  }
  if (action === 'signout') { await supabase.auth.signOut(); state.data = emptyData(); return; }
  if (action === 'new-cashflow') { cashflowModal(); return; }
  if (action === 'new-invoice') { invoiceModal(); return; }
  if (action === 'new-customer-order') { customerOrderModal(); return; }
  if (action === 'new-supplier-bill') { supplierEntryModal('bill'); return; }
  if (action === 'new-supplier-payment') { supplierEntryModal('payment', button.dataset.supplier || ''); return; }
  if (action === 'new-production') { customerOrderModal(); return; }
  if (action === 'new-event') { productionEventModal(button.dataset.order || ''); return; }
  if (action === 'new-po') { supplierOrderModal(); return; }
  if (action === 'edit-opening') {
    const row = state.data.company_settings[0] || {};
    openModal({ title: 'Atur saldo awal', action: 'save-opening', submit: 'Simpan saldo awal', body: `<div class="form-grid">${inputField('Nilai saldo awal', 'opening_balance', row.opening_balance || 0, 'number', { required: true, step: '0.01' })}${inputField('Saldo per tanggal', 'opening_balance_date', row.opening_balance_date || isoToday(), 'date', { required: true })}</div><p class="form-hint">Saldo berjalan dihitung dari transaksi pada dan setelah tanggal saldo awal.</p>` });
    return;
  }
  if (action === 'open-import') { state.tab = 'impor'; void refreshData(); return; }
  if (action === 'filter-category') { state.category = state.category === button.dataset.category ? '' : button.dataset.category; render(); return; }
  if (action === 'toggle-supplier') {
    const name = button.dataset.supplier;
    state.expandedSuppliers.has(name) ? state.expandedSuppliers.delete(name) : state.expandedSuppliers.add(name);
    render(); return;
  }
  if (action === 'edit') { editByTable(button.dataset.table, button.dataset.id); return; }
  if (action === 'delete') { confirmDelete(button.dataset.table, button.dataset.id); return; }
  if (action === 'toggle-invoice') {
    const invoice = state.data.sales_invoices.find((row) => row.id === button.dataset.id);
    if (!invoice) return;
    const isPaid = Number(invoice.outstanding_amount ?? Math.max(invoice.amount - (invoice.paid_amount || 0), 0)) <= 0;
    if (!isPaid) {
      invoicePaymentDateModal(invoice);
      return;
    }
    try {
      const updated = await saveRow('sales_invoices', {
        paid_date: null, paid_amount: 0, outstanding_amount: invoice.amount,
      }, invoice.id);
      updateLocalRow('sales_invoices', updated); state.reportReceivableHistoryLoadedAt = 0; render();
      toast('Invoice ditandai belum lunas.');
    } catch (error) { toast(friendlyError(error), 'error'); }
    return;
  }
  if (action === 'toggle-event') {
    const row = state.data.production_events.find((item) => item.id === button.dataset.id);
    if (!row) return;
    try {
      const updated = await saveRow('production_events', { status: row.status === 'open' ? 'resolved' : 'open' }, row.id);
      updateLocalRow('production_events', updated); render(); toast('Status kendala diperbarui.', 'info');
    }
    catch (error) { toast(friendlyError(error), 'error'); }
    return;
  }
  if (action === 'edit-quantities') {
    const row = state.data.customer_orders.find((item) => item.id === button.dataset.id);
    if (!row) return;
    openModal({ title: `Realisasi · ${row.po_number}`, action: 'save-quantities', submit: 'Simpan realisasi', body: `<input type="hidden" name="order_id" value="${row.id}"><div class="form-grid">${inputField('Jumlah diproduksi', 'qty_produced', row.qty_produced || 0, 'number', { min: 0, step: '0.01' })}${inputField('Delivery', 'qty_delivered', row.qty_delivered || 0, 'number', { min: 0, step: '0.01' })}${inputField('Size Sheet', 'size_sheet', row.size_sheet || '')}${inputField('Floot', 'floot', row.floot || '')}${inputField('Scoor', 'score', row.score || '')}${inputField('Tinggi', 'height', row.height || '')}${inputField('Scoor kedua', 'score_secondary', row.score_secondary || '')}</div><p class="form-hint">Nilai jual dihitung dari Delivery × PRICE. PPN realisasi mengikuti rumus workbook (11%); selisih kirim dan kurang jual dihitung otomatis.</p>` });
    return;
  }
  if (action === 'edit-shipped') {
    const order = state.data.supplier_purchase_orders.find((row) => row.id === button.dataset.id);
    const item = order?.items?.[Number(button.dataset.index)];
    if (!order || !item) return;
    openModal({ title: `Update qty kirim ke customer · ${order.po_number}`, action: 'save-shipped', submit: 'Simpan qty kirim', body: `<input type="hidden" name="po_id" value="${order.id}"><input type="hidden" name="item_index" value="${button.dataset.index}"><div class="form-grid">${inputField('Qty order dari supplier', 'qtyOrder', item.qtyOrder, 'number', { min: 0, step: '0.01' })}${inputField('Qty kirim ke customer', 'qtyKirim', item.qtyKirim || 0, 'number', { min: 0, step: '0.01', required: true })}</div><p class="form-hint">Stock tersedia dihitung dari Qty order dikurangi Qty kirim ke customer.</p>` });
    return;
  }
  if (action === 'add-po-item') {
    const form = document.querySelector('.modal-form[data-action="save-po"]');
    const list = form?.querySelector('.po-item-list');
    if (list) list.insertAdjacentHTML('beforeend', supplierPoItem({ item: 'SHEET', qlty: 'BF', qtyOrder: '', qtyKirim: 0, harga: '' }, list.children.length));
    return;
  }
  if (action === 'remove-po-item') {
    const list = button.closest('.po-item-list');
    if (list?.children.length > 1) button.closest('[data-po-item]').remove();
    else toast('PO harus memiliki setidaknya satu item.', 'info');
    [...(list?.querySelectorAll('[data-po-item]') || [])].forEach((row, index) => { const label = row.querySelector('.po-item-top strong'); if (label) label.textContent = `Item ${index + 1}`; });
    return;
  }
  if (action === 'calculator-for') {
    preservePoDraft(); state.calculatorTarget = Number(button.dataset.index); state.modal = null; state.tab = 'kalkulator'; render(); return;
  }
  if (action === 'calculator-reset') { state.calculator = { substance: '3', spec: 'BC/F', panjang: '18', lebar: '18', tinggi: '28.5', diskon: '3', margin: '40', showPricelist: state.calculator.showPricelist }; render(); return; }
  if (action === 'toggle-pricelist') { state.calculator.showPricelist = !state.calculator.showPricelist; render(); return; }
  if (action === 'use-price') {
    const index = state.calculatorTarget;
    if (index === null || !state.poDraft) { toast('Harga hasil kalkulasi siap digunakan pada PO.', 'info'); return; }
    state.poDraft.items[index].harga = Number(button.dataset.price) || 0;
    state.calculatorTarget = null; state.tab = 'supplier'; supplierOrderModal(state.poDraft); return;
  }
  if (action === 'export') { exportData(button.dataset.kind); return; }
  if (action === 'open-import') { state.tab = 'impor'; void refreshData(); return; }
  if (action === 'refresh-import') { if (state.importFile) await readImportFile(state.importFile, state.importPreview?.sheetName); return; }
  if (action === 'confirm-import') {
    button.disabled = true;
    try { await runImport(); } catch (error) { toast(friendlyError(error), 'error'); button.disabled = false; }
    return;
  }
  if (action === 'dismiss-toast') { document.querySelector('.toast-stack').innerHTML = ''; }
}

async function readImportFile(file, sheetName) {
  if (!file) return;
  state.importFile = file;
  try {
    state.importPreview = await inspectWorkbook(file, sheetName);
    state.tab = 'impor';
    render();
  } catch (error) {
    state.importPreview = null;
    render();
    toast(friendlyError(error), 'error');
  }
}

function handleInput(event) {
  const target = event.target;
  if (target.matches('[data-filter="search"]')) { setSearch(target); return; }
  if (target.matches('[data-money-input]')) {
    formatMoneyInput(target);
    if (target.matches('[data-po-calc]')) updatePoPreview(target);
    if (target.matches('[data-customer-order-calc]')) updateCustomerOrderPreview(target);
    return;
  }
  if (target.matches('[data-calc]')) {
    const key = target.dataset.calc;
    const position = target.type === 'text' ? target.selectionStart : null;
    state.calculator[key] = target.value;
    render();
    const input = document.querySelector(`[data-calc="${key}"]`);
    if (input) { input.focus(); if (position !== null) input.setSelectionRange(position, position); }
    return;
  }
  if (target.matches('[data-po-calc]')) updatePoPreview(target);
  if (target.matches('[data-customer-order-calc]')) updateCustomerOrderPreview(target);
}

async function handleChange(event) {
  const target = event.target;
  if (target.matches('[data-supplier-bill-select]')) { updateSupplierPaymentSelection(target); return; }
  if (target.matches('[data-filter="reportMonth"]')) {
    state.reportMonth = /^\d{4}-\d{2}$/.test(target.value) ? target.value : localISODate(new Date()).slice(0, 7);
    state.reportIncomeWeek = null;
    render(); return;
  }
  if (target.matches('[data-filter="reportIncomeWeek"]')) {
    if (target.value === 'month') state.reportIncomePlanPeriod = 'month';
    else {
      state.reportIncomePlanPeriod = 'week';
      state.reportIncomeWeek = Number(target.value);
    }
    render(); return;
  }
  if (target.matches('[data-report-category]')) {
    const selected = new Set(state.reportCategories || []);
    target.checked ? selected.add(target.value) : selected.delete(target.value);
    state.reportCategories = [...selected];
    persistReportCategoryPreferences();
    render(); return;
  }
  if (target.matches('[data-filter="month"]')) {
    state.month = target.value;
    if (state.tab === 'logs-input') {
      void refreshData({ tables: [], includeAdmin: true, forceLogs: true, showLoading: false });
    } else render();
    return;
  }
  if (target.matches('[data-filter="incomeWeek"]')) {
    if (target.value === 'month') state.incomePlanPeriod = 'month';
    else {
      state.incomePlanPeriod = 'week';
      state.incomeWeek = Number(target.value);
    }
    render();
    return;
  }
  if (target.matches('[data-filter="cashCategory"]')) { state.category = target.value; render(); return; }
  if (target.matches('[data-filter="invoiceStatus"]')) { state.invoiceStatus = target.value; render(); return; }
  if (target.matches('[data-import-file]')) { await readImportFile(target.files?.[0]); return; }
  if (target.matches('[data-import-sheet]')) { await readImportFile(state.importFile, target.value); return; }
  if (target.matches('[data-calc]')) { state.calculator[target.dataset.calc] = target.value; render(); }
}

async function handleSubmit(event) {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === 'auth') {
    const values = Object.fromEntries(new FormData(form).entries());
    state.authMessage = '';
    state.authMessageType = 'info';
    state.busy = true; render();
    try {
      const result = form.dataset.mode === 'signup'
        ? await supabase.auth.signUp({ email: values.email, password: values.password })
        : await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
      if (result.error) throw result.error;
      if (form.dataset.mode === 'signup' && !result.data.session) {
        state.authMessage = 'Akun dibuat. Buka tautan konfirmasi dari email sebelum masuk.';
        state.authMessageType = 'info';
        toast('Periksa email Anda untuk konfirmasi akun.', 'info');
      } else { state.authMessage = ''; state.authMessageType = 'info'; }
    } catch (error) {
      state.authMessage = friendlyError(error);
      state.authMessageType = 'warn';
    }
    finally { state.busy = false; render(); }
    return;
  }
  if (form.dataset.form === 'workspace-role') {
    const values = Object.fromEntries(new FormData(form).entries());
    state.busy = true;
    render();
    try {
      await setWorkspaceUserRole(values.user_id, values.role);
      [state.profiles, state.inputLogs] = await Promise.all([loadWorkspaceUsers(), loadInputLogs(state.month)]);
      state.profilesLoaded = true;
      state.inputLogsMonth = state.month;
      state.inputLogsLoadedAt = Date.now();
      toast('Akses akun berhasil diperbarui.');
    } catch (error) {
      toast(friendlyError(error), 'error');
    } finally { state.busy = false; render(); }
    return;
  }
  if (form.dataset.form !== 'modal') return;
  if (!validateMoneyInputs(form)) return;
  state.busy = true;
  const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
  try {
    const result = await saveModal(form);
    const action = form.dataset.action;
    if (result?.deleted) removeLocalRow(result.table, result.id);
    else if (tableByAction[action] && result) updateLocalRow(tableByAction[action], result);
    if (['save-invoice', 'mark-invoice-paid'].includes(action) || (result?.deleted && result.table === 'sales_invoices')) {
      state.reportReceivableHistoryLoadedAt = 0;
    }
    state.modal = null;
    state.pendingDelete = null;
    state.inputLogsMonth = '';
    state.busy = false;
    render();
    const successMessage = action === 'confirm-delete' ? 'Data berhasil dihapus.' : action === 'mark-invoice-paid' ? 'Tanggal pelunasan invoice berhasil dicatat.' : form.dataset.id ? 'Data berhasil diperbarui.' : 'Data berhasil disimpan.';
    const successType = action === 'confirm-delete' || action === 'mark-invoice-paid' ? 'success' : form.dataset.id ? 'info' : 'success';
    toast(successMessage, successType);
  } catch (error) {
    state.busy = false;
    toast(friendlyError(error), 'error');
    if (submit) submit.disabled = false;
  } finally { state.busy = false; }
}

app.addEventListener('click', handleClick);
app.addEventListener('input', handleInput);
app.addEventListener('change', handleChange);
app.addEventListener('submit', handleSubmit);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.profile?.workspace_id) void refreshData({ showLoading: false });
});

async function activateSession(session) {
  const previousUserId = state.session?.user?.id;
  const nextUserId = session?.user?.id;
  if (previousUserId !== nextUserId) {
    dataLoadGeneration += 1;
    activeDataLoads = 0;
    state.loadedTables.clear();
    state.tableLoadedAt.clear();
    state.data = emptyData();
    state.inputLogs = [];
    state.inputLogsMonth = '';
    state.inputLogsLoadedAt = 0;
    state.profiles = [];
    state.profilesLoaded = false;
    state.reportReceivableHistory = null;
    state.reportReceivableHistoryLoadedAt = 0;
    state.reportCategoryStorageKey = '';
    state.reportCategories = null;
    state.reportCategoryKnownCategories = [];
  }
  const requestId = ++authHydration;
  state.session = session;
  state.modal = null;
  state.profileError = '';
  state.loading = false;
  state.loadError = '';
  if (!session) {
    state.profile = null;
    state.profileLoading = false;
    state.loading = false;
    state.loadError = '';
    state.data = emptyData();
    state.inputLogs = [];
    state.profiles = [];
    setWorkspaceId(null);
    render();
    return;
  }

  state.profile = null;
  state.profileLoading = true;
  setWorkspaceId(null);
  render();
  try {
    const profile = await loadProfile(session.user.id);
    if (requestId !== authHydration || state.session?.user?.id !== session.user.id) return;
    state.profile = profile;
    state.profileLoading = false;
    setWorkspaceId(profile.workspace_id);
    if (!profile.workspace_id) { render(); return; }
    if (profile.role === 'staff' && state.tab === 'logs-input') state.tab = 'produksi';
    await refreshData();
  } catch (error) {
    if (requestId !== authHydration || state.session?.user?.id !== session.user.id) return;
    state.profileLoading = false;
    state.loading = false;
    state.profileError = friendlyError(error);
    render();
  }
}

if (isConfigured) {
  let receivedAuthEvent = false;
  supabase.auth.onAuthStateChange((_event, session) => {
    receivedAuthEvent = true;
    if (session && state.session?.user?.id === session.user.id && (state.profileLoading || state.profile)) {
      state.session = session;
      return;
    }
    void activateSession(session);
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (receivedAuthEvent) return;
    if (error) {
      state.authMessage = friendlyError(error);
      state.authMessageType = 'warn';
      render();
      return;
    }
    void activateSession(data.session);
  }).catch((error) => {
    state.authMessage = friendlyError(error);
    state.authMessageType = 'warn';
    render();
  });
}

render();

