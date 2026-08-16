import React, { useMemo } from 'react';
import { loadState, currency, monthKey } from '../../utils/state';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';

const addMonth = (ym) => {
  const [year, month] = String(ym).split('-').map(Number);
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export default function AdvanceReport(){
  const { rooms = [], tenants = [], rentPeriods = [], paymentAllocations = [] } = loadState();
  const currentMonth = monthKey();
  const rows = useMemo(() => rooms.map((room) => {
    const periods = rentPeriods.filter((period) => String(period.roomId) === String(room.id) && paymentAllocations.some((allocation) => String(allocation.rentPeriodId || '') === String(period.id) && (Number(allocation.amount) || 0) > 0)).sort((a, b) => a.month.localeCompare(b.month));
    if (!periods.length) return null;
    const total = periods.reduce((sum, period) => sum + paymentAllocations.filter((allocation) => String(allocation.rentPeriodId || '') === String(period.id)).reduce((subTotal, allocation) => subTotal + (Number(allocation.amount) || 0), 0), 0);
    const tenantNames = tenants.filter((tenant) => String(tenant.roomId) === String(room.id)).map((tenant) => tenant.name).join(', ');
    const paidTo = periods.at(-1).month;
    const dueMonth = addMonth(paidTo);
    return { room, tenantNames, from: periods[0].month, paidTo, dueMonth, total, dueSoon: dueMonth <= addMonth(currentMonth) };
  }).filter(Boolean), [rooms, tenants, rentPeriods, paymentAllocations, currentMonth]);
  const totalAdvance = rows.reduce((sum, row) => sum + row.total, 0);
  const dueSoon = rows.filter((row) => row.dueSoon);
  const exportPdf = () => exportReportPdf({ title: 'BÁO CÁO ĐÓNG TRƯỚC', subtitle: `Kỳ hiện tại: ${currentMonth}`, columns: ['#', 'Phòng', 'Khách', 'Đóng từ', 'Đã đóng đến', 'Đóng lại từ', 'Tổng đóng trước', 'Trạng thái'], rows: rows.map((row, index) => [index + 1, row.room.name, row.tenantNames, row.from, row.paidTo, row.dueMonth, currency(row.total), row.dueSoon ? 'Sắp đến hạn' : 'Còn kỳ đóng trước']), summary: [`Tổng tiền đóng trước: ${currency(totalAdvance)} đ`, `Sắp đến hạn đóng lại: ${dueSoon.length} phòng`], fileName: `advance-report-${currentMonth}.pdf` });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Báo cáo đóng trước</h3><button onClick={exportPdf} className="h-[29px] rounded bg-slate-900 px-2 text-[11px] text-white">Xuất PDF</button></div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">Đang có <b>{currency(totalAdvance)} đ</b> tiền đóng trước. <b>{dueSoon.length}</b> phòng sắp cần đóng lại trong tháng này hoặc tháng kế tiếp.</div>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-[760px] w-full text-sm"><thead><tr className="border-b bg-slate-50 text-left text-slate-500"><th className="p-2">Phòng</th><th className="p-2">Khách</th><th className="p-2">Đóng trước</th><th className="p-2">Đã đóng đến</th><th className="p-2">Đóng lại từ</th><th className="p-2 text-right">Tổng tiền</th><th className="p-2">Trạng thái</th></tr></thead><tbody>{rows.map((row) => <tr key={row.room.id} className="border-b last:border-0"><td className="p-2 font-medium">{row.room.name}</td><td className="p-2">{row.tenantNames}</td><td className="p-2">{row.from}</td><td className="p-2">{row.paidTo}</td><td className="p-2">{row.dueMonth}</td><td className="p-2 text-right tabular-nums">{currency(row.total)} đ</td><td className="p-2"><span className={row.dueSoon ? 'text-amber-700' : 'text-emerald-700'}>{row.dueSoon ? 'Sắp đến hạn' : 'Còn kỳ đóng trước'}</span></td></tr>)}</tbody></table></div>
    </div>
  );
}
