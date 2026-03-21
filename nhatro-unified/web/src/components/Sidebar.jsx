
import React from 'react';
import { NavLink } from 'react-router-dom';
const LinkItem = ({ to, icon, children }) => (
  <NavLink to={to} className={({isActive})=> 'flex items-center gap-2 px-3 py-2 rounded-lg '+(isActive?'bg-emerald-600 text-white':'hover:bg-slate-100')}>
    <span className="text-lg">{icon}</span><span>{children}</span>
  </NavLink>
);
export default function Sidebar(){
  return (
    <aside className="w-56 shrink-0 p-3 space-y-2">
      <div className="text-sm font-semibold text-slate-500 uppercase">Quản lý trọ</div>
      <LinkItem to="/rooms" icon="🏠">Phòng trọ</LinkItem>
      <LinkItem to="/meter" icon="⚡">Ghi điện nước</LinkItem>
      <LinkItem to="/payments" icon="💵">Thu tiền</LinkItem>
      <LinkItem to="/settings" icon="⚙️">Cài đặt</LinkItem>
    </aside>
  );
}
