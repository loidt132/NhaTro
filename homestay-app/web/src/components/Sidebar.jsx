import { NavLink } from "react-router-dom";
import { useAuth } from "../AuthContext.js";

const LinkItem = ({ to, icon, children, onClick }) => (
  <NavLink
    to={to}
    end={to === "/"}
    onClick={onClick}
    className={({ isActive }) =>
      "flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] " +
      (isActive ? "bg-emerald-600 text-white" : "text-slate-800 hover:bg-slate-100")
    }
  >
    <span className="text-xl leading-none">{icon}</span>
    <span>{children}</span>
  </NavLink>
);

const LINKS = [
  { to: "/", icon: "🛎️", label: "Sơ đồ phòng" },
  { to: "/history", icon: "🧾", label: "Lịch sử & hoá đơn" },
  { to: "/rate-plans", icon: "💰", label: "Bảng giá phòng" },
  { to: "/service-catalog", icon: "🧺", label: "Dịch vụ & phụ thu" },
  { to: "/reports", icon: "📊", label: "Báo cáo" },
  { to: "/guest-report", icon: "📋", label: "Báo cáo lưu trú" },
  { to: "/settings", icon: "⚙️", label: "Cài đặt" },
];

const OWNER_LINK = { to: "/homestays", icon: "🏘️", label: "Quản lý Homestay" };

export default function Sidebar({ isOpen = false, onClose = () => {} }) {
  const { user } = useAuth();
  const links = user?.role === "owner" ? [OWNER_LINK, ...LINKS] : LINKS;

  const desktop = (
    <aside className="hidden md:block w-56 shrink-0 space-y-2 p-3">
      <div className="text-sm font-semibold uppercase text-slate-500">Homestay</div>
      {links.map((l) => (
        <LinkItem key={l.to} to={l.to} icon={l.icon}>{l.label}</LinkItem>
      ))}
    </aside>
  );

  const mobile = isOpen ? (
    <div className="fixed inset-0 z-40 md:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="absolute left-0 top-0 flex h-full w-[min(20rem,88vw)] flex-col bg-white p-3 shadow-xl">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Menu</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-lg"
            aria-label="Đóng menu"
          >
            ✕
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {links.map((l) => (
            <LinkItem key={l.to} to={l.to} icon={l.icon} onClick={onClose}>{l.label}</LinkItem>
          ))}
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
