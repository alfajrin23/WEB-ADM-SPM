export const CASH_CATEGORIES = [
  'Admin', 'Gaji Staff', 'Gaji Produksi', 'Operasional', 'Uang Masuk', 'Pencairan lewat', 'Dana Talang', 'Listrik',
  'Subcon', 'ATK', 'Pajak', 'Telephone', 'Material Bahan', 'Fee Market',
  'Cicilan piutang', 'Debit bank', 'Perawatan', 'Sewa Gudang', 'Lainnya',
];

export const CAUSES = [
  ['administrasi', 'Administrasi'], ['material', 'Bahan baku'], ['produksi', 'Produksi'],
  ['kualitas', 'Kualitas / rework'], ['pengiriman', 'Pengiriman'],
  ['perubahan-pelanggan', 'Perubahan customer'], ['lainnya', 'Lainnya'],
];

const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 14h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6m3-3h-6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-8 4h8"/>',
  factory: '<path d="M2 21V9l7 4V9l7 4V5l6-3v19z"/><path d="M6 17h.01M10 17h.01M14 17h.01M18 17h.01"/>',
  package: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8m-9 5v9"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h2m4 0h2m-8 4h2m4 0h2m-8 4h2m4 0h2"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5-5 5 5m-5-5v12"/>',
  plus: '<path d="M12 5v14m-7-7h14"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  trash: '<path d="M3 6h18m-2 0-1 14H6L5 6m4 0V4h6v2m-5 4v6m4-6v6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  chart: '<path d="M3 3v18h18M18 17V9m-5 8V5m-5 12v-5"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 17 6l3 6M4 12l3 6a7 7 0 0 0 11.4-3"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
};

export function icon(name, size = 18) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || iconPaths.circle}</svg>`;
}

export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export const rupiah = (value) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value) || 0);

export const integer = (value) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value) || 0);
export function formatNumberInput(value) {
  if (value === '' || value === null || value === undefined) return '';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(toNumber(value));
}
export const isoToday = () => localISODate(new Date());

export function localISODate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function formatDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', ...options }).format(date);
}

export function monthName(value) {
  if (!value) return 'Semua periode';
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

export function inMonth(value, month) {
  return !month || String(value || '').slice(0, 7) === month;
}

export function toNumber(value) {
  if (typeof value === 'number') return value;
  let clean = String(value ?? '').replace(/[^\d,.-]/g, '');
  const dot = clean.lastIndexOf('.');
  const comma = clean.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    clean = dot > comma ? clean.replace(/,/g, '') : clean.replace(/\./g, '').replace(',', '.');
  } else if (comma >= 0) {
    const decimals = clean.length - comma - 1;
    clean = decimals > 0 && decimals < 3 ? clean.replace(/,/g, '.') : clean.replace(/,/g, '');
  } else if (dot >= 0) {
    const decimals = clean.length - dot - 1;
    if (decimals === 3) clean = clean.replace(/\./g, '');
    else if (decimals < 1 || decimals > 2) clean = clean.replace(/\./g, '');
  }
  return Number(clean) || 0;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((value) => {
    const isNumber = value && typeof value === 'object' && value.__csvNumeric === true;
    let text = isNumber ? value.value : String(value ?? '');
    if (!isNumber && typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(';')).join('\r\n');
  const blob = new Blob([`\uFEFFsep=;\r\n${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function statusForInvoice(invoice) {
  const balance = invoice.outstanding_amount ?? Math.max(Number(invoice.amount) - Number(invoice.paid_amount || 0), 0);
  if (balance <= 0) return ['paid', 'Lunas'];
  if (Number(invoice.paid_amount || 0) > 0) return ['partial', 'Sebagian dibayar'];
  if (invoice.due_date && invoice.due_date < isoToday()) return ['late', 'Jatuh tempo'];
  return ['open', 'Belum dibayar'];
}

export function orderProgress(order) {
  const ordered = Number(order.qty_order) || 0;
  const delivered = Number(order.qty_delivered) || 0;
  const produced = Number(order.qty_produced) || 0;
  if (ordered > 0 && delivered >= ordered) return ['done', 'Terkirim penuh'];
  if (order.due_date && order.due_date < isoToday()) return ['late', 'Lewat janji'];
  if (produced > 0 || delivered > 0) return ['partial', 'Berjalan'];
  return ['pending', 'Belum mulai'];
}

export const CUSTOMER_VAT_RATE = 0.11;

export function customerOrderFinancials(row) {
  const qtyOrder = Number(row.qty_order || 0);
  const qtyDelivered = Number(row.qty_delivered || 0);
  const unitPrice = Number(row.unit_price || 0);
  const amount = row.amount == null ? qtyOrder * unitPrice : Number(row.amount);
  const tax = Number(row.po_tax_amount || 0);
  const totalPrice = row.total_price == null ? amount + tax : Number(row.total_price);
  const realizedAmount = qtyDelivered * unitPrice;
  const realizedTax = realizedAmount * CUSTOMER_VAT_RATE;
  const realizedTotal = realizedAmount + realizedTax;
  return {
    qtyOrder, qtyDelivered, unitPrice, amount, tax, totalPrice,
    qtyDelta: qtyDelivered - qtyOrder,
    realizedAmount, realizedTax, realizedTotal,
    salesShortfall: totalPrice - realizedTotal,
  };
}

export const supplierOrderReceivedQuantity = (item) =>
  Number(item?.qtyDiterima ?? item?.qtyKirim ?? 0) || 0;

