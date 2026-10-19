import {
  CASH_CATEGORIES, customerOrderFinancials, downloadCsv, escapeHtml as esc, icon, integer,
  monthName, rupiah,
} from './helpers.js';

const normalizeCategory = (value) => String(value ?? '').trim() || 'Tanpa kategori';
const amountOf = (value) => Number(value) || 0;
const unique = (values) => [...new Set(values)];
const numericCell = (value) => ({ __csvNumeric: true, value: Number(value) || 0 });
const palette = ['#315f91', '#a6473f', '#37805d', '#9b6d24', '#76529b', '#287c83', '#c25a2a', '#586878', '#a04772', '#698d35'];

export function reportCategoryOptions(data) {
  return unique([
    ...CASH_CATEGORIES,
    ...(data.cashflow_transactions || []).map((row) => normalizeCategory(row.category)),
  ]);
}

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(period, delta) {
  const [year, month] = period.split('-').map(Number);
  const value = new Date(year, month - 1 + delta, 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function dateRange(period) {
  const [year, month] = period.split('-').map(Number);
  const nextMonth = new Date(year, month, 1);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(lastDay).padStart(2, '0')}`,
    nextStart: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`,
  };
}

function inPeriod(date, period) {
  return String(date || '').slice(0, 7) === period;
}

function invoiceOutstanding(invoice) {
  return Math.max(amountOf(invoice.outstanding_amount ?? (amountOf(invoice.amount) - amountOf(invoice.paid_amount))), 0);
}

function sum(rows, getter) {
  return rows.reduce((total, row) => total + getter(row), 0);
}

function cashflowTotals(rows) {
  const cashIn = sum(rows.filter((row) => row.kind === 'credit'), (row) => amountOf(row.amount));
  const cashOut = sum(rows.filter((row) => row.kind === 'debit'), (row) => amountOf(row.amount));
  return { cashIn, cashOut, net: cashIn - cashOut };
}

