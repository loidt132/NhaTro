
import React from 'react';
export default function TopStats({ rooms=0, tenants=0, invoices=0, debts=0 }){
  const Item = ({label, value, color}) => (
    <div className={`flex-1 rounded-2xl px-4 py-3 ${color} text-slate-700`}> 
      <div className="text-sm opacity-70">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Item label="Phòng" value={rooms} color="bg-emerald-100" />
      <Item label="Khách thuê" value={tenants} color="bg-teal-100" />
      <Item label="Hóa đơn" value={invoices} color="bg-amber-100" />
      <Item label="Còn nợ" value={debts} color="bg-rose-100" />
    </div>
  );
}
