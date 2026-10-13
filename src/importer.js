import { toNumber } from './helpers.js';

const clean = (value) => String(value ?? '').trim();
const norm = (value) => clean(value).toLocaleUpperCase('id-ID').replace(/\s+/g, ' ');
let xlsxRuntime;

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value > 20000) {
    const parsed = xlsxRuntime.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = clean(value);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const date = new Date(parsed);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function rowsFor(sheet) {
  const cellKeys = Object.keys(sheet).filter((key) => /^[A-Z]+\d+$/i.test(key));
  if (!cellKeys.length) return { rows: [], rowOffset: 0 };
  let maxRow = 0;
  for (const key of cellKeys) maxRow = Math.max(maxRow, xlsxRuntime.utils.decode_cell(key).r);
  const ref = xlsxRuntime.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const rows = xlsxRuntime.utils.sheet_to_json(sheet, {
    header: 1, raw: true, defval: '',
    range: { s: { r: ref.s.r, c: 0 }, e: { r: maxRow, c: ref.e.c } },
  });
  return { rows, rowOffset: ref.s.r };
}

function findHeader(rows, predicate) {
  return rows.findIndex((row) => predicate(row.map(norm)));
}

function sourceType(headers) {
  if (headers.includes('QTY PO') && headers.includes('DELIVERY') && headers.some((v) => v.includes('COSTUMER') || v.includes('CUSTOMER'))) return 'customer_orders';
  if (headers.includes('QTY ORDER') && headers.includes('QTY KIRIM') && headers.some((v) => v.includes('SUPLAYER') || v.includes('SUPPLIER'))) return 'supplier_purchase_orders';
  if (headers.some((v) => /^NO\.?\s*INVOICE$/.test(v)) && headers.some((v) => v.includes('BALANCE')) && headers.some((v) => v.includes('JAPO'))) return 'sales_invoices';
  if (headers.includes('TGL') && headers.includes('URAIAN') && headers.includes('DEBIT') && headers.includes('KREDIT') && headers.includes('SALDO')) return 'cashflow_transactions';
  return null;
}

function sheetType(rows) {
  const index = findHeader(rows, (header) => sourceType(header));
  if (index < 0) return null;
  return sourceType(rows[index].map(norm));
}

function monthFromSheet(sheetName, fileName) {
  const words = `${sheetName} ${fileName}`.toLocaleLowerCase('id-ID');
  const months = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
  const index = months.findIndex((month) => words.includes(month));
  const numeric = words.match(/(?:^|\D)(20\d{2})\D(\d{1,2})(?:\D|$)/);
  const yearMatch = words.match(/20\d{2}/);
  const year = numeric?.[1] || yearMatch?.[0] || String(new Date().getFullYear());
  const month = numeric?.[2] ? Number(numeric[2]) : index >= 0 ? index + 1 : new Date().getMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function sourceKey(fileName, sheetName, excelRow) {
  return `${fileName}::${sheetName}::${excelRow}`.slice(0, 240);
}

function parseCustomerOrders(rows, headerIndex, rowOffset, file, sheetName) {
  const header = rows[headerIndex].map(norm);
  const col = (name) => header.findIndex((value) => value === name);
  const orderDate = col('TGL');
  const poNumber = col('NO PO');
  const customer = header.findIndex((value) => value.includes('COSTUMER') || value.includes('CUSTOMER'));
  const qtyOrder = col('QTY PO');
  const delivered = col('DELIVERY');
  const unitPrice = col('PRICE');
  const amount = col('TOTAL HARGA');
  const actualAmount = col('JUMLAH JUAL');
  const item = col('ITEM');
  const size = col('SIZE');
  const sizeSheet = col('SIZE SHEET');
  const records = [];
  rows.slice(headerIndex + 1).forEach((row, index) => {
    const po = clean(row[poNumber]);
    const name = clean(row[customer]);
    const product = clean(row[item]);
    const quantity = toNumber(row[qtyOrder]);
    if (!po || !name || !product || quantity <= 0) return;
    const price = toNumber(row[unitPrice]);
    records.push({
      order_date: dateValue(row[orderDate]) || null,
      po_number: po,
      customer: name,
      item: product,
      size: [clean(row[size]), clean(row[sizeSheet])].filter(Boolean).join(' · '),
      qty_order: quantity,
      qty_produced: 0,
      qty_delivered: toNumber(row[delivered]),
      unit_price: price,
      amount: toNumber(row[amount]) || quantity * price,
      source_key: sourceKey(file.name, sheetName, rowOffset + headerIndex + index + 2),
    });
  });
  return records;
}

function parseSupplierOrders(rows, headerIndex, rowOffset, file, sheetName) {
  const header = rows[headerIndex].map(norm);
  const col = (name) => header.findIndex((value) => value === name);
  const i = {
    po: col('NO PO'), supplier: header.findIndex((value) => value.includes('SUPLAYER') || value.includes('SUPPLIER')),
    customer: header.findIndex((value) => value.includes('COSTUMER') || value.includes('CUSTOMER')),
    item: col('ITEM'), quality: col('QLTY'), size: col('SIZE SHEET'),
    ordered: col('QTY ORDER'), shipped: col('QTY KIRIM'), price: col('HARGA'),
  };
  const period = monthFromSheet(sheetName, file.name);
  const groups = new Map();
  let po = '', supplier = '', customer = '';
  rows.slice(headerIndex + 1).forEach((row, index) => {
    po = clean(row[i.po]) || po;
    supplier = clean(row[i.supplier]) || supplier;
    customer = clean(row[i.customer]) || customer;
    const quantity = toNumber(row[i.ordered]);
    if (!po || !supplier || quantity <= 0) return;
    const key = `${po}::${supplier}`;
    if (!groups.has(key)) {
      groups.set(key, {
        po_number: po, supplier, customer, order_date: `${period}-01`, items: [],
        source_key: sourceKey(file.name, sheetName, rowOffset + headerIndex + index + 2),
      });
    }
    groups.get(key).items.push({
      item: clean(row[i.item]) || 'SHEET',
      qlty: clean(row[i.quality]),
      sizeSheet: clean(row[i.size]),
      qtyOrder: quantity,
      qtyKirim: toNumber(row[i.shipped]),
      harga: toNumber(row[i.price]),
    });
  });
  return [...groups.values()];
}

function parseInvoices(rows, headerIndex, rowOffset, file, sheetName) {
  const period = monthFromSheet(sheetName, file.name);
  let customer = '';
  for (let index = headerIndex; index >= 0; index -= 1) {
    const candidate = clean(rows[index]?.[0]);
    if (/^PT\.?\s/i.test(candidate)) { customer = candidate.replace(/\s+/g, ' '); break; }
  }
  const records = [];
  rows.slice(headerIndex + 1).forEach((row, index) => {
    const customerCell = clean(row[0]);
    if (/^PT\.?\s/i.test(customerCell)) {
      customer = customerCell.replace(/\s+/g, ' ');
      return;
    }
    const invoice = clean(row[4]);
    const amount = toNumber(row[5]);
    if (!invoice || /^(TOTAL|JUMLAH|SALDO)$/i.test(invoice) || amount <= 0) return;
    const paid = toNumber(row[6]);
    const balance = row[7] === '' || row[7] == null ? Math.max(amount - paid, 0) : toNumber(row[7]);
    records.push({
      invoice_date: dateValue(row[1]) || `${period}-01`,
      due_date: dateValue(row[2]) || null,
      paid_date: dateValue(row[8]) || null,
      customer: customer || 'Customer belum dicatat',
      invoice_number: invoice,
      po_number: clean(row[3]),
      amount,
      paid_amount: paid,
      outstanding_amount: balance,
      source_key: sourceKey(file.name, sheetName, rowOffset + headerIndex + index + 2),
    });
  });
  return records;
}

function categoryName(raw) {
  const value = clean(raw);
  const key = value.toLocaleLowerCase('id-ID');
  if (key === 'uang masuk' || key.includes('transfer masuk')) return 'Uang Masuk';
  if (key.includes('admin')) return 'Admin';
  if (key.includes('gaji') && key.includes('produksi')) return 'Gaji Produksi';
  if (key.includes('gaji')) return 'Gaji Staff';
  if (key.includes('matt') || key.includes('material') || key.includes('bahan')) return 'Material Bahan';
  if (key.includes('listrik')) return 'Listrik';
  if (key === 'ops' || key.includes('operasional')) return 'Operasional';
  if (key.includes('atk')) return 'ATK';
  if (key.includes('subcon')) return 'Subcon';
  if (key.includes('pajak')) return 'Pajak';
  if (key.includes('telephone') || key.includes('telepon')) return 'Telephone';
  if (key.includes('fee market')) return 'Fee Market';
  if (key.includes('perawatan')) return 'Perawatan';
  if (key.includes('sewa')) return 'Sewa Gudang';
  return value || 'Lainnya';
}

function parseCashflow(rows, headerIndex, rowOffset, file, sheetName) {
  const records = [];
  let openingBalance = null;
  rows.forEach((row) => {
    if (clean(row[1]).toLocaleLowerCase('id-ID').includes('sisa saldo desember')) openingBalance = toNumber(row[4]);
  });
  rows.slice(headerIndex + 1).forEach((row, index) => {
    const date = dateValue(row[0]);
    const debit = toNumber(row[2]);
    const credit = toNumber(row[3]);
    if (!date || debit + credit <= 0) return;
    const category = categoryName(row[5]);
    records.push({
      transaction_date: date,
      description: clean(row[1]),
      category,
      requester: clean(row[6]),
      amount: credit || debit,
      kind: credit > 0 ? 'credit' : 'debit',
      source_key: sourceKey(file.name, sheetName, rowOffset + headerIndex + index + 2),
    });
  });
  const firstTransaction = records.map((row) => row.transaction_date).sort()[0];
  return { records, openingBalance, openingBalanceDate: firstTransaction ? `${firstTransaction.slice(0, 7)}-01` : '' };
}

export async function inspectWorkbook(file, selectedSheet) {
  xlsxRuntime ||= await import('xlsx');
  const workbook = xlsxRuntime.read(await file.arrayBuffer(), { cellDates: true, dense: false });
  const sheets = workbook.SheetNames.map((name) => {
    const { rows } = rowsFor(workbook.Sheets[name]);
    return { name, type: sheetType(rows), rows };
  });
  const selected = sheets.find((sheet) => sheet.name === selectedSheet)
    || sheets.find((sheet) => sheet.type) || sheets[0];
  if (!selected) throw new Error('Workbook tidak memiliki lembar yang dapat dibaca.');
  const source = rowsFor(workbook.Sheets[selected.name]);
  const type = selected.type;
  if (!type) throw new Error('Kolom lembar ini belum dikenali. Pilih lembar PO customer, PO supplier, outstanding invoice, atau transaksi kas.');
  const headerIndex = findHeader(source.rows, (header) => sourceType(header));
  let records;
  let openingBalance;
  let openingBalanceDate;
  if (type === 'customer_orders') records = parseCustomerOrders(source.rows, headerIndex, source.rowOffset, file, selected.name);
  if (type === 'supplier_purchase_orders') records = parseSupplierOrders(source.rows, headerIndex, source.rowOffset, file, selected.name);
  if (type === 'sales_invoices') records = parseInvoices(source.rows, headerIndex, source.rowOffset, file, selected.name);
  if (type === 'cashflow_transactions') ({ records, openingBalance, openingBalanceDate } = parseCashflow(source.rows, headerIndex, source.rowOffset, file, selected.name));
  return {
    sheets: sheets.map(({ name, type: sheetKind }) => ({ name, type: sheetKind })),
    sheetName: selected.name,
    type,
    records: records || [],
    openingBalance,
    openingBalanceDate,
    sample: (records || []).slice(0, 5),
  };
}

