import {
  CASH_CATEGORIES, customerOrderFinancials, downloadCsv, escapeHtml as esc, formatDate, icon, integer,
  monthName, rupiah,
} from './helpers.js';

const normalizeCategory = (value) => String(value ?? '').trim() || 'Tanpa kategori';
const amountOf = (value) => Number(value) || 0;
const unique = (values) => [...new Set(values)];
const numericCell = (value) => ({ __csvNumeric: true, value: Number(value) || 0 });
const palette = ['#315f91', '#a6473f', '#37805d', '#9b6d24', '#76529b', '#287c83', '#c25a2a', '#586878', '#a04772', '#698d35'];
const NEW_SUPPLIER_START = '2026-10-01';

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

function reportCalendarWeeks(period) {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || month < 1 || month > 12) return [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstDayOffset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const weeks = [];
  let startDay = 1;
  let endDay = 7 - firstDayOffset;
  while (startDay <= daysInMonth) {
    const lastDay = Math.min(endDay, daysInMonth);
    weeks.push({
      number: weeks.length + 1,
      startDate: `${period}-${String(startDay).padStart(2, '0')}`,
      endDate: `${period}-${String(lastDay).padStart(2, '0')}`,
      startDay,
      endDay: lastDay,
      rows: [],
      amount: 0,
    });
    startDay = lastDay + 1;
    endDay += 7;
  }
  return weeks;
}

function reportPlanView(report, state) {
  const weeks = reportCalendarWeeks(report.period);
  const groups = new Map();
  report.dueInvoices.forEach((invoice) => {
    const date = String(invoice.due_date || '').slice(0, 10);
    const day = Number(date.slice(8, 10));
    const weekIndex = weeks.findIndex((week) => day >= week.startDay && day <= week.endDay);
    if (weekIndex < 0) return;
    const customer = String(invoice.customer || 'Customer belum dicatat').trim() || 'Customer belum dicatat';
    const key = `${weekIndex}::${date}::${customer.toLocaleLowerCase('id-ID')}`;
    const row = groups.get(key) || { date, customer, count: 0, amount: 0, invoiceNumbers: [], weekIndex };
    row.count += 1;
    row.amount += invoiceOutstanding(invoice);
    if (invoice.invoice_number) row.invoiceNumbers.push(String(invoice.invoice_number));
    groups.set(key, row);
  });
  [...groups.values()].forEach((row) => {
    row.invoiceNumbers.sort((a, b) => a.localeCompare(b, 'id-ID'));
    weeks[row.weekIndex].rows.push(row);
    weeks[row.weekIndex].amount += row.amount;
  });
  weeks.forEach((week) => week.rows.sort((a, b) => a.date.localeCompare(b.date) || a.customer.localeCompare(b.customer, 'id-ID')));

  const period = state.reportIncomePlanPeriod === 'month' ? 'month' : 'week';
  const requested = Number(state.reportIncomeWeek);
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const currentDay = report.period === currentMonth ? today.getDate() : 1;
  const defaultIndex = Math.max(0, weeks.findIndex((week) => currentDay >= week.startDay && currentDay <= week.endDay));
  const hasRequestedWeek = state.reportIncomeWeek !== null && state.reportIncomeWeek !== undefined
    && state.reportIncomeWeek !== '' && Number.isInteger(requested);
  const weekIndex = weeks.length
    ? Math.max(0, Math.min(hasRequestedWeek ? requested : defaultIndex, weeks.length - 1))
    : 0;
  const selectedWeek = weeks[weekIndex] || null;
  const rows = period === 'month' ? weeks.flatMap((week) => week.rows) : (selectedWeek?.rows || []);
  const amount = period === 'month' ? report.duePlan : (selectedWeek?.amount || 0);
  const label = period === 'month'
    ? `Seluruh bulan · ${report.periodName}`
    : selectedWeek ? `Pekan ${selectedWeek.number} · ${formatDate(selectedWeek.startDate, { day: 'numeric', month: 'short' })}–${formatDate(selectedWeek.endDate)}` : `Pekan · ${report.periodName}`;
  return { weeks, period, weekIndex, selectedWeek, rows, amount, label };
}

