
import React from 'react';
import { loadState } from './shared';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';

export default function RoomsReport(){
  const { rooms, tenants, deposits, depositTransactions, rentPeriods, paymentAllocations } = loadState();
  const rows = rooms.map((r, idx)=>{
    const roomTenants = tenants.filter(t => t.roomId === r.id);
    const tenantNames = roomTenants.map(t => t.name).join(', ');
    const deposit = deposits.filter((item) => item.roomId === r.id && item.status === 'held').reduce((sum, item) => sum + (+item.remainingAmount || +item.amount || 0), 0);
    const depositIds = new Set(deposits.filter((item) => item.roomId === r.id).map((item) => String(item.id)));
    const refunded = depositTransactions.filter((item) => depositIds.has(String(item.depositId)) && item.type === 'refunded').reduce((sum, item) => sum + (+item.amount || 0), 0);
    const months = rentPeriods.filter((period) => period.roomId === r.id && paymentAllocations.some((allocation) => String(allocation.rentPeriodId) === String(period.id) && (+allocation.amount || 0) > 0)).map((period) => period.month).sort();
    const advanceRange = months.length ? `${months[0]} → ${months[months.length - 1]}` : '';
    return [idx+1, r.name||'', (r.baseRent||0).toLocaleString(), (r.electricRate||0).toLocaleString(), (r.waterRate||0).toLocaleString(), deposit.toLocaleString(), refunded.toLocaleString(), advanceRange, tenantNames];
  });
  const occupied = rooms.filter(r=> tenants.some(t=>t.roomId===r.id)).length;
  const summary = [`Tổng số phòng: ${rooms.length}`, `Đang có người thuê: ${occupied}`, `Còn trống: ${Math.max(0, rooms.length - occupied)}`];
  const onExport = ()=> exportReportPdf({ title: 'DANH SÁCH PHÒNG', subtitle: summary.join(' | '), columns: ['#','Phòng','Tiền phòng','Giá điện','Giá nước','Cọc còn','Đã hoàn cọc','Đóng trước','Khách'], rows, summary, fileName: 'rooms-report.pdf' });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Danh sách phòng</h3><button onClick={onExport} className="h-[29px] rounded bg-slate-900 px-2 text-[11px] text-white">Xuất PDF</button></div>
      <div className="text-sm text-slate-600">Tổng số phòng: <b>{rooms.length}</b> • Đang có người thuê: <b>{occupied}</b></div>
    </div>
  );
}
