
import React from 'react';
import { Link } from 'react-router-dom';
import { currency } from '../utils/state';
export default function TotalsBar({ sumAdvance=0, sumPaid=0, sumDebt=0, month='' }){
  const advance = Number(sumAdvance || 0);
  const paid = Number(sumPaid || 0);
  const debt = Number(sumDebt || 0);
  const sumMonthlyDue = advance + paid + debt;
  const handledPercent = sumMonthlyDue > 0 ? Math.min(debt > 0 ? 99.9 : 100, ((advance + paid) / sumMonthlyDue) * 100) : 0;
  const displayPercent = handledPercent % 1 === 0 ? String(handledPercent) : handledPercent.toFixed(1);
  const monthQuery = month ? `?month=${encodeURIComponent(month)}` : '';
  const Detail = ({ label, value, tone, to }) => (
    <Link to={to} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0 rounded transition hover:bg-slate-50">
      <span className="text-xs text-slate-500 sm:text-sm">{label}</span>
      <strong className={`shrink-0 text-sm font-semibold tabular-nums sm:text-base ${tone}`}>{currency(value)} đ</strong>
    </Link>
  );
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(13rem,0.8fr)] md:gap-6">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Tình hình thu</div>
          <div className="mt-1 text-xs text-slate-500 sm:text-sm">Tổng tiền cần quản lý</div>
          <Link to={`/payments${monthQuery}`} className="mt-1 block truncate text-2xl font-semibold tabular-nums text-slate-800 hover:text-slate-600 sm:text-3xl">{currency(sumMonthlyDue)} đ</Link>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Tỷ lệ tiền đã xử lý" aria-valuemin="0" aria-valuemax="100" aria-valuenow={handledPercent}>
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${handledPercent}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-slate-500"><span>Đã xử lý</span><span className="font-medium text-slate-700">{displayPercent}%</span></div>
        </div>
        <div className="grid gap-x-4 sm:grid-cols-3 md:grid-cols-1 md:border-l md:border-slate-100 md:pl-6">
          <Detail label="Đã thu" value={paid} tone="text-emerald-700" to={`/payments?status=paid${month ? `&month=${encodeURIComponent(month)}` : ''}`} />
          <Detail label="Đóng trước" value={advance} tone="text-sky-700" to={`/reports?tab=advance${month ? `&month=${encodeURIComponent(month)}` : ''}`} />
          <Detail label="Còn nợ" value={debt} tone="text-rose-700" to={`/payments?status=debt${month ? `&month=${encodeURIComponent(month)}` : ''}`} />
        </div>
      </div>
    </section>
  );
}
