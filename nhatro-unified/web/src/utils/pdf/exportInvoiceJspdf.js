
// src/utils/pdf/exportInvoiceJspdf.js
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { ensureVietnameseFonts } from './fontLoader';
import { fetchVietQrPngDataUrl, vnd } from './vietqr';

export async function exportInvoicePdfByJsPDF(inv, settings) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  await ensureVietnameseFonts(doc);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(11);

  const margin = { l: 40, t: 40, r: 40, b: 40 };
  let cursorY = margin.t;

  const addInfo = (settings.addInfoTemplate || 'Tien phong {room} {month}')
    .replace(/\{room\}/gi, inv.roomCode)
    .replace(/\{month\}/gi, inv.monthLabel);

  let qrDataUrl = null;
  try {
    qrDataUrl = await fetchVietQrPngDataUrl(
      settings.bankCode,
      settings.accountNumber,
      Math.round(inv.total),
      addInfo,
      settings.accountName
    );
  } catch (e) {
    console.warn('VietQR error:', e);
  }

  // Title
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(18);
  doc.text('HÓA ĐƠN PHÒNG TRỌ', margin.l, cursorY);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(11);

  const qrW = 140;
  const qrH = 140;
  const qrX = doc.internal.pageSize.getWidth() - margin.r - qrW;
  const qrY = margin.t;
  if (qrDataUrl) {
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrW, qrH, undefined, 'FAST');
  }
  cursorY += 22;

  const line = (label, value) => {
    const xLabel = margin.l;
    const xValue = margin.l + 76;
    doc.setFont('NotoSans', 'bold');
    doc.text(String(label), xLabel, cursorY);
    doc.setFont('NotoSans', 'normal');
    doc.text(String(value || '-'), xValue, cursorY);
    cursorY += 16;
  };

  // Landlord information
  line('Chủ trọ:', settings.landlordName || '');
  line('Địa chỉ:', settings.landlordAddress || '');

  // Invoice info
  line('Tháng:', inv.monthLabel);
  line('Phòng:', inv.roomCode);
  line('Khách:', (inv.tenants || []).join(', '));

  if (qrDataUrl) {
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text('Quét VietQR để thanh toán', qrX + qrW, qrY + qrH + 12, { align: 'right' });
    doc.setTextColor(0);
    doc.setFontSize(11);
  }
  cursorY += 6;

  const tableBody = (inv.items || []).map(i => ([
    i.name,
    i.spec ?? '-',
    String(i.qty ?? '-'),
    i.unitPrice == null ? '-' : vnd(i.unitPrice),
    { content: vnd(i.amount), styles: { halign: 'right' } },
  ]));

  doc.autoTable({
    startY: Math.max(cursorY, qrY + qrH + 20),
    margin: { left: margin.l, right: margin.r },
    head: [[ 'Khoản', 'Chỉ số', 'Số lượng', 'Đơn giá', 'Thành tiền' ]],
    body: tableBody,
    styles: { font: 'NotoSans', fontSize: 10, cellPadding: 6 },
    headStyles: { font: 'NotoSans', fillColor: [26, 160, 109], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [247, 247, 247] },
    tableWidth: 'auto',
    columnStyles: { 1: { cellWidth: 90 }, 2: { cellWidth: 90 }, 3: { cellWidth: 80 }, 4: { cellWidth: 90 } },
  });

  let afterTableY = doc.lastAutoTable.finalY + 10;

  doc.setFont('NotoSans', 'bold');
  doc.text('TỔNG CỘNG:', doc.internal.pageSize.getWidth() - margin.r - 190, afterTableY);
  doc.text(vnd(inv.total), doc.internal.pageSize.getWidth() - margin.r, afterTableY, { align: 'right' });
  afterTableY += 20;

  doc.setFont('NotoSans', 'normal');
  const status = inv.paid ? 'Đã thanh toán' : 'Chưa thanh toán';
  let statusText = `Trạng thái: ${status}`;
  if (inv.paid && inv.paidDateLabel) statusText += ` • Đã thanh toán: ${inv.paidDateLabel}`;
  doc.text(statusText, margin.l, afterTableY);
  afterTableY += 16;

  if (inv.note) {
    const boxTop = afterTableY;
    const boxWidth = doc.internal.pageSize.getWidth() - margin.l - margin.r;
    doc.setFont('NotoSans', 'bold');
    doc.text('Ghi chú:', margin.l + 6, boxTop + 14);
    doc.setFont('NotoSans', 'normal');
    const text = doc.splitTextToSize(inv.note, boxWidth - 12);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(246, 246, 246);
    doc.roundedRect(margin.l, boxTop, boxWidth, 60, 3, 3, 'F');
    doc.text(text, margin.l + 6, boxTop + 34);
    afterTableY = boxTop + 70;
  }

  const fileName = `HoaDon_${inv.roomCode}_${inv.monthLabel}.pdf`;
  doc.save(fileName);
}

export async function exportReportPdf({ title, subtitle, columns, rows, summary, fileName }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  await ensureVietnameseFonts(doc);
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(11);

  const margin = { l: 40, t: 40, r: 40, b: 40 };
  let cursorY = margin.t;

  // Title
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(18);
  doc.text(title, margin.l, cursorY);
  cursorY += 30;

  // Subtitle
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(12);
  doc.text(subtitle, margin.l, cursorY);
  cursorY += 20;

  // Table
  const tableData = rows.map(row => row.map(cell => String(cell)));
  doc.autoTable({
    startY: cursorY,
    head: [columns],
    body: tableData,
    theme: 'grid',
    styles: { font: 'NotoSans', fontSize: 10 },
    headStyles: { fillColor: [0, 128, 0] },
    margin: margin,
  });

  cursorY = doc.lastAutoTable.finalY + 20;

  // Summary
  if (summary && summary.length) {
    doc.setFont('NotoSans', 'bold');
    doc.setFontSize(12);
    summary.forEach(line => {
      doc.text(line, margin.l, cursorY);
      cursorY += 15;
    });
  }

  doc.save(fileName);
}
