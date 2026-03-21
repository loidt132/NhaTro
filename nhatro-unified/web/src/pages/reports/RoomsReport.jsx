
import React from 'react';
import { loadState } from './shared';
import { exportReportPdf } from '../../../src/utils/pdf';

export default function RoomsReport(){
  const { rooms, tenants } = loadState();
  const rows = rooms.map((r, idx)=>{
    const t = r.tenantId ? tenants.find(x=>x.id===r.tenantId) : tenants.find(x=>x.roomId===r.id);
    return [idx+1, r.name||'', (r.baseRent||0).toLocaleString(), (r.electricRate||0).toLocaleString(), (r.waterRate||0).toLocaleString(), t?.name||''];
  });
  const occupied = rooms.filter(r=> tenants.some(t=>t.roomId===r.id || t.id===r.tenantId)).length;
  const summary = [`Tổng số phòng: ${rooms.length}`, `Đang có người thuê: ${occupied}`, `Còn trống: ${Math.max(0, rooms.length - occupied)}`];
  const onExport = ()=> exportReportPdf({ title: 'BÁO CÁO PHÒNG', subtitle: summary.join(' | '), columns: ['#','Phòng','Tiền phòng','Giá điện','Giá nước','Khách'], rows, summary, fileName: 'rooms-report.pdf' });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Phòng</h3><button onClick={onExport} className="rounded bg-slate-900 text-white px-3 py-1">Xuất PDF</button></div>
      <div className="text-sm text-slate-600">Tổng số phòng: <b>{rooms.length}</b> • Đang có người thuê: <b>{occupied}</b></div>
    </div>
  );
}
