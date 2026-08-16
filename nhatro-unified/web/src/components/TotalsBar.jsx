
import React from 'react';
import { currency } from '../utils/state';
export default function TotalsBar({ sumAdvance=0, sumPaid=0, sumDebt=0 }){
  // Total due is independent from when it was paid: prepaid rent + invoice
  // payments already received + the outstanding balance.
  const sumMonthlyDue = Number(sumAdvance || 0) + Number(sumPaid || 0) + Number(sumDebt || 0);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 sm:gap-3">
      <div className="min-w-0 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="text-xs text-violet-800/80 sm:text-sm">Tổng phải thu</div>
        <div className="truncate text-lg font-semibold tabular-nums text-violet-700 sm:text-xl">{currency(sumMonthlyDue)} đ</div>
      </div>
      <div className="min-w-0 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="text-xs text-sky-800/80 sm:text-sm">Đóng trước tiền phòng</div>
        <div className="truncate text-lg font-semibold tabular-nums text-sky-700 sm:text-xl">{currency(sumAdvance)} đ</div>
      </div>
      <div className="min-w-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="text-xs text-emerald-800/80 sm:text-sm">Đã thu hóa đơn</div>
        <div className="truncate text-lg font-semibold tabular-nums text-emerald-700 sm:text-xl">{currency(sumPaid)} đ</div>
      </div>
      <div className="min-w-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="text-xs text-rose-800/80 sm:text-sm">Còn nợ</div>
        <div className="truncate text-lg font-semibold tabular-nums text-rose-700 sm:text-xl">{currency(sumDebt)} đ</div>
      </div>
    </div>
  );
}
