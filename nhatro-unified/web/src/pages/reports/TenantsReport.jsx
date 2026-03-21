
import React from 'react';
import { loadState } from './shared';
import { exportReportPdf } from '../../../src/utils/pdf';

export default function TenantsReport(){
  const { tenants, rooms } = loadState();
  const rows = tenants.map((t, idx)=>{
    const room = rooms.find(r=>r.tenantId===t.id || r.id===t.roomId);
    return [idx+1, t.name||'', t.cccd||'', t.phone||'', room?.name||''];
  });
  const total = tenants.length;
  const onExport = ()=> exportReportPdf({
    title: 'BÁO CÁO KHÁCH THUÊ', subtitle: `Tổng số khách thuê: ${total}`,
    columns: ['#','Họ tên','CCCD','SĐT','Phòng'], rows, summary: [`Tổng số khách thuê: ${total}`], fileName: 'tenants-report.pdf'
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Khách thuê</h3>
        <button onClick={onExport} className="rounded bg-slate-900 text-white px-3 py-1">Xuất PDF</button>
      </div>
      <div className="text-sm text-slate-600">Tổng số khách: <b>{total}</b></div>
    </div>
  );
}
