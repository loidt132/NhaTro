
import React from 'react';
import { loadState } from './shared';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';
import { exportStyledExcel } from '../../utils/exportExcel';

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
  const onExportExcel = () => exportStyledExcel({
    filename: 'danh-sach-phong.xlsx',
    sheetName: 'Danh sách phòng',
    title: 'Danh sách phòng',
    subtitle: summary.join(' | '),
    columns: [
      { header: '#', key: 'idx', width: 6 },
      { header: 'Phòng', key: 'name', width: 14 },
      { header: 'Tiền phòng', key: 'baseRent', width: 16, money: true },
      { header: 'Giá điện', key: 'electricRate', width: 14, money: true },
      { header: 'Giá nước', key: 'waterRate', width: 14, money: true },
      { header: 'Cọc còn', key: 'deposit', width: 16, money: true },
      { header: 'Đã hoàn cọc', key: 'refunded', width: 16, money: true },
      { header: 'Đóng trước', key: 'advanceRange', width: 20 },
      { header: 'Khách', key: 'tenantNames', width: 26 },
    ],
    rows: rows.map(([idx, name, baseRent, electricRate, waterRate, deposit, refunded, advanceRange, tenantNames]) => ({
      idx, name, baseRent: baseRent.replaceAll(',', ''), electricRate: electricRate.replaceAll(',', ''), waterRate: waterRate.replaceAll(',', ''), deposit: deposit.replaceAll(',', ''), refunded: refunded.replaceAll(',', ''), advanceRange, tenantNames,
    })),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Danh sách phòng</h3>
        <div className="flex gap-2">
          <button onClick={onExportExcel} className="h-[29px] rounded bg-emerald-600 px-2 text-[11px] text-white">Xuất Excel</button>
          <button onClick={onExport} className="h-[29px] rounded bg-slate-900 px-2 text-[11px] text-white">Xuất PDF</button>
        </div>
      </div>
      <div className="text-sm text-slate-600">Tổng số phòng: <b>{rooms.length}</b> • Đang có người thuê: <b>{occupied}</b></div>
    </div>
  );
}
