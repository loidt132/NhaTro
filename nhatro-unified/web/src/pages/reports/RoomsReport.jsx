
import React from 'react';
import { loadState } from './shared';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';

export default function RoomsReport(){
  const { rooms, tenants } = loadState();
  const rows = rooms.map((r, idx)=>{
    const roomTenants = tenants.filter(t => t.roomId === r.id);
    const tenantNames = roomTenants.map(t => t.name).join(', ');
    return [idx+1, r.name||'', (r.baseRent||0).toLocaleString(), (r.electricRate||0).toLocaleString(), (r.waterRate||0).toLocaleString(), tenantNames];
  });
  const occupied = rooms.filter(r=> tenants.some(t=>t.roomId===r.id)).length;
  const summary = [`Tổng số phòng: ${rooms.length}`, `Đang có người thuê: ${occupied}`, `Còn trống: ${Math.max(0, rooms.length - occupied)}`];
  const onExport = ()=> exportReportPdf({ title: 'DANH SÁCH PHÒNG', subtitle: summary.join(' | '), columns: ['#','Phòng','Tiền phòng','Giá điện','Giá nước','Khách'], rows, summary, fileName: 'rooms-report.pdf' });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Danh sách phòng</h3><button onClick={onExport} className="rounded bg-slate-900 text-white px-3 py-1">Xuất PDF</button></div>
      <div className="text-sm text-slate-600">Tổng số phòng: <b>{rooms.length}</b> • Đang có người thuê: <b>{occupied}</b></div>
    </div>
  );
}
