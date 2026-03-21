
import React from 'react';
import { NavLink } from 'react-router-dom';

const LinkItem = ({ to, icon, children, onClick }) => (
  <NavLink to={to} onClick={onClick} className={({isActive})=> 'flex items-center gap-2 px-3 py-2 rounded-lg '+(isActive? 'bg-emerald-600 text-white':'hover:bg-slate-100')}>
    <span className="text-lg">{icon}</span><span>{children}</span>
  </NavLink>
);

export default function Sidebar({ isOpen=false, onClose=()=>{} }){
  // Desktop sidebar
  const desktop = (
    <aside className="hidden md:block w-56 shrink-0 p-3 space-y-2">
      <div className="text-sm font-semibold text-slate-500 uppercase">Quản lý trọ</div>
      <LinkItem to="/rooms" icon="🏠">Phòng trọ</LinkItem>
      <LinkItem to="/meter" icon="⚡">Ghi điện nước</LinkItem>
      <LinkItem to="/payments" icon="💵">Thu tiền</LinkItem>
      <LinkItem to="/settings" icon="⚙️">Cài đặt</LinkItem>
    </aside>
  );

  // Mobile overlay menu
  const mobile = isOpen ? (
    <div className="md:hidden fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-0 top-0 h-full w-64 bg-white p-3 shadow-lg overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-500 uppercase">Menu</div>
          <button onClick={onClose} className="rounded p-1">✕</button>
        </div>
        <nav className="space-y-1">
          <LinkItem to="/rooms" icon="🏠" onClick={onClose}>Phòng trọ</LinkItem>
          <LinkItem to="/meter" icon="⚡" onClick={onClose}>Ghi điện nước</LinkItem>
          <LinkItem to="/payments" icon="💵" onClick={onClose}>Thu tiền</LinkItem>
          <LinkItem to="/settings" icon="⚙️" onClick={onClose}>Cài đặt</LinkItem>
        </nav>
      </div>
    </div>
  ) : null;

  return (
    <>
      {desktop}
      {mobile}
    </>
  );
}
