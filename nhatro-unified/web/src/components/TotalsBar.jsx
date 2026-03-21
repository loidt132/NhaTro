
import React from 'react';
import { currency } from '../utils/state';
export default function TotalsBar({ sumPaid=0, sumDebt=0 }){
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
        <div className="text-sm text-emerald-800 opacity-80">Tổng đã thanh toán</div>
        <div className="text-xl font-semibold text-emerald-700">{currency(sumPaid)} đ</div>
      </div>
      <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3">
        <div className="text-sm text-rose-800 opacity-80">Tổng còn nợ</div>
        <div className="text-xl font-semibold text-rose-700">{currency(sumDebt)} đ</div>
      </div>
    </div>
  );
}
