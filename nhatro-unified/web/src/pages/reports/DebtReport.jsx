
import React, { useMemo, useState } from 'react';
import MonthYearPicker from '../../components/MonthYearPicker';
import { loadState, isInMonth, isInYear, paidAmount } from './shared';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';

export default function DebtReport(){
  const now = new Date();
  const [mode, setMode] = useState('month');
  const [sel, setSel] = useState({ year: String(now.getFullYear()), month: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}` });
  const { invoices, rooms, tenants, payments } = loadState();
  const filtered = useMemo(()=> invoices.filter(i=> mode==='month' ? isInMonth(i, sel.month) : isInYear(i, sel.year)), [invoices, mode, sel]);
  const rows = filtered.map((i, idx)=>{
    const r = rooms.find(x=>x.id===i.roomId); const t = tenants.find(x=>x.id===i.tenantId); const paid = paidAmount(i, payments); const debt = Math.max(0, (+i.total||0) - paid);
    return [idx+1, r?.name||'', t?.name||'', i.month, (i.total||0).toLocaleString(), paid.toLocaleString(), debt.toLocaleString(), i.status||''];
  });
  const sumDebt = filtered.reduce((a,i)=> a + debtAmount(i, payments), 0);
  const onExport = ()=> exportReportPdf({ title: 'BÁO CÁO CÔNG NỢ', subtitle: mode==='month'?`Tháng: ${sel.month}`:`Năm: ${sel.year}`, columns: ['#','Phòng','Khách','Kỳ','Tổng HĐ','Đã đóng','Còn nợ','Trạng thái'], rows, summary: [`Tổng nợ: ${sumDebt.toLocaleString()} đ`], fileName: `debt-${mode==='month'?sel.month:sel.year}.pdf` });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select className="border rounded px-2 py-1" value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="month">Theo tháng</option>
          <option value="year">Theo năm</option>
        </select>
        <MonthYearPicker mode={mode} value={sel} onChange={setSel} />
        <button onClick={onExport} className="rounded bg-slate-900 text-white px-3 py-1">Xuất PDF</button>
      </div>
      <div className="text-sm text-slate-600">Tổng nợ: <b>{sumDebt.toLocaleString()}</b> đ</div>
    </div>
  );
}
