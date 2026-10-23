
import React, { useMemo, useState } from 'react';
import MonthYearPicker from '../../components/MonthYearPicker';
import { loadState, isInMonth, isInYear, paidAmount, advanceAmount } from './shared';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';
import { exportStyledExcel } from '../../utils/exportExcel';

export default function PaymentsReport(){
  const now = new Date();
  const [mode, setMode] = useState('month');
  const [sel, setSel] = useState({ year: String(now.getFullYear()), month: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}` });
  const { invoices, rooms, tenants, payments, rentPeriods, paymentAllocations } = loadState();
  const filtered = useMemo(()=> invoices.filter(i=> mode==='month' ? isInMonth(i, sel.month) : isInYear(i, sel.year)), [invoices, mode, sel]);
  const rows = filtered.map((i, idx)=>{
    const r = rooms.find(x=>x.id===i.roomId); 
    const roomTenants = tenants.filter(t => t.roomId === i.roomId);
    const tenantNames = roomTenants.map(t => t.name).join(', ');
    const paid = paidAmount(i, payments);
    const advance = advanceAmount(i, rentPeriods, paymentAllocations);
    return [idx+1, r?.name||'', tenantNames, i.month, (i.total||0).toLocaleString(), advance.toLocaleString(), paid.toLocaleString(), Math.max(0, (+i.total||0) - advance - paid).toLocaleString()];
  });
  const sumTotal = filtered.reduce((a,i)=> a + (+i.total||0), 0);
  const sumPaid = filtered.reduce((a,i)=> a + paidAmount(i, payments), 0);
  const sumAdvance = filtered.reduce((a,i)=> a + advanceAmount(i, rentPeriods, paymentAllocations), 0);
  const sumRemaining = Math.max(0, sumTotal - sumAdvance - sumPaid);
  const onExport = ()=> exportReportPdf({ title: 'BÁO CÁO THANH TOÁN', subtitle: mode==='month'?`Tháng: ${sel.month}`:`Năm: ${sel.year}`, columns: ['#','Phòng','Khách','Kỳ','Tổng hóa đơn','Đóng trước','Đã đóng','Còn lại'], rows, summary: [`Tổng hóa đơn: ${sumTotal.toLocaleString()} đ`, `Đóng trước: ${sumAdvance.toLocaleString()} đ`, `Đã đóng: ${sumPaid.toLocaleString()} đ`, `Còn lại: ${sumRemaining.toLocaleString()} đ`], fileName: `payments-${mode==='month'?sel.month:sel.year}.pdf` });
  const onExportExcel = () => exportStyledExcel({
    filename: `bao-cao-thanh-toan-${mode==='month'?sel.month:sel.year}.xlsx`,
    sheetName: 'Thanh toán',
    title: 'Báo cáo thanh toán',
    subtitle: mode==='month'?`Tháng: ${sel.month}`:`Năm: ${sel.year}`,
    columns: [
      { header: '#', key: 'idx', width: 6 },
      { header: 'Phòng', key: 'room', width: 12 },
      { header: 'Khách', key: 'tenant', width: 24 },
      { header: 'Kỳ', key: 'month', width: 10 },
      { header: 'Tổng hóa đơn', key: 'total', width: 16, money: true },
      { header: 'Đóng trước', key: 'advance', width: 16, money: true },
      { header: 'Đã đóng', key: 'paid', width: 16, money: true },
      { header: 'Còn lại', key: 'remaining', width: 16, money: true },
    ],
    rows: rows.map(([idx, room, tenant, month, total, advance, paid, remaining]) => ({
      idx, room, tenant, month, total: total.replaceAll(',', ''), advance: advance.replaceAll(',', ''), paid: paid.replaceAll(',', ''), remaining: remaining.replaceAll(',', ''),
    })),
    totals: { room: 'Tổng cộng', total: sumTotal, advance: sumAdvance, paid: sumPaid, remaining: sumRemaining },
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Báo cáo thanh toán</h3>
        <div className="flex gap-2">
          <button onClick={onExportExcel} className="h-[29px] rounded bg-emerald-600 px-2 text-[11px] text-white">Xuất Excel</button>
          <button onClick={onExport} className="h-[29px] rounded bg-slate-900 px-2 text-[11px] text-white">Xuất PDF</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="h-[29px] rounded border px-2 text-xs" value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="month">Theo tháng</option>
          <option value="year">Theo năm</option>
        </select>
        <MonthYearPicker mode={mode} value={sel} onChange={setSel} />
      </div>
      <div className="text-sm text-slate-600">Tổng HĐ: <b>{sumTotal.toLocaleString()}</b> đ • Đóng trước: <b>{sumAdvance.toLocaleString()}</b> đ • Đã đóng: <b>{sumPaid.toLocaleString()}</b> đ • Còn lại: <b>{sumRemaining.toLocaleString()}</b> đ</div>
    </div>
  );
}
