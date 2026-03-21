
import React, { useMemo, useState } from 'react';
import MonthYearPicker from '../../components/MonthYearPicker';
import { loadState, isInMonth, isInYear, paidAmount } from './shared';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';

export default function PaymentsReport(){
  const now = new Date();
  const [mode, setMode] = useState('month');
  const [sel, setSel] = useState({ year: String(now.getFullYear()), month: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}` });
  const { invoices, rooms, tenants, payments } = loadState();
  const filtered = useMemo(()=> invoices.filter(i=> mode==='month' ? isInMonth(i, sel.month) : isInYear(i, sel.year)), [invoices, mode, sel]);
  const rows = filtered.map((i, idx)=>{
    const r = rooms.find(x=>x.id===i.roomId); 
    const roomTenants = tenants.filter(t => t.roomId === i.roomId);
    const tenantNames = roomTenants.map(t => t.name).join(', ');
    const paid = paidAmount(i, payments);
    return [idx+1, r?.name||'', tenantNames, i.month, (i.total||0).toLocaleString(), paid.toLocaleString()];
  });
  const sumTotal = filtered.reduce((a,i)=> a + (+i.total||0), 0);
  const sumPaid = filtered.reduce((a,i)=> a + paidAmount(i, payments), 0);
  const onExport = ()=> exportReportPdf({ title: 'BÁO CÁO THANH TOÁN', subtitle: mode==='month'?`Tháng: ${sel.month}`:`Năm: ${sel.year}`, columns: ['#','Phòng','Khách','Kỳ','Tổng hóa đơn','Đã đóng'], rows, summary: [`Tổng hóa đơn: ${sumTotal.toLocaleString()} đ`, `Đã đóng: ${sumPaid.toLocaleString()} đ`], fileName: `payments-${mode==='month'?sel.month:sel.year}.pdf` });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Báo cáo thanh toán</h3>
        <div className="flex items-center gap-2">
          <select className="border rounded px-2 py-1" value={mode} onChange={e=>setMode(e.target.value)}>
            <option value="month">Theo tháng</option>
            <option value="year">Theo năm</option>
          </select>
          <MonthYearPicker mode={mode} value={sel} onChange={setSel} />
          <button onClick={onExport} className="rounded bg-slate-900 text-white px-3 py-1">Xuất PDF</button>
        </div>
      </div>
      <div className="text-sm text-slate-600">Tổng HĐ: <b>{sumTotal.toLocaleString()}</b> đ • Đã đóng: <b>{sumPaid.toLocaleString()}</b> đ</div>
    </div>
  );
}
