
import React from 'react';
import { loadState } from './shared';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';
import { exportStyledExcel } from '../../utils/exportExcel';

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
  const onExportExcel = () => exportStyledExcel({
    filename: 'danh-sach-khach.xlsx',
    sheetName: 'Khách thuê',
    title: 'Danh sách khách thuê',
    subtitle: `Tổng số khách thuê: ${total}`,
    columns: [
      { header: '#', key: 'idx', width: 6 },
      { header: 'Họ tên', key: 'name', width: 24 },
      { header: 'CCCD', key: 'cccd', width: 16 },
      { header: 'SĐT', key: 'phone', width: 14 },
      { header: 'Phòng', key: 'room', width: 12 },
      { header: 'Ngày bắt đầu', key: 'startDate', width: 14 },
      { header: 'Ngày kết thúc', key: 'endDate', width: 14 },
    ],
    rows: rows.map(([idx, name, cccd, phone, room, startDate, endDate]) => ({ idx, name, cccd, phone, room, startDate, endDate })),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Danh sách khách</h3>
        <div className="flex gap-2">
          <button onClick={onExportExcel} className="h-[29px] rounded bg-emerald-600 px-2 text-[11px] text-white">Xuất Excel</button>
          <button onClick={onExport} className="h-[29px] rounded bg-slate-900 px-2 text-[11px] text-white">Xuất PDF</button>
        </div>
      </div>
      <div className="text-sm text-slate-600">Tổng số khách: <b>{total}</b></div>
    </div>
  );
}