function formatCompactMoney(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 }).format(value);
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
  const dueInvoices = invoices.filter((row) => inPeriod(row.due_date, period) && invoiceOutstanding(row) > 0);
  const nextPeriod = shiftMonth(period, 1);
  const nextDueInvoices = invoices.filter((row) => inPeriod(row.due_date, nextPeriod) && invoiceOutstanding(row) > 0);
  const invoiceValue = sum(periodInvoices, (row) => amountOf(row.amount));
  const duePlan = sum(dueInvoices, invoiceOutstanding);
  const nextDuePlan = sum(nextDueInvoices, invoiceOutstanding);
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
  const periodEnd = dateRange(period).end;
  const supplierScopeRows = supplierEntries.filter((row) => String(row.entry_date || '').slice(0, 10) <= periodEnd);
  const supplierRows = supplierScopeRows.filter((row) => inPeriod(row.entry_date, period));
  const supplierBillRows = supplierScopeRows.filter((row) => row.entry_type === 'bill');
  const supplierNewBillRows = supplierBillRows.filter((row) => String(row.entry_date || '').slice(0, 10) >= NEW_SUPPLIER_START);
  const supplierBillsInPeriod = sum(supplierRows.filter((row) => row.entry_type === 'bill'), (row) => amountOf(row.amount));
  const supplierPayments = sum(supplierRows.filter((row) => row.entry_type === 'payment'), (row) => amountOf(row.amount));
  const supplierBillsById = new Map(supplierEntries
    .filter((row) => row.entry_type === 'bill')
    .map((row) => [String(row.id), row]));
  const supplierPaymentsThroughPeriod = supplierScopeRows.filter((row) => row.entry_type === 'payment');
  const supplierLinkedPaymentsByBill = new Map();
  supplierPaymentsThroughPeriod.forEach((row) => {
    if (!row.linked_bill_id) return;
    const key = String(row.linked_bill_id);
    supplierLinkedPaymentsByBill.set(key, (supplierLinkedPaymentsByBill.get(key) || 0) + amountOf(row.amount));
  });
  const supplierPaymentRows = supplierRows
    .filter((row) => row.entry_type === 'payment')
    .map((row) => {
      const linkedBill = supplierBillsById.get(String(row.linked_bill_id || '')) || null;
      const allocation = !linkedBill
        ? 'unallocated'
        : String(linkedBill.entry_date || '').slice(0, 10) >= NEW_SUPPLIER_START ? 'new' : 'old';
      return { ...row, linkedBill, allocation };
    });
  const supplierPaymentsToNewBills = sum(supplierPaymentRows.filter((row) => row.allocation === 'new'), (row) => amountOf(row.amount));
  const supplierPaymentsToOldBills = sum(supplierPaymentRows.filter((row) => row.allocation === 'old'), (row) => amountOf(row.amount));
  const supplierUnallocatedPaymentsThroughPeriod = sum(supplierPaymentsThroughPeriod.filter((row) => !supplierBillsById.has(String(row.linked_bill_id || ''))), (row) => amountOf(row.amount));
  const supplierNewOutstanding = sum(supplierNewBillRows, (row) => Math.max(
    amountOf(row.amount) - (supplierLinkedPaymentsByBill.get(String(row.id)) || 0), 0,
  ));

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
    nextPeriod,
    nextPeriodName: monthName(nextPeriod),
    nextDueInvoices,
    nextDuePlan,
    customerOrders,
    customerOrderValue,
    uniqueCustomerPoCount: poNumbers.length,
    supplierEntries,
    supplierScopeRows,
    supplierRows,
    supplierNewBillRows,
    supplierBillsInPeriod,
    supplierPayments,
    supplierPaymentsToNewBills,
    supplierPaymentsToOldBills,
    supplierUnallocatedPaymentsThroughPeriod,
    supplierNewOutstanding,
    supplierPaymentRows,
  };
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
  const lines = series.map(([key, label, color], seriesIndex) => {
    const points = trend.map((row, index) => `${x(index)},${y(row[key])}`).join(' ');
    const circles = trend.map((row, index) => `<circle cx="${x(index)}" cy="${y(row[key])}" r="4" fill="${color}" class="report-chart-point"><title>${esc(monthName(row.month))} · ${esc(label)}: ${esc(rupiah(row[key]))}</title></circle>`).join('');
    const labelOffset = [-12, 20, 4][seriesIndex];
    const values = trend.map((row, index) => `<text x="${x(index)}" y="${y(row[key]) + labelOffset}" text-anchor="middle" class="report-point-label" style="--point-color:${color}">${esc(formatCompactMoney(row[key]))}<title>${esc(monthName(row.month))} · ${esc(label)}: ${esc(rupiah(row[key]))}</title></text>`).join('');
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${circles}${values}`;
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
  const legend = slices.map((row) => `<div class="report-expense-tile"><i style="--legend-color:${row.color}"></i><span>${esc(row.category)}</span><strong>${esc(rupiah(row.amount))}</strong><small>${row.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</small></div>`).join('');
  const table = `<details class="report-data-details"><summary>Lihat tabel rincian pengeluaran</summary><div class="table-wrap"><table><thead><tr><th>Kategori</th><th class="numeric">Pengeluaran</th><th class="numeric">Persentase</th></tr></thead><tbody>${slices.map((row) => `<tr><td>${esc(row.category)}</td><td class="numeric">${esc(rupiah(row.amount))}</td><td class="numeric">${row.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</td></tr>`).join('')}<tr class="report-total-row"><th>Total pengeluaran terpilih</th><th class="numeric">${esc(rupiah(total))}</th><th class="numeric">100%</th></tr></tbody></table></div></details>`;
  return `<div class="report-donut-layout">${svg}<div class="report-donut-legend" aria-label="Rincian pengeluaran per kategori">${legend}</div></div>${table}`;
}

function reportMetricCard(label, value, glyph, tone, caption = '') {
  return `<article class="metric-card tone-${tone} report-metric-card"><div class="metric-top"><span>${esc(label)}</span><span class="metric-icon">${icon(glyph, 18)}</span></div><strong>${esc(value)}</strong>${caption ? `<small>${esc(caption)}</small>` : ''}</article>`;
}

function reportBreakdownCard(label, value, caption, tone = 'blue') {
  return `<article class="report-breakdown-card tone-${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(caption)}</small></article>`;
}

function reportIncomePlanPanel(report, state, plan = reportPlanView(report, state)) {
  const options = plan.weeks.map((week, index) => `<option value="${index}" ${plan.period === 'week' && index === plan.weekIndex ? 'selected' : ''}>Pekan ${integer(week.number)} · ${formatDate(week.startDate, { day: 'numeric', month: 'short' })}–${formatDate(week.endDate)}</option>`).join('');
  const invoiceCount = plan.rows.reduce((count, row) => count + row.count, 0);
  const dueCards = plan.rows.map((row) => `<article class="report-due-card"><div><strong>${esc(row.customer)}</strong><b>${esc(rupiah(row.amount))}</b></div><small>${formatDate(row.date)} · ${integer(row.count)} invoice${row.invoiceNumbers.length ? ` · ${row.invoiceNumbers.map((number) => esc(number)).join(', ')}` : ''}</small></article>`).join('');
  const missingDueInvoices = report.allInvoices.filter((invoice) => !invoice.due_date && invoiceOutstanding(invoice) > 0);
  const missingDueAmount = sum(missingDueInvoices, invoiceOutstanding);
  return `<section class="panel report-section report-income-plan" aria-labelledby="report-income-plan-title"><div class="panel-heading"><div><p class="eyebrow">TAGIHAN CUSTOMER · JATUH TEMPO</p><h2 id="report-income-plan-title">Rencana uang masuk · ${esc(report.periodName)}</h2><p>Invoice outstanding dari menu Tagihan, dikelompokkan menurut tanggal jatuh tempo.</p></div><label class="income-week-control"><span>Tampilkan</span><select aria-label="Pilih tampilan rencana penagihan laporan" data-filter="reportIncomeWeek"><option value="month" ${plan.period === 'month' ? 'selected' : ''}>Seluruh bulan · ${esc(report.periodName)}</option>${options}</select></label></div><div class="metric-grid report-plan-metrics">${reportMetricCard(plan.period === 'month' ? 'Rencana · seluruh bulan' : 'Rencana · pekan terpilih', rupiah(plan.amount), 'wallet', 'green', `${plan.label} · ${integer(invoiceCount)} invoice jatuh tempo.`)}${reportMetricCard(`Jatuh tempo · ${report.nextPeriodName}`, rupiah(report.nextDuePlan), 'clock', 'gold', `${integer(report.nextDueInvoices.length)} invoice outstanding untuk bulan berikutnya.`)}</div><div class="report-due-cards">${dueCards || `<p class="report-chart-empty">Belum ada invoice outstanding dengan jatuh tempo pada ${esc(plan.label)}.</p>`}</div>${missingDueInvoices.length ? `<div class="notice notice-info report-data-status"><span>${integer(missingDueInvoices.length)} invoice outstanding senilai ${rupiah(missingDueAmount)} belum masuk rencana karena tanggal jatuh tempo belum diisi.</span></div>` : ''}</section>`;
}

function reportSupplierPanel(report) {
  const allocationLabels = { new: 'Piutang baru', old: 'Piutang lama', unallocated: 'Belum dialokasikan' };
  const paymentRows = report.supplierPaymentRows.map((row) => `<tr><td>${esc(row.supplier)}</td><td>${formatDate(row.entry_date)}</td><td>${formatDate(row.linkedBill?.entry_date)}</td><td>${allocationLabels[row.allocation]}</td><td>${esc(row.description || '—')}</td><td class="numeric">${esc(rupiah(row.amount))}</td></tr>`).join('');
  const paymentDetails = paymentRows
    ? `<details class="report-history-details"><summary>Pembayaran supplier pada ${esc(report.periodName)} (${integer(report.supplierPaymentRows.length)})</summary><div class="table-wrap"><table><thead><tr><th>Pemasok</th><th>Tanggal bayar</th><th>Tanggal piutang</th><th>Kelompok</th><th>Keterangan</th><th class="numeric">Dibayar</th></tr></thead><tbody>${paymentRows}</tbody></table></div></details>`
    : `<p class="report-source-note">Tidak ada pembayaran supplier tercatat pada ${esc(report.periodName)}.</p>`;
  const newBillTotal = sum(report.supplierNewBillRows, (row) => amountOf(row.amount));
  const newPaymentCount = report.supplierPaymentRows.filter((row) => row.allocation === 'new').length;
  const oldPaymentCount = report.supplierPaymentRows.filter((row) => row.allocation === 'old').length;
  const unallocatedNote = report.supplierUnallocatedPaymentsThroughPeriod > 0
    ? `<div class="notice notice-warn report-data-status"><span>${rupiah(report.supplierUnallocatedPaymentsThroughPeriod)} pembayaran sampai akhir ${esc(report.periodName)} belum tertaut ke tagihan, sehingga belum dimasukkan ke piutang baru atau lama.</span></div>`
    : '';
  return `<section class="panel report-section" aria-labelledby="report-supplier-title"><div class="panel-heading"><div><p class="eyebrow">MENU PIUTANG · KEWAJIBAN PEMASOK</p><h2 id="report-supplier-title">Utang supplier</h2><p>Saldo menampilkan piutang baru sejak 1 Okt 2026. Pembayaran pada ${esc(report.periodName)} dipisahkan menurut tanggal tagihan yang dibayar.</p></div></div><div class="report-breakdown-grid report-supplier-grid">${reportBreakdownCard('Total piutang baru · mulai 1 Okt 2026', rupiah(report.supplierNewOutstanding), `${integer(report.supplierNewBillRows.length)} tagihan · total tagihan baru ${rupiah(newBillTotal)} sampai akhir ${report.periodName}.`, 'blue')}${reportBreakdownCard(`Pembayaran piutang baru · ${report.periodName}`, rupiah(report.supplierPaymentsToNewBills), `${integer(newPaymentCount)} pembayaran untuk tagihan bertanggal mulai 1 Okt 2026.`, 'green')}${reportBreakdownCard(`Pembayaran piutang lama · ${report.periodName}`, rupiah(report.supplierPaymentsToOldBills), `${integer(oldPaymentCount)} pembayaran untuk tagihan bertanggal sebelum 1 Okt 2026.`, 'gold')}</div>${unallocatedNote}${paymentDetails}<p class="report-source-note">Kedua total pembayaran dikelompokkan berdasarkan tanggal tagihan yang ditautkan, bukan tanggal pembayaran. Pembayaran tanpa tautan belum dapat dipastikan tanggal piutangnya. Sumber: menu Piutang (supplier_ledger_entries).</p></section>`;
}

function reportCSV(report, state) {
  const plan = reportPlanView(report, state);
  const rows = [
    ['Laporan performa perusahaan', report.periodName],
    ['Kategori cashflow terpilih', report.selectedCategories.length ? report.selectedCategories.join(', ') : 'Tidak ada kategori'],
    ['Definisi cashflow', 'Hanya cashflow_transactions berdasarkan transaction_date dan kind; kategori terpilih sama untuk semua angka cashflow.'],
    ['Bagian', 'Metrik', 'Nilai', 'Keterangan'],
    ['Penjualan · invoice', `Jumlah invoice pada periode ${report.periodName}`, numericCell(report.invoices.length), 'Berdasarkan invoice_date.'],
    ['Penjualan · invoice', 'Nilai invoice/tagihan terbit', numericCell(report.invoiceValue), 'Bukan kas yang sudah diterima.'],
    ['Rencana uang masuk', `Rencana ${plan.label}`, numericCell(plan.amount), 'Sisa outstanding dari sales_invoices dengan due_date pada rentang tampilan; mengikuti menu Tagihan.'],
    ['Rencana uang masuk', `Rencana bulan penuh · ${report.periodName}`, numericCell(report.duePlan), 'Sisa outstanding invoice dengan due_date pada seluruh bulan laporan.'],
    ['Rencana uang masuk', `Jatuh tempo bulan berikutnya · ${report.nextPeriodName}`, numericCell(report.nextDuePlan), `${integer(report.nextDueInvoices.length)} invoice outstanding berdasarkan due_date bulan berikutnya.`],
    ['PO Customer', 'Nomor PO unik', numericCell(report.uniqueCustomerPoCount), 'Nomor unik pada baris PO dengan order_date dalam periode.'],
    ['PO Customer', 'Baris item', numericCell(report.customerOrders.length), 'Jumlah baris customer_orders pada periode.'],
    ['PO Customer', 'Total Price', numericCell(report.customerOrderValue), 'Jumlah customerOrderFinancials(row).totalPrice; bukan invoice, kas masuk, atau laba.'],
    ['Cashflow aktual', 'Kas masuk', numericCell(report.cashflow.cashIn), 'Jumlah kind=credit.'],
    ['Cashflow aktual', 'Kas keluar', numericCell(report.cashflow.cashOut), 'Jumlah kind=debit.'],
    ['Cashflow aktual', 'Arus kas bersih', numericCell(report.cashflow.net), 'Kas masuk dikurangi kas keluar.'],
    ['Utang supplier', 'Tagihan piutang baru sejak 1 Okt 2026', numericCell(sum(report.supplierNewBillRows, (row) => amountOf(row.amount))), `${integer(report.supplierNewBillRows.length)} tagihan sampai akhir ${report.periodName}.`],
    ['Utang supplier', 'Saldo piutang baru', numericCell(report.supplierNewOutstanding), `Pembayaran tertaut ke tagihan baru dikurangi sampai akhir ${report.periodName}.`],
    ['Utang supplier', `Pembayaran piutang baru · ${report.periodName}`, numericCell(report.supplierPaymentsToNewBills), 'Dikelompokkan menurut tanggal tagihan yang dibayar.'],
    ['Utang supplier', `Pembayaran piutang lama · ${report.periodName}`, numericCell(report.supplierPaymentsToOldBills), 'Dikelompokkan menurut tanggal tagihan yang dibayar.'],
    ['Utang supplier', `Tagihan supplier · ${report.periodName}`, numericCell(report.supplierBillsInPeriod), 'entry_type=bill pada bulan laporan.'],
    ['Utang supplier', `Pembayaran supplier · ${report.periodName}`, numericCell(report.supplierPayments), 'entry_type=payment pada bulan laporan.'],
    ['Utang supplier', 'Pembayaran belum dialokasikan sampai akhir periode', numericCell(report.supplierUnallocatedPaymentsThroughPeriod), 'Pembayaran tanpa tautan tagihan yang valid.'],
  ];
  if (report.supplierPaymentRows.length) {
    rows.push(['Utang supplier', `Rincian pembayaran supplier · ${report.periodName}`, '', 'Kelompok piutang ditentukan dari tanggal tagihan yang ditautkan.']);
    rows.push(...report.supplierPaymentRows.map((entry) => [
      'Pembayaran supplier', `${entry.supplier} · ${entry.entry_date}`,
      numericCell(entry.amount), `${entry.allocation === 'new' ? 'Piutang baru' : entry.allocation === 'old' ? 'Piutang lama' : 'Belum dialokasikan'} · tanggal tagihan ${entry.linkedBill?.entry_date || '—'} · ${entry.description || '—'}`,
    ]));
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
  const categorySummaryCompact = report.selectedCategories.length
    ? `${integer(report.selectedCategories.length)} kategori dipilih`
    : 'Tidak ada kategori dipilih';
  const preferenceNotice = state.reportCategoryPreferenceError
    ? `<p class="report-filter-note">Pilihan kategori tidak dapat disimpan pada perangkat ini.</p>`
    : '';
  const categoryControls = report.categories.map((category) => `<label class="report-category-option"><input type="checkbox" data-report-category value="${esc(category)}" ${report.selectedCategories.includes(category) ? 'checked' : ''}><span>${esc(category)}</span></label>`).join('');
  const plan = reportPlanView(report, state);
  const executiveSummary = `${integer(report.invoices.length)} invoice customer terbit senilai ${rupiah(report.invoiceValue)} dan ${integer(report.uniqueCustomerPoCount)} PO Customer senilai ${rupiah(report.customerOrderValue)} pada ${report.periodName}.`;
  const metrics = [
    reportMetricCard('Penjualan · invoice', rupiah(report.invoiceValue), 'file', 'violet', `${integer(report.invoices.length)} invoice pada periode ${report.periodName} · nilai tagihan terbit.`),
    reportMetricCard('Rencana penagihan', rupiah(plan.amount), 'clock', 'gold', `${plan.label} · estimasi, bukan kas aktual.`),
    reportMetricCard('PO Customer', rupiah(report.customerOrderValue), 'package', 'blue', `${integer(report.uniqueCustomerPoCount)} PO unik · ${integer(report.customerOrders.length)} baris item.`),
    reportMetricCard('Kas masuk', rupiah(report.cashflow.cashIn), 'wallet', 'green', 'Cashflow aktual · transaksi kind credit.'),
    reportMetricCard('Kas keluar', rupiah(report.cashflow.cashOut), 'file', 'red', 'Cashflow aktual · transaksi kind debit.'),
    reportMetricCard('Arus kas bersih', rupiah(report.cashflow.net), 'trend', 'orange', 'Kas masuk dikurangi kas keluar.'),
  ].join('');
  const trendTable = `<details class="report-data-details"><summary>Lihat tabel nilai tren per bulan</summary><div class="table-wrap"><table><thead><tr><th>Periode</th><th class="numeric">Kas masuk</th><th class="numeric">Kas keluar</th><th class="numeric">Arus kas bersih</th></tr></thead><tbody>${report.trend.map((row) => `<tr><th>${esc(monthName(row.month))}</th><td class="numeric">${esc(rupiah(row.cashIn))}</td><td class="numeric">${esc(rupiah(row.cashOut))}</td><td class="numeric">${esc(rupiah(row.net))}</td></tr>`).join('')}</tbody></table></div></details>`;
  const supplierSection = reportSupplierPanel(report);
  const cashTrend = renderLineChart(report.trend, report.periodName);
  const expenseChart = renderExpenseChart(report.expenses, report.expenseTotal, report.periodName);
  const cashflowStateNote = report.selectedCategories.length
    ? `${integer(report.selectedCategories.length)} kategori cashflow dipilih.`
    : 'Tidak ada kategori dipilih; angka cashflow bernilai Rp 0.';

  return `<main class="report-page">
    <section class="page-heading report-heading"><div class="print-brand"><img src="/brand-logo.png" alt=""><span><strong>CV SURYA PRATAMA MANDIRI</strong><small>Laporan perusahaan</small></span></div><div><p class="eyebrow">LAPORAN PERFORMA PERUSAHAAN</p><h1>Laporan</h1><p>Periode ${esc(report.periodName)} · ${esc(cashflowStateNote)}</p></div><div class="heading-actions report-actions"><button class="button secondary" type="button" data-act="export-report">${icon('download', 16)}<span>Ekspor CSV</span></button><button class="button primary" type="button" data-act="print-report">${icon('file', 16)}<span>Cetak / simpan PDF</span></button></div></section>
    <section class="panel report-filters" aria-labelledby="report-filters-title"><div class="report-filter-toggle"><div><p class="eyebrow">FILTER LAPORAN</p><h2 id="report-filters-title">${esc(report.periodName)} · ${integer(report.selectedCategories.length)} kategori dipilih</h2></div><button class="button secondary" type="button" data-act="toggle-report-filters" aria-expanded="${Boolean(state.reportFiltersOpen)}">${icon(state.reportFiltersOpen ? 'close' : 'filter', 16)}<span>${state.reportFiltersOpen ? 'Sembunyikan filter' : 'Tampilkan filter'}</span></button></div>${state.reportFiltersOpen ? `<div class="report-filter-body"><div class="report-filter-top"><p class="report-filter-note">Kategori terpilih memfilter seluruh angka cashflow laporan, termasuk tren, komposisi pengeluaran, dan ekspor. Angka Tagihan, PO Customer, dan utang supplier tidak terpengaruh.</p><label class="month-control report-month"><span>Periode</span><input type="month" data-filter="reportMonth" value="${esc(report.period)}" aria-label="Periode laporan"></label></div><div class="report-category-header"><strong>${integer(report.selectedCategories.length)} dari ${integer(report.categories.length)} kategori dipilih</strong><div><button class="text-button" type="button" data-act="report-select-all">Pilih semua</button><button class="text-button" type="button" data-act="report-reset-categories">Reset</button></div></div><div class="report-category-grid">${categoryControls || '<span class="report-filter-note">Belum ada kategori cashflow.</span>'}</div>${preferenceNotice}</div>` : `<p class="report-filter-selection"><strong>Kategori cashflow:</strong> ${esc(categorySummaryCompact)}</p>`}</section>
    <section class="panel report-section report-summary-panel" aria-labelledby="report-executive-title"><div class="panel-heading"><div><h2 id="report-executive-title">Laporan bulan ${esc(report.periodName)}</h2></div></div><p class="report-executive-summary">${esc(executiveSummary)}</p><div class="metric-grid report-metric-grid">${metrics}</div></section>
    ${supplierSection}
    ${reportIncomePlanPanel(report, state, plan)}
    <section class="panel report-section report-trend-panel" data-report-chart aria-labelledby="report-trend-title"><div class="panel-heading"><div><p class="eyebrow">CASHFLOW AKTUAL</p><h2 id="report-trend-title">Tren enam bulan</h2><p>Kategori yang sama diterapkan pada semua bulan; angka pada titik grafik memakai format ringkas.</p></div><button class="button secondary report-fullscreen-button" type="button" data-act="fullscreen-report-chart">${icon('chart', 16)}<span>Layar penuh</span></button></div>${cashTrend}${trendTable}</section>
    <section class="panel report-section" aria-labelledby="report-expenses-title"><div class="panel-heading"><div><p class="eyebrow">CASHFLOW AKTUAL · ${esc(report.periodName)}</p><h2 id="report-expenses-title">Komposisi pengeluaran kas</h2><p>Hanya transaksi kind=debit. Persentase dihitung dari total pengeluaran dengan kategori terpilih.</p></div></div>${expenseChart}</section>
    <p class="report-source-note report-source-footer">Sumber: cashflow_transactions, sales_invoices, customer_orders, dan supplier_ledger_entries. Baris yang terlihat oleh RLS workspace diambil dengan pagination.</p>
  </main>`;
}