function formatCompactMoney(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function buildReceivablePeriod(period, history, invoices, today) {
  const { start, end } = dateRange(period);
  const nowMonth = today.slice(0, 7);
  const invoiceRows = invoices.filter((row) => inPeriod(row.invoice_date, period));
  const invoiceCount = invoiceRows.length;
  const invoiceValue = sum(invoiceRows, (row) => amountOf(row.amount));
  const baseline = history.baselines?.[0];
  if (!history.available) return { status: 'migration-missing', start, end, invoiceCount, invoiceValue };
  if (!baseline) return { status: 'baseline-missing', start, end, invoiceCount, invoiceValue };

  const baselineDate = String(baseline.captured_at || '').slice(0, 10);
  const baselineMonth = baselineDate.slice(0, 7);
  if (period < baselineMonth) return { status: 'unavailable', start, end, baselineDate, invoiceCount, invoiceValue };
  if (period === baselineMonth) return { status: 'incomplete', start, end, baselineDate, invoiceCount, invoiceValue };
  if (period > nowMonth) return { status: 'future', start, end, baselineDate, invoiceCount, invoiceValue };

  const isOpen = period === nowMonth;
  const asOf = isOpen && today < end ? today : end;
  const periodEvents = (history.events || []).filter((row) =>
    row.event_date && row.event_date >= start && row.event_date <= asOf,
  );
  const unknownEvents = (history.events || []).filter((row) => !row.event_date);
  const allTrackedEvents = (history.events || []).filter((row) => row.created_at && baseline.captured_at && row.created_at > baseline.captured_at);
  const startBalance = amountOf(baseline.opening_balance) + sum(
    allTrackedEvents.filter((row) => row.event_date && row.event_date < start),
    (row) => amountOf(row.balance_delta),
  );
  const hasUnknownHistory = unknownEvents.some((row) => row.created_at && row.created_at > baseline.captured_at);
  const complete = !hasUnknownHistory;
  const endBalance = complete
    ? amountOf(baseline.opening_balance) + sum(
      allTrackedEvents.filter((row) => row.event_date && row.event_date <= asOf),
      (row) => amountOf(row.balance_delta),
    )
    : null;
  const periodPayments = sum(
    periodEvents.filter((row) => row.event_type === 'payment' && amountOf(row.balance_delta) < 0),
    (row) => -amountOf(row.balance_delta),
  );
  const adjustments = sum(
    periodEvents.filter((row) => row.event_type === 'adjustment'),
    (row) => amountOf(row.balance_delta),
  );
  return {
    status: !complete ? 'incomplete' : isOpen ? 'open' : 'complete',
    baselineDate,
    start,
    end,
    asOf,
    openingBalance: startBalance,
    invoiceCount,
    invoiceValue,
    payments: periodPayments,
    adjustments,
    endingBalance: endBalance,
    events: periodEvents,
    previousMonth: shiftMonth(period, -1),
  };
}

export function buildReport(data, state) {
  const period = /^\d{4}-\d{2}$/.test(state.reportMonth || '') ? state.reportMonth : currentMonth();
  const categories = unique([...reportCategoryOptions(data), ...(state.reportCategoryKnownCategories || [])]);
  const selected = new Set(state.reportCategories ?? categories);
  const selectedRows = (data.cashflow_transactions || []).filter((row) => selected.has(normalizeCategory(row.category)));
  const periodCashflow = selectedRows.filter((row) => inPeriod(row.transaction_date, period));
  const cashflow = cashflowTotals(periodCashflow);
  const invoices = data.sales_invoices || [];
  const periodInvoices = invoices.filter((row) => inPeriod(row.invoice_date, period));
  const dueInvoices = invoices.filter((row) => inPeriod(row.due_date, period));
  const invoiceValue = sum(periodInvoices, (row) => amountOf(row.amount));
  const duePlan = sum(dueInvoices, invoiceOutstanding);
  const customerOrders = (data.customer_orders || []).filter((row) => inPeriod(row.order_date, period));
  const customerOrderValue = sum(customerOrders, (row) => customerOrderFinancials(row).totalPrice);
  const poNumbers = unique(customerOrders.map((row) => String(row.po_number || '').trim()).filter(Boolean));
  const selectedLabels = categories.filter((category) => selected.has(category));
  const trend = Array.from({ length: 6 }, (_, index) => {
    const month = shiftMonth(period, index - 5);
    return { month, ...cashflowTotals(selectedRows.filter((row) => inPeriod(row.transaction_date, month))) };
  });
  const expensesByCategory = new Map();
  periodCashflow.filter((row) => row.kind === 'debit').forEach((row) => {
    const category = normalizeCategory(row.category);
    expensesByCategory.set(category, (expensesByCategory.get(category) || 0) + amountOf(row.amount));
  });
  const expenses = [...expensesByCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'id'));
  const expenseTotal = sum(expenses, (row) => row.amount);
  let displayedPercent = 0;
  expenses.forEach((row, index) => {
    row.percent = index === expenses.length - 1
      ? 100 - displayedPercent
      : Math.round((row.amount / expenseTotal) * 1000) / 10;
    displayedPercent += row.percent;
  });
  const supplierEntries = data.supplier_ledger_entries || [];
  const supplierRows = supplierEntries.filter((row) => inPeriod(row.entry_date, period));
  const supplierBills = sum(supplierRows.filter((row) => row.entry_type === 'bill'), (row) => amountOf(row.amount));
  const supplierPayments = sum(supplierRows.filter((row) => row.entry_type === 'payment'), (row) => amountOf(row.amount));
  const supplierOpening = sum(supplierEntries.filter((row) => String(row.entry_date || '') < dateRange(period).start),
    (row) => (row.entry_type === 'bill' ? 1 : -1) * amountOf(row.amount));
  const receivable = buildReceivablePeriod(period, state.reportReceivableHistory || { available: false }, invoices, currentISODate());
  const previousReceivable = receivable.status === 'complete' || receivable.status === 'open'
    ? buildReceivablePeriod(receivable.previousMonth, state.reportReceivableHistory || { available: false }, invoices, currentISODate())
    : null;

  return {
    period,
    periodName: monthName(period),
    categories,
    selectedCategories: selectedLabels,
    selectedRows,
    periodCashflow,
    cashflow,
    trend,
    expenses,
    expenseTotal,
    invoices: periodInvoices,
    allInvoices: invoices,
    invoiceValue,
    dueInvoices,
    duePlan,
    customerOrders,
    customerOrderValue,
    uniqueCustomerPoCount: poNumbers.length,
    supplierEntries,
    supplierRows,
    supplierBills,
    supplierPayments,
    supplierOpening,
    supplierEnding: supplierOpening + supplierBills - supplierPayments,
    receivable,
    previousReceivable,
  };
}

