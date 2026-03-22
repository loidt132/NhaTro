
import React from 'react';
import { NavLink } from 'react-router-dom';

const LinkItem = ({ to, icon, children, onClick }) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) =>
      'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] ' +
      (isActive ? 'bg-emerald-600 text-white active:bg-emerald-700' : 'text-slate-800 hover:bg-slate-100 active:bg-slate-100')
    }
  >
    <span className="text-xl leading-none">{icon}</span>
    <span>{children}</span>
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
      <LinkItem to="/reports" icon="📊">Báo cáo</LinkItem>
      <LinkItem to="/settings" icon="⚙️">Cài đặt</LinkItem>
    </aside>
  );

  // Mobile overlay menu
  const mobile = isOpen ? (
    <div className="fixed inset-0 z-40 md:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        className="absolute left-0 top-0 flex h-full w-[min(20rem,88vw)] flex-col bg-white shadow-xl"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          paddingRight: '0.75rem',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Menu</div>
          <button type="button" onClick={onClose} className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-lg" aria-label="Đóng menu">
            ✕
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          <LinkItem to="/rooms" icon="🏠" onClick={onClose}>Phòng trọ</LinkItem>
          <LinkItem to="/meter" icon="⚡" onClick={onClose}>Ghi điện nước</LinkItem>
          <LinkItem to="/payments" icon="💵" onClick={onClose}>Thu tiền</LinkItem>
          <LinkItem to="/reports" icon="📊" onClick={onClose}>Báo cáo</LinkItem>
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
