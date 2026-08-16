import React from 'react';
import { Link } from 'react-router-dom';

export default function TopStats({ rooms = 0, tenants = 0, invoices = 0, debts = 0, roomTo = '/rooms', tenantTo = '/tenants', invoiceTo = '/payments?status=invoice', debtTo = '/payments?status=debt' }) {
  const Item = ({ label, value, icon, tone = 'text-slate-700', to }) => (
    <Link to={to} className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-2 text-center shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:px-3 sm:py-2.5">
      <div className="text-base leading-none sm:text-lg" aria-hidden="true">{icon}</div>
      <div className={`mt-1 truncate text-xs font-medium tabular-nums sm:text-sm ${tone}`}>{value} {label}</div>
    </Link>
  );

  return (
    <div className="grid min-w-0 grid-cols-4 gap-2 sm:gap-3">
      <Item label="phòng" value={rooms} icon="🏠" to={roomTo} />
      <Item label="khách" value={tenants} icon="👤" to={tenantTo} />
      <Item label="HĐ" value={invoices} icon="📄" to={invoiceTo} />
      <Item label="còn nợ" value={debts} icon="🔴" tone="text-rose-700" to={debtTo} />
    </div>
  );
}
