import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";
import Login from "./pages/Login.jsx";
import RoomBoard from "./pages/RoomBoard.jsx";
import StayDetail from "./pages/StayDetail.jsx";
import ServiceCatalogAdmin from "./pages/ServiceCatalogAdmin.jsx";
import RatePlanAdmin from "./pages/RatePlanAdmin.jsx";
import GuestReport from "./pages/GuestReport.jsx";
import ReportsHub from "./pages/ReportsHub.jsx";
import Settings from "./pages/Settings.jsx";
import { AuthContext } from "./AuthContext.js";
import { clearAuth, loadAuth, saveAuth } from "./auth.js";
import { setUnauthorizedHandler } from "./api.js";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [auth, setAuth] = useState(() => loadAuth());

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAuth();
      setAuth(null);
    });
  }, []);

  function logout() {
    clearAuth();
    setAuth(null);
  }

  if (!auth) {
    return (
      <Login
        onLoggedIn={(result) => {
          saveAuth(result);
          setAuth(result);
        }}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ user: auth.user, logout }}>
      <div className="flex min-h-screen min-h-[100dvh] flex-col bg-slate-50">
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <div className="h-9 w-9 shrink-0 rounded-2xl bg-emerald-600 sm:h-10 sm:w-10" aria-hidden />
              <div className="min-w-0">
                <div className="truncate text-lg font-bold leading-tight sm:text-xl">Quản lý Homestay</div>
                <div className="text-[11px] leading-snug text-slate-500 sm:text-xs">
                  Đặt phòng theo giờ/đêm/ngày · Dịch vụ · Phụ thu
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden text-right sm:block">
                <div className="text-sm font-medium text-slate-800">{auth.user.name}</div>
                <div className="text-xs text-slate-500">{auth.user.role === "admin" ? "Quản trị viên" : "Nhân viên"}</div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50"
              >
                Đăng xuất
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg md:hidden"
                aria-label="Mở menu"
              >
                ☰
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-1 gap-3 px-3 pb-6 pt-3 sm:gap-4 sm:px-4 sm:pt-4">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="min-w-0 flex-1">
            <Routes>
              <Route path="/" element={<RoomBoard />} />
              <Route path="/stays/:stayId" element={<StayDetail />} />
              <Route path="/rate-plans" element={<RatePlanAdmin />} />
              <Route path="/service-catalog" element={<ServiceCatalogAdmin />} />
              <Route path="/guest-report" element={<GuestReport />} />
              <Route path="/reports" element={<ReportsHub />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>
      </div>
    </AuthContext.Provider>
  );
}
