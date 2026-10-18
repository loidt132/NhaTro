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
import HomestayAdmin from "./pages/HomestayAdmin.jsx";
import { AuthContext } from "./AuthContext.js";
import { HomestayContext } from "./HomestayContext.js";
import { clearAuth, loadAuth, saveAuth } from "./auth.js";
import { setUnauthorizedHandler, setCurrentHomestayId as setApiHomestayId, ownerApi } from "./api.js";

const SELECTED_HOMESTAY_KEY = "homestay_selected_v1";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [auth, setAuth] = useState(() => loadAuth());
  const [homestays, setHomestays] = useState([]);
  // Lazy initializer runs synchronously before any child mounts — admin/
  // staff's fixed homestayId must be in api.js's module state before e.g.
  // RoomBoard's own mount-time fetch fires, or that very first call 400s
  // for missing X-Homestay-Id. Owner has no fixed id yet; resolved async
  // below once their homestay list loads.
  const [currentHomestayId, setCurrentHomestayIdState] = useState(() => {
    const initial = loadAuth();
    if (initial && initial.user.role !== "owner") {
      setApiHomestayId(initial.user.homestayId);
      return initial.user.homestayId;
    }
    return null;
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAuth();
      setAuth(null);
    });
  }, []);

  // admin/staff are pinned to their own homestay; owner starts from
  // whatever was last picked (or the first homestay once the list loads).
  useEffect(() => {
    if (!auth) return;
    if (auth.user.role !== "owner") {
      selectHomestay(auth.user.homestayId);
      return;
    }
    refreshHomestays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function refreshHomestays(preferId) {
    const rows = await ownerApi.listHomestays();
    setHomestays(rows);
    const saved = preferId || localStorage.getItem(SELECTED_HOMESTAY_KEY);
    const resolved = rows.find((h) => h.id === saved)?.id || rows[0]?.id || null;
    selectHomestay(resolved);
    return rows;
  }

  function selectHomestay(id) {
    setCurrentHomestayIdState(id);
    setApiHomestayId(id);
    if (id) localStorage.setItem(SELECTED_HOMESTAY_KEY, id);
  }

  function logout() {
    clearAuth();
    setApiHomestayId(null);
    setAuth(null);
    setHomestays([]);
    setCurrentHomestayIdState(null);
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

  const isOwner = auth.user.role === "owner";
  const currentHomestayName = isOwner
    ? homestays.find((h) => h.id === currentHomestayId)?.name || "Chọn homestay"
    : auth.user.homestayName || "";

  return (
    <AuthContext.Provider value={{ user: auth.user, logout }}>
      <HomestayContext.Provider value={{ currentHomestayId, homestays, setCurrentHomestayId: selectHomestay, refreshHomestays }}>
        <div className="flex min-h-screen min-h-[100dvh] flex-col bg-slate-50">
          <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <div className="h-9 w-9 shrink-0 rounded-2xl bg-emerald-600 sm:h-10 sm:w-10" aria-hidden />
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold leading-tight sm:text-xl">
                    {isOwner ? "Quản lý Homestay" : currentHomestayName || "Quản lý Homestay"}
                  </div>
                  <div className="text-[11px] leading-snug text-slate-500 sm:text-xs">
                    Đặt phòng theo giờ/đêm/ngày · Dịch vụ · Phụ thu
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isOwner && (
                  <select
                    value={currentHomestayId || ""}
                    onChange={(e) => selectHomestay(e.target.value)}
                    className="hidden rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm sm:block"
                  >
                    {homestays.length === 0 && <option value="">Chưa có homestay</option>}
                    {homestays.map((h) => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                )}
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-medium text-slate-800">{auth.user.name}</div>
                  <div className="text-xs text-slate-500">
                    {auth.user.role === "owner" ? "Chủ hệ thống" : auth.user.role === "admin" ? "Quản trị viên" : "Nhân viên"}
                  </div>
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
            <div className="min-w-0 flex-1 space-y-3">
              {isOwner && !currentHomestayId && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Chưa có homestay nào — tạo mới ở "Quản lý Homestay" bên dưới.
                </div>
              )}
              <Routes>
                <Route path="/" element={<RoomBoard />} />
                <Route path="/stays/:stayId" element={<StayDetail />} />
                <Route path="/rate-plans" element={<RatePlanAdmin />} />
                <Route path="/service-catalog" element={<ServiceCatalogAdmin />} />
                <Route path="/guest-report" element={<GuestReport />} />
                <Route path="/reports" element={<ReportsHub />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/homestays" element={<HomestayAdmin />} />
              </Routes>
            </div>
          </main>
        </div>
      </HomestayContext.Provider>
    </AuthContext.Provider>
  );
}