function currentISODate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function chartMonthLabel(period) {
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { month: 'short', year: '2-digit' }).format(new Date(year, month - 1, 1));
}

function renderLineChart(trend, periodName) {
  const values = trend.flatMap((row) => [row.cashIn, row.cashOut, row.net]);
  if (!values.some((value) => value !== 0)) {
    return `<div class="report-chart-empty">Tidak ada transaksi kas pada enam bulan tren untuk kategori yang dipilih.</div>`;
  }
  const width = 800;
  const height = 310;
  const left = 88;
  const right = 20;
  const top = 22;
  const bottom = 54;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const padding = (maxValue - minValue || 1) * .1;
  const min = minValue - padding;
  const max = maxValue + padding;
  const y = (value) => top + ((max - value) / (max - min)) * plotHeight;
  const x = (index) => left + (trend.length === 1 ? plotWidth / 2 : (index * plotWidth) / (trend.length - 1));
  const series = [
    ['cashIn', 'Kas masuk', '#315f91'],
    ['cashOut', 'Kas keluar', '#a6473f'],
    ['net', 'Arus kas bersih', '#37805d'],
  ];
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = max - ((max - min) * index) / 4;
    const lineY = y(value);
    return `<line x1="${left}" y1="${lineY}" x2="${width - right}" y2="${lineY}" class="report-chart-grid"/><text x="${left - 9}" y="${lineY + 4}" text-anchor="end" class="report-axis-label">${esc(formatCompactMoney(value))}</text>`;
  }).join('');
  const lines = series.map(([key, label, color]) => {
    const points = trend.map((row, index) => `${x(index)},${y(row[key])}`).join(' ');
    const circles = trend.map((row, index) => `<circle cx="${x(index)}" cy="${y(row[key])}" r="4" fill="${color}" class="report-chart-point"><title>${esc(monthName(row.month))} · ${esc(label)}: ${esc(rupiah(row[key]))}</title></circle>`).join('');
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${circles}`;
  }).join('');
  const labels = trend.map((row, index) => `<text x="${x(index)}" y="${height - 20}" text-anchor="middle" class="report-axis-label">${esc(chartMonthLabel(row.month))}</text>`).join('');
  const legend = series.map(([, label, color]) => `<span class="report-legend-item"><i style="--legend-color:${color}"></i>${esc(label)}</span>`).join('');
  return `<div class="report-chart-scroll"><svg class="report-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tren kas masuk, kas keluar, dan arus kas bersih untuk enam bulan hingga ${esc(periodName)}">${grid}<line x1="${left}" y1="${y(0)}" x2="${width - right}" y2="${y(0)}" class="report-chart-zero"/>${lines}${labels}</svg></div><div class="report-legend">${legend}</div>`;
}

function piePath(startAngle, endAngle, radius = 86) {
  const center = 100;
  const point = (angle) => ({ x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) });
  const start = point(startAngle);
  const end = point(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function renderExpenseChart(expenses, total, periodName) {
  if (!total) return `<div class="report-chart-empty">Tidak ada transaksi debit pada ${esc(periodName)} untuk kategori yang dipilih.</div>`;
  let angle = -Math.PI / 2;
  const slices = expenses.map((row, index) => {
    const start = angle;
    angle += (row.amount / total) * Math.PI * 2;
    const color = palette[index % palette.length];
    const percent = row.percent;
    const shape = expenses.length === 1
      ? `<circle cx="100" cy="100" r="86" fill="${color}"/>`
      : `<path d="${piePath(start, angle)}" fill="${color}"/>`;
    return { ...row, color, percent, shape: `${shape}<title>${esc(row.category)}: ${esc(rupiah(row.amount))} · ${percent.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% dari pengeluaran terpilih</title>` };
  });
  const svg = `<svg class="report-donut" viewBox="0 0 200 200" role="img" aria-label="Komposisi pengeluaran kas per kategori pada ${esc(periodName)}">${slices.map((row, index) => `<g class="report-donut-slice" tabindex="0" style="--slice-color:${row.color}">${row.shape}</g>`).join('')}<circle cx="100" cy="100" r="52" fill="var(--paper)"/><text x="100" y="95" text-anchor="middle" class="report-donut-total">${esc(formatCompactMoney(total))}</text><text x="100" y="116" text-anchor="middle" class="report-donut-label">Pengeluaran</text></svg>`;
  const legend = slices.map((row) => `<li><i style="--legend-color:${row.color}"></i><span>${esc(row.category)}</span><strong>${esc(rupiah(row.amount))}</strong><small>${row.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</small></li>`).join('');
  const table = `<div class="table-wrap"><table><thead><tr><th>Kategori</th><th class="numeric">Pengeluaran</th><th class="numeric">Persentase</th></tr></thead><tbody>${slices.map((row) => `<tr><td>${esc(row.category)}</td><td class="numeric">${esc(rupiah(row.amount))}</td><td class="numeric">${row.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</td></tr>`).join('')}<tr class="report-total-row"><th>Total pengeluaran terpilih</th><th class="numeric">${esc(rupiah(total))}</th><th class="numeric">100%</th></tr></tbody></table></div>`;
  return `<div class="report-donut-layout">${svg}<ul class="report-donut-legend">${legend}</ul></div>${table}`;
}

function receivableStatusText(receivable) {
  const date = receivable.baselineDate ? ` Baseline saldo dibuat ${receivable.baselineDate}.` : '';
  if (receivable.status === 'migration-missing') return 'Riwayat piutang belum tersedia. Jalankan migration customer receivable history untuk mulai mencatat baseline dan perubahan pembayaran.';
  if (receivable.status === 'baseline-missing') return 'Baseline saldo piutang untuk workspace ini belum tersedia; saldo historis tidak dihitung.';
  if (receivable.status === 'unavailable') return `Data historis belum tersedia untuk periode ini.${date}`;
  if (receivable.status === 'incomplete') return `Data historis belum lengkap untuk periode ini; saldo awal dan akhir tidak ditampilkan sebagai hasil pasti.${date}`;
  if (receivable.status === 'future') return 'Periode belum berlangsung; saldo piutang akhir periode belum tersedia.';
  if (receivable.status === 'open') return `Periode berjalan. Perubahan dan saldo piutang dihitung sampai ${receivable.asOf}; saldo akhir bulan belum tersedia.`;
  return 'Saldo historis dihitung dari baseline migration, invoice baru, pembayaran tercatat, dan koreksi yang dicatat setelah baseline.';
}

function receivablePanel(report) {
  const valueOrDash = (value) => value == null ? '—' : rupiah(value);
  const r = report.receivable;
  const rows = [
    ['Saldo awal periode', r.status === 'complete' || r.status === 'open' ? valueOrDash(r.openingBalance) : '—'],
    [`Invoice baru pada ${report.periodName}`, r.invoiceValue == null ? '—' : valueOrDash(r.invoiceValue)],
    ['Pembayaran customer tercatat', r.status === 'complete' || r.status === 'open' ? valueOrDash(r.payments) : '—'],
    ['Penyesuaian / pembatalan tercatat', r.status === 'complete' || r.status === 'open' ? valueOrDash(r.adjustments) : '—'],
  ];
  if (r.status === 'complete' || r.status === 'open') {
    rows.push([r.status === 'open' ? `Saldo berjalan per ${r.asOf}` : 'Saldo akhir periode', valueOrDash(r.endingBalance)]);
  } else rows.push(['Saldo akhir periode', '—']);

  const previous = report.previousReceivable;
  let comparison = '';
  if (previous?.status === 'complete' && r.endingBalance != null) {
    const change = r.endingBalance - previous.endingBalance;
    const percent = previous.endingBalance === 0 ? '—' : `${(change / Math.abs(previous.endingBalance) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
    comparison = `<p class="report-comparison">Saldo akhir ${esc(monthName(r.previousMonth))}: <strong>${esc(rupiah(previous.endingBalance))}</strong>. Perubahan sampai periode laporan: <strong>${esc(rupiah(change))}</strong> (${esc(percent)}). Persentase tidak dihitung bila saldo bulan sebelumnya Rp 0.</p>`;
  } else if (r.status === 'complete' && r.endingBalance != null) {
    comparison = `<p class="report-comparison">Saldo akhir bulan sebelumnya dan perubahannya belum dapat dibandingkan karena periode pembanding belum lengkap.</p>`;
  }
  const table = `<div class="table-wrap"><table><thead><tr><th>Komponen piutang customer</th><th class="numeric">Nilai</th></tr></thead><tbody>${rows.map(([label, value]) => `<tr><td>${esc(label)}</td><td class="numeric">${esc(value)}</td></tr>`).join('')}</tbody></table></div>`;
  const invoiceNumbers = new Map(report.allInvoices.map((invoice) => [invoice.id, invoice.invoice_number]));
  const eventRows = (r.events || []).map((event) => {
    const type = event.event_type === 'invoice' ? 'Invoice baru'
      : event.event_type === 'payment' ? 'Pembayaran customer' : 'Penyesuaian saldo';
    return `<tr><td>${esc(event.event_date || 'Tanggal belum tersedia')}</td><td class="mono">${esc(invoiceNumbers.get(event.invoice_id) || event.invoice_id)}</td><td>${type}</td><td class="numeric">${esc(rupiah(event.balance_delta))}</td></tr>`;
  }).join('');
  const eventDetail = eventRows
    ? `<details class="report-history-details"><summary>Rincian invoice dan perubahan saldo (${integer(r.events.length)})</summary><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Invoice</th><th>Jenis perubahan</th><th class="numeric">Delta saldo</th></tr></thead><tbody>${eventRows}</tbody></table></div><p class="report-source-note">Delta positif menambah piutang; delta negatif mengurangi piutang. Pembayaran tampil sebagai delta negatif.</p></details>`
    : '';
  return `<section class="panel report-section" aria-labelledby="report-receivables-title"><div class="panel-heading"><div><p class="eyebrow">PIUTANG CUSTOMER</p><h2 id="report-receivables-title">Perubahan saldo piutang</h2><p>Saldo historis hanya dihitung jika baseline dan catatan perubahan setelahnya tersedia.</p></div></div><div class="notice ${r.status === 'complete' || r.status === 'open' ? 'notice-info' : 'notice-warn'} report-data-status"><span>${esc(receivableStatusText(r))}</span></div>${table}${comparison}${eventDetail}</section>`;
}

function reportCSV(report, state) {
  const invoiceNumbers = new Map(report.allInvoices.map((invoice) => [invoice.id, invoice.invoice_number]));
  const rows = [
    ['Laporan performa perusahaan', report.periodName],
    ['Kategori cashflow terpilih', report.selectedCategories.length ? report.selectedCategories.join(', ') : 'Tidak ada kategori'],
    ['Definisi cashflow', 'Hanya cashflow_transactions berdasarkan transaction_date dan kind; kategori terpilih sama untuk semua angka cashflow.'],
    ['Bagian', 'Metrik', 'Nilai', 'Keterangan'],
    ['Invoice customer', `Jumlah invoice pada periode ${report.periodName}`, numericCell(report.invoices.length), 'Berdasarkan invoice_date.'],
    ['Invoice customer', 'Nilai invoice/tagihan terbit', numericCell(report.invoiceValue), 'Bukan kas yang sudah diterima.'],
    ['Penagihan', 'Rencana penagihan', numericCell(report.duePlan), 'Sisa outstanding saat ini dari invoice dengan due_date pada periode; bukan pemasukan aktual atau jaminan pembayaran.'],
    ['PO Customer', 'Nomor PO unik', numericCell(report.uniqueCustomerPoCount), 'Nomor unik pada baris PO dengan order_date dalam periode.'],
    ['PO Customer', 'Baris item', numericCell(report.customerOrders.length), 'Jumlah baris customer_orders pada periode.'],
    ['PO Customer', 'Total Price', numericCell(report.customerOrderValue), 'Jumlah customerOrderFinancials(row).totalPrice; bukan invoice, kas masuk, atau laba.'],
    ['Cashflow aktual', 'Kas masuk', numericCell(report.cashflow.cashIn), 'Jumlah kind=credit.'],
    ['Cashflow aktual', 'Kas keluar', numericCell(report.cashflow.cashOut), 'Jumlah kind=debit.'],
    ['Cashflow aktual', 'Arus kas bersih', numericCell(report.cashflow.net), 'Kas masuk dikurangi kas keluar.'],
  ];
  const r = report.receivable;
  rows.push(['Piutang customer', 'Status historis', receivableStatusText(r), 'Riwayat sebelum migration tidak diisi mundur.']);
  if (r.status === 'complete' || r.status === 'open') {
    rows.push(['Piutang customer', 'Saldo awal periode', numericCell(r.openingBalance), 'Saldo awal ditambah invoice baru, dikurangi pembayaran, ditambah penyesuaian sama dengan saldo berjalan/akhir.']);
    rows.push(['Piutang customer', 'Invoice baru', numericCell(r.invoiceValue), 'Berdasarkan invoice_date pada periode.']);
    rows.push(['Piutang customer', 'Pembayaran tercatat', numericCell(r.payments), 'Jumlah event payment bertanggal pada periode.']);
    rows.push(['Piutang customer', 'Penyesuaian / pembatalan', numericCell(r.adjustments), 'Delta saldo invoice yang bukan pembayaran.']);
    rows.push(['Piutang customer', r.status === 'open' ? `Saldo berjalan per ${r.asOf}` : 'Saldo akhir periode', numericCell(r.endingBalance), 'Dihitung dari baseline migration dan event saldo bertanggal.']);
    rows.push(['Piutang customer', 'Detail invoice dan perubahan saldo', '', 'Tanggal, nomor invoice, jenis perubahan, dan signed delta saldo tercantum pada baris berikutnya.']);
    rows.push(...(r.events || []).map((event) => [
      'Riwayat piutang', `${event.event_date} · ${invoiceNumbers.get(event.invoice_id) || event.invoice_id} · ${event.event_type}`,
      numericCell(event.balance_delta), 'Delta saldo bertanda: positif menambah piutang dan negatif mengurangi piutang.',
    ]));
  }
  if (report.supplierEntries.length) {
    rows.push(['Utang supplier', 'Saldo awal periode', numericCell(report.supplierOpening), 'Berdasarkan supplier_ledger_entries sebelum periode.']);
    rows.push(['Utang supplier', 'Tagihan baru', numericCell(report.supplierBills), 'entry_type=bill dalam periode.']);
    rows.push(['Utang supplier', 'Pembayaran supplier', numericCell(report.supplierPayments), 'entry_type=payment dalam periode.']);
    rows.push(['Utang supplier', 'Saldo utang akhir periode', numericCell(report.supplierEnding), 'Saldo awal + tagihan baru - pembayaran. Tidak ada pemeriksaan keterlambatan.']);
  }
  rows.push(['Tren cashflow', 'Periode', 'Kas masuk', 'Kas keluar', 'Arus kas bersih']);
  report.trend.forEach((row) => rows.push(['Tren cashflow', monthName(row.month), numericCell(row.cashIn), numericCell(row.cashOut), numericCell(row.net)]));
  rows.push(['Pengeluaran per kategori', 'Kategori', 'Nilai', 'Persentase dari total pengeluaran terpilih']);
  report.expenses.forEach((row) => rows.push(['Pengeluaran per kategori', row.category, numericCell(row.amount), `${row.percent.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`]));
  return rows;
}

export function downloadReportCsv(data, state) {
  const report = buildReport(data, state);
  const safePeriod = report.period.replace(/[^\d-]/g, '');
  downloadCsv(`laporan-${safePeriod}.csv`, reportCSV(report, state));
}

export function renderReport(data, state) {
  const report = buildReport(data, state);
  const categorySummary = report.selectedCategories.length
    ? report.selectedCategories.join(', ')
    : 'Tidak ada kategori dipilih';
  const preferenceNotice = state.reportCategoryPreferenceError
    ? `<p class="report-filter-note">Pilihan kategori tidak dapat disimpan pada perangkat ini.</p>`
    : '';
  const categoryControls = report.categories.map((category) => `<label class="report-category-option"><input type="checkbox" data-report-category value="${esc(category)}" ${report.selectedCategories.includes(category) ? 'checked' : ''}><span>${esc(category)}</span></label>`).join('');
  const r = report.receivable;
  const receivableSummary = r.status === 'complete' || r.status === 'open'
    ? ` Piutang customer: ${r.status === 'open' ? `saldo berjalan ${rupiah(r.endingBalance)} per ${r.asOf}` : `saldo akhir periode ${rupiah(r.endingBalance)}`}.`
    : ` Status piutang customer: ${receivableStatusText(r)}`;
  const executiveSummary = `Pada periode ${report.periodName}, tercatat ${integer(report.invoices.length)} invoice customer terbit senilai ${rupiah(report.invoiceValue)}. PO Customer berjumlah ${integer(report.uniqueCustomerPoCount)} nomor unik dan ${integer(report.customerOrders.length)} baris dengan Total Price ${rupiah(report.customerOrderValue)}. Rencana penagihan berdasarkan jatuh tempo adalah ${rupiah(report.duePlan)}. Cashflow aktual kategori terpilih: kas masuk ${rupiah(report.cashflow.cashIn)}, kas keluar ${rupiah(report.cashflow.cashOut)}, dan arus kas bersih ${rupiah(report.cashflow.net)}.${receivableSummary}`;
  const metrics = [
    ['Invoice customer', `${integer(report.invoices.length)} invoice pada periode ${report.periodName}`, rupiah(report.invoiceValue), 'Nilai invoice/tagihan terbit berdasarkan invoice_date; bukan kas diterima.'],
    ['Rencana uang masuk', rupiah(report.duePlan), `${integer(report.dueInvoices.length)} invoice jatuh tempo pada ${report.periodName}`, 'Sisa outstanding saat ini berdasarkan due_date; estimasi penagihan, bukan pemasukan aktual atau jaminan pembayaran.'],
    ['PO Customer', `${integer(report.uniqueCustomerPoCount)} nomor PO unik · ${integer(report.customerOrders.length)} baris item`, rupiah(report.customerOrderValue), 'Jumlah Total Price per baris PO berdasarkan order_date; bukan invoice, kas masuk, atau laba.'],
  ];
  const metricTable = `<div class="table-wrap"><table><thead><tr><th>Metrik</th><th>Jumlah</th><th class="numeric">Nilai</th><th>Definisi</th></tr></thead><tbody>${metrics.map(([label, count, value, note]) => `<tr><th>${esc(label)}</th><td>${esc(count)}</td><td class="numeric">${esc(value)}</td><td>${esc(note)}</td></tr>`).join('')}</tbody></table></div>`;
  const cashflowRows = [
    ['Uang masuk', report.cashflow.cashIn, 'Jumlah kind=credit pada periode dan kategori terpilih.'],
    ['Uang keluar', report.cashflow.cashOut, 'Jumlah kind=debit pada periode dan kategori terpilih.'],
    ['Arus kas bersih', report.cashflow.net, 'Uang masuk dikurangi uang keluar.'],
  ];
  const cashflowTable = `<div class="table-wrap"><table><thead><tr><th>Cashflow aktual</th><th class="numeric">Nilai</th><th>Definisi</th></tr></thead><tbody>${cashflowRows.map(([label, value, note]) => `<tr><th>${esc(label)}</th><td class="numeric">${esc(rupiah(value))}</td><td>${esc(note)}</td></tr>`).join('')}</tbody></table></div>`;
  const trendTable = `<div class="table-wrap"><table><thead><tr><th>Periode</th><th class="numeric">Kas masuk</th><th class="numeric">Kas keluar</th><th class="numeric">Arus kas bersih</th></tr></thead><tbody>${report.trend.map((row) => `<tr><th>${esc(monthName(row.month))}</th><td class="numeric">${esc(rupiah(row.cashIn))}</td><td class="numeric">${esc(rupiah(row.cashOut))}</td><td class="numeric">${esc(rupiah(row.net))}</td></tr>`).join('')}</tbody></table></div>`;
  const supplierSection = report.supplierEntries.length
    ? `<section class="panel report-section" aria-labelledby="report-supplier-title"><div class="panel-heading"><div><p class="eyebrow">CATATAN SUPPLIER</p><h2 id="report-supplier-title">Utang supplier</h2><p>Nilai mengikuti supplier_ledger_entries; tidak ada tanggal jatuh tempo yang dapat dipakai untuk menilai keterlambatan.</p></div></div><div class="table-wrap"><table><thead><tr><th>Komponen</th><th class="numeric">Nilai</th><th>Keterangan</th></tr></thead><tbody><tr><th>Saldo awal periode</th><td class="numeric">${esc(rupiah(report.supplierOpening))}</td><td>Ledger sebelum periode.</td></tr><tr><th>Tagihan baru</th><td class="numeric">${esc(rupiah(report.supplierBills))}</td><td>entry_type=bill.</td></tr><tr><th>Pembayaran supplier</th><td class="numeric">${esc(rupiah(report.supplierPayments))}</td><td>entry_type=payment.</td></tr><tr class="report-total-row"><th>Saldo utang supplier</th><td class="numeric">${esc(rupiah(report.supplierEnding))}</td><td>Saldo awal + tagihan baru - pembayaran.</td></tr></tbody></table></div></section>`
    : `<p class="report-source-note">Belum ada catatan supplier pada supplier_ledger_entries; utang supplier tidak dihitung.</p>`;
  const cashTrend = renderLineChart(report.trend, report.periodName);
  const expenseChart = renderExpenseChart(report.expenses, report.expenseTotal, report.periodName);
  const cashflowStateNote = report.selectedCategories.length
    ? `Angka cashflow, tren, ringkasan teks, dan ekspor memakai kategori: ${categorySummary}.`
    : 'Tidak ada kategori dipilih, sehingga nilai cashflow laporan bernilai Rp 0.';

  return `<main class="report-page">
    <section class="page-heading report-heading"><div class="print-brand"><img src="/brand-logo.png" alt=""><span><strong>CV SURYA PRATAMA MANDIRI</strong><small>Laporan perusahaan</small></span></div><div><p class="eyebrow">LAPORAN PERFORMA PERUSAHAAN</p><h1>Laporan</h1><p>Periode ${esc(report.periodName)} · ${esc(cashflowStateNote)}</p></div><div class="heading-actions report-actions"><button class="button secondary" type="button" data-act="export-report">${icon('download', 16)}<span>Ekspor CSV</span></button><button class="button primary" type="button" data-act="print-report">${icon('file', 16)}<span>Cetak / simpan PDF</span></button></div></section>
    <section class="panel report-filters" aria-labelledby="report-filters-title"><div class="report-filter-top"><div><p class="eyebrow">FILTER LAPORAN</p><h2 id="report-filters-title">Periode dan kategori cashflow</h2></div><label class="month-control report-month"><span>Periode</span><input type="month" data-filter="reportMonth" value="${esc(report.period)}" aria-label="Periode laporan"></label></div>
      <p class="report-filter-note">Pilihan kategori hanya memfilter angka cashflow laporan; angka invoice, piutang, dan PO Customer tidak terpengaruh.</p>
      <div class="report-category-header"><strong>${integer(report.selectedCategories.length)} dari ${integer(report.categories.length)} kategori dipilih</strong><div><button class="text-button" type="button" data-act="report-select-all">Pilih semua</button><button class="text-button" type="button" data-act="report-reset-categories">Reset</button></div></div>
      <div class="report-category-grid">${categoryControls || '<span class="report-filter-note">Belum ada kategori cashflow.</span>'}</div><p class="report-filter-note"><strong>Kategori yang dipakai:</strong> ${esc(categorySummary)}</p>${preferenceNotice}
    </section>
    <section class="panel report-section" aria-labelledby="report-executive-title"><div class="panel-heading"><div><p class="eyebrow">RINGKASAN UNTUK ATASAN · ${esc(report.periodName)}</p><h2 id="report-executive-title">Angka periode</h2></div></div><p class="report-executive-summary">${esc(executiveSummary)}</p>${metricTable}<div class="panel-divider"></div>${cashflowTable}<p class="report-source-note">Definisi: invoice terbit dijumlahkan dari amount berdasarkan invoice_date; rencana penagihan memakai outstanding saat ini pada invoice dengan due_date dalam periode; kas masuk/keluar memakai kind transaksi dan kategori terpilih.</p></section>
    <section class="panel report-section" aria-labelledby="report-trend-title"><div class="panel-heading"><div><p class="eyebrow">CASHFLOW AKTUAL</p><h2 id="report-trend-title">Tren enam bulan</h2><p>Kategori yang sama diterapkan pada seluruh bulan. Kas keluar ditampilkan sebagai nilai debit; arus bersih = masuk − keluar.</p></div></div>${cashTrend}${trendTable}</section>
    <section class="panel report-section" aria-labelledby="report-expenses-title"><div class="panel-heading"><div><p class="eyebrow">CASHFLOW AKTUAL · ${esc(report.periodName)}</p><h2 id="report-expenses-title">Komposisi pengeluaran kas</h2><p>Hanya transaksi kind=debit. Persentase dihitung dari total pengeluaran dengan kategori terpilih.</p></div></div>${expenseChart}</section>
    ${receivablePanel(report)}
    ${supplierSection}
    <p class="report-source-note report-source-footer">Sumber: cashflow_transactions, sales_invoices, customer_orders, supplier_ledger_entries, dan riwayat piutang sesuai status data di atas. Seluruh baris yang terlihat oleh RLS workspace diambil dengan pagination; aplikasi tidak dapat memastikan apakah seluruh transaksi sumber telah dicatat. Data historis invoice sebelum tanggal baseline migration tidak dibuat ulang.</p>
  </main>`;
}
