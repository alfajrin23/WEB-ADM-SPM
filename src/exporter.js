const fill = (color) => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: color.length === 8 ? color : `FF${color}` },
});

const border = {
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

function excelValue(value) {
  if (value && typeof value === 'object' && value.__csvNumeric) return Number(value.numericValue) || 0;
  if (value && typeof value === 'object' && value.__csvDate) return new Date(`${value.iso}T00:00:00.000Z`);
  return value ?? '';
}

function styleDataRow(row, values, headers, index) {
  const alternateFill = index % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
  row.height = 21;

  values.forEach((value, columnIndex) => {
    const cell = row.getCell(columnIndex + 1);
    const header = String(headers[columnIndex] || '').toLocaleLowerCase('id-ID');
    cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: value?.__csvNumeric ? 'right' : 'left', wrapText: true };
    cell.fill = fill(alternateFill.slice(2));

    if (value && typeof value === 'object' && value.__csvNumeric) {
      cell.numFmt = value.numberFormat || '#,##0.##;[Red](#,##0.##);-';
    } else if (value && typeof value === 'object' && value.__csvDate) {
      cell.numFmt = 'dd/mm/yyyy';
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }

    if (value === '' || value === null || value === undefined) return;

    if (/debit|pengeluaran|pembayaran|tagihan/.test(header)) {
      cell.fill = fill('FEF2F2');
      cell.font = { color: { argb: 'FFB91C1C' } };
    } else if (/\b(kredit|diterima|sudah dibayar|jumlah jual|nilai invoice)\b/.test(header)) {
      cell.fill = fill('ECFDF5');
      cell.font = { color: { argb: 'FF047857' } };
    } else if (/\b(outstanding|sisa|belum diterima|kurang|kekurangan)\b/.test(header)) {
      cell.fill = fill('FFFBEB');
      cell.font = { color: { argb: 'FFB45309' } };
    }

    if (/\b(status|status pesanan)\b/.test(header)) {
      const status = String(value).toLocaleLowerCase('id-ID');
      if (status.includes('lunas') || status.includes('penuh') || status.includes('selesai')) {
        cell.fill = fill('ECFDF5');
        cell.font = { bold: true, color: { argb: 'FF047857' } };
      } else if (status.includes('tempo') || status.includes('terlambat') || status.includes('lewat') || status.includes('terbuka') || status.includes('belum')) {
        cell.fill = fill('FEF2F2');
        cell.font = { bold: true, color: { argb: 'FFB91C1C' } };
      } else if (status.includes('sebagian') || status.includes('berjalan')) {
        cell.fill = fill('EFF6FF');
        cell.font = { bold: true, color: { argb: 'FF1D4ED8' } };
      }
    }
  });
}

function styleSectionTitle(row, lastColumn, title) {
  row.height = 30;
  row.getCell(1).value = title;
  row.getCell(1).font = { name: 'Aptos Display', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  row.getCell(1).fill = fill('FF1F3A5F');
  row.getCell(1).alignment = { vertical: 'middle' };
  for (let column = 2; column <= lastColumn; column += 1) row.getCell(column).fill = fill('FF1F3A5F');
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.fill = fill('FF315A85');
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF1F3A5F' } } };
  });
}

