
import React from 'react';
import { loadState } from './shared';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';

export default function TenantsReport(){
  const { tenants, rooms } = loadState();
  const rows = tenants.map((t, idx)=>{
    const room = rooms.find(r=>r.tenantId===t.id || r.id===t.roomId);
    return [idx+1, t.name||'', t.cccd||'', t.phone||'', room?.name||'', t.startDate||'', t.endDate||''];
  });
  const total = tenants.length;
  const onExport = ()=> exportReportPdf({
    title: 'DANH SÁCH KHÁCH THUÊ', subtitle: `Tổng số khách thuê: ${total}`,
    columns: ['#','Họ tên','CCCD','SĐT','Phòng', 'Ngày bắt đầu', 'Ngày kết thúc'], rows, summary: [`Tổng số khách thuê: ${total}`], fileName: 'tenants-report.pdf'
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Danh sách khách</h3>
        <button onClick={onExport} className="rounded bg-slate-900 text-white px-3 py-1">Xuất PDF</button>
      </div>
      <div className="text-sm text-slate-600">Tổng số khách: <b>{total}</b></div>
    </div>
  );
}
