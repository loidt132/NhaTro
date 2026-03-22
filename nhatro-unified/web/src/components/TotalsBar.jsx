
import React from 'react';
import { currency } from '../utils/state';
export default function TotalsBar({ sumPaid=0, sumDebt=0 }){
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3">
      <div className="min-w-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="text-xs text-emerald-800/80 sm:text-sm">Đã thanh toán</div>
        <div className="truncate text-lg font-semibold tabular-nums text-emerald-700 sm:text-xl">{currency(sumPaid)} đ</div>
      </div>
      <div className="min-w-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="text-xs text-rose-800/80 sm:text-sm">Còn nợ</div>
        <div className="truncate text-lg font-semibold tabular-nums text-rose-700 sm:text-xl">{currency(sumDebt)} đ</div>
      </div>
    </div>
  );
}