function styleSummaryRows(rows, summary) {
  summary.forEach((values, index) => {
    const row = rows.getRow(index + 8);
    const label = String(values[0] || '').toLocaleLowerCase('id-ID');
    row.height = 23;
    row.eachCell((cell) => {
      cell.border = border;
      cell.fill = fill(index % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF');
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    row.getCell(1).font = { color: { argb: 'FF334155' } };
    const valueCell = row.getCell(2);
    const sourceValue = values[1];
    if (sourceValue && typeof sourceValue === 'object' && sourceValue.__csvNumeric) {
      valueCell.value = excelValue(sourceValue);
      valueCell.numFmt = sourceValue.numberFormat || '#,##0.##;[Red](#,##0.##);-';
      valueCell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    if (/\b(debit|keluar|pembayaran|hutang|outstanding|belum|kurang)\b/.test(label)) {
      valueCell.fill = fill('FEF2F2');
      valueCell.font = { bold: true, color: { argb: 'FFB91C1C' } };
    } else if (/\b(kredit|masuk|diterima|dibayar|terkirim|jual)\b/.test(label)) {
      valueCell.fill = fill('ECFDF5');
      valueCell.font = { bold: true, color: { argb: 'FF047857' } };
    }
  });
}

function columnWidth(header, rows, index) {
  const sampleWidth = rows.slice(0, 30).reduce((width, row) => {
    const value = row[index];
    const text = value && typeof value === 'object' ? value.value || '' : String(value ?? '');
    return Math.max(width, text.length);
  }, String(header).length);
  return Math.max(12, Math.min(38, sampleWidth + 2));
}

export async function downloadWorkbook({ filename, title, period, summary, headers, details }) {
  const imported = await import('exceljs');
  const ExcelJS = imported.default || imported;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CV Surya Pratama Mandiri';
  workbook.title = title;
  workbook.subject = `Laporan ${title}`;
  workbook.created = new Date();
  workbook.modified = new Date();

  const summarySheet = workbook.addWorksheet('Ringkasan', {
    views: [{ state: 'frozen', ySplit: 8, topLeftCell: 'A9' }],
  });
  summarySheet.columns = [{ width: 40 }, { width: 28 }];
  summarySheet.mergeCells('A1:B1');
  styleSectionTitle(summarySheet.getRow(1), 2, 'CV SURYA PRATAMA MANDIRI');
  summarySheet.mergeCells('A2:B2');
  summarySheet.getCell('A2').value = title;
  summarySheet.getCell('A2').font = { size: 13, bold: true, color: { argb: 'FF1F3A5F' } };
  summarySheet.getCell('A2').alignment = { vertical: 'middle' };
  summarySheet.getRow(2).height = 25;
  summarySheet.getCell('A3').value = 'Periode';
  summarySheet.getCell('B3').value = period;
  summarySheet.getCell('A4').value = 'Waktu ekspor';
  summarySheet.getCell('B4').value = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta',
  }).format(new Date());
  summarySheet.getCell('A6').value = 'REKAPAN';
  summarySheet.getCell('A6').font = { bold: true, color: { argb: 'FF1F3A5F' } };
  summarySheet.addRow([]);
  const summaryHeader = summarySheet.addRow(['Indikator', 'Nilai']);
  styleHeader(summaryHeader);
  summary.forEach((values) => summarySheet.addRow([values[0], excelValue(values[1])]));
  styleSummaryRows(summarySheet, summary);

  const dataSheet = workbook.addWorksheet('Data', {
    views: [{ state: 'frozen', ySplit: 5, topLeftCell: 'A6' }],
  });
  dataSheet.columns = headers.map((header, index) => ({ width: columnWidth(header, details, index) }));
  dataSheet.mergeCells(1, 1, 1, headers.length);
  styleSectionTitle(dataSheet.getRow(1), headers.length, 'CV SURYA PRATAMA MANDIRI');
  dataSheet.mergeCells(2, 1, 2, headers.length);
  dataSheet.getCell('A2').value = title;
  dataSheet.getCell('A2').font = { size: 12, bold: true, color: { argb: 'FF1F3A5F' } };
  dataSheet.getCell('A2').alignment = { vertical: 'middle' };
  dataSheet.getRow(2).height = 24;
  dataSheet.getCell('A3').value = 'Periode';
  dataSheet.getCell('B3').value = period;
  const headerRow = dataSheet.addRow([]);
  const actualHeaderRow = dataSheet.addRow(headers);
  styleHeader(actualHeaderRow);

  details.forEach((values, index) => {
    const row = dataSheet.addRow(values.map(excelValue));
    styleDataRow(row, values, headers, index);
  });
  dataSheet.autoFilter = {
    from: { row: actualHeaderRow.number, column: 1 },
    to: { row: Math.max(actualHeaderRow.number, dataSheet.rowCount), column: headers.length },
  };
  headerRow.height = 8;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
