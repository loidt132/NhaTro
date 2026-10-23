import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getAdminViewUserId, loadState, reloadStateForAdminView, resetStateSession, setAdminViewUserId } from './utils/state';
import { roomsApi } from './utils/api/tables';
import { clearAuth, fetchCurrentUser, getStoredToken, loginAccount, registerAccount, setStoredToken } from './utils/auth';
import Sidebar from './components/Sidebar';
import Rooms from './pages/Rooms';
import Tenants from './pages/Tenants';
import Meter from './pages/Meter';
import Payments from './pages/Payments';
import ServiceOrders from './pages/ServiceOrders';
import ServiceCatalog from './pages/ServiceCatalog';
import Settings from './pages/Settings';
import ReportsHub from './pages/ReportsHub';
import Auth from './pages/Auth';
import TenantAuth from './pages/TenantAuth';
import TenantMeterUpload from './pages/TenantMeterUpload';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authView, setAuthView] = useState('landlord'); // 'landlord' | 'tenant'
  const [user, setUser] = useState(null);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminViewUserId, setAdminViewUserIdState] = useState(() => getAdminViewUserId());
  const [adminViewLoading, setAdminViewLoading] = useState(false);
  const [roomCount, setRoomCount] = useState(0);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthReady(true);
      return;
    }

    fetchCurrentUser(token)
      .then(({ user: currentUser }) => {
        setUser(currentUser);
      })
      .catch(() => {
        clearAuth();
        setUser(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (String(user?.role || '').toLowerCase() !== 'admin') return;
    const token = getStoredToken();
    fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setAdminUsers(data?.users || []))
      .catch(() => setAdminUsers([]));
  }, [user]);

  const changeAdminView = async (userId) => {
    setAdminViewUserId(userId);
    setAdminViewUserIdState(userId);
    setAdminViewLoading(true);
    try {
      await reloadStateForAdminView();
      roomsApi.list().then((rows) => setRoomCount(rows.length)).catch(() => {});
    } finally {
      setAdminViewLoading(false);
    }
  };

  useEffect(() => {
    const sync = () => {
      roomsApi.list().then((rows) => setRoomCount(rows.length)).catch(() => {});
    };
    // 'rooms_table_changed' only (tables.js), not the bulk-sync event — the
    // room count only needs to react to actual room create/update/delete.
    window.addEventListener('rooms_table_changed', sync);
    if (getStoredToken()) sync();
    return () => window.removeEventListener('rooms_table_changed', sync);
  }, []);

  useEffect(() => {
    const onSaveError = (event) => setSaveError(event.detail?.message || 'Không thể lưu dữ liệu');
    window.addEventListener('boarding_state_save_error', onSaveError);
    return () => window.removeEventListener('boarding_state_save_error', onSaveError);
  }, []);

  const handleAuthSuccess = ({ token, user: currentUser }) => {
    setStoredToken(token);
    resetStateSession();
    setUser(currentUser);
    setAuthError('');
  };

  const handleLogin = async (payload) => {
    setAuthBusy(true);
    setAuthError('');
    try {
      const result = await loginAccount(payload);
      handleAuthSuccess(result);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRegister = async (payload) => {
    setAuthBusy(true);
    setAuthError('');
    try {
      const result = await registerAccount(payload);
      handleAuthSuccess(result);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    resetStateSession();
    setUser(null);
    setSidebarOpen(false);
  };

  if (!authReady) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  if (!user) {
    if (authView === 'tenant') {
      return <TenantAuth onAuthSuccess={handleAuthSuccess} onBack={() => setAuthView('landlord')} />;
    }
    return (
      <Auth
        onLogin={handleLogin}
        onRegister={handleRegister}
        onTenantLoginClick={() => setAuthView('tenant')}
        busy={authBusy}
        error={authError}
      />
    );
  }

  if (String(user?.role || '').toLowerCase() === 'tenant') {
    return (
      <div className="min-h-screen min-h-[100dvh] bg-slate-50 flex flex-col">
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/70">
          <div className="mx-auto max-w-3xl flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 pt-[max(0.625rem,env(safe-area-inset-top))]">
            <div className="min-w-0">
              <div className="truncate text-lg font-bold leading-tight sm:text-xl">Ảnh công tơ</div>
              <div className="text-[11px] leading-snug text-slate-500 sm:text-xs">{user.name || user.phone}</div>
            </div>
            <button type="button" onClick={handleLogout} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm">
              Đăng xuất
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:pt-4">
          <TenantMeterUpload user={user} />
        </main>
      </div>
    );
  }

  return (
    <BrowserRouter future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}>
      <div className="min-h-screen min-h-[100dvh] bg-slate-50 flex flex-col">
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/70">
          <div className="mx-auto max-w-7xl flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 pt-[max(0.625rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <div className="h-9 w-9 shrink-0 rounded-2xl bg-emerald-600 sm:h-10 sm:w-10" aria-hidden />
              <div className="min-w-0">
                <div className="truncate text-lg font-bold leading-tight sm:text-xl">Quản lý trọ</div>
                <div className="text-[11px] leading-snug text-slate-500 sm:text-xs">
                  <span className="font-medium text-slate-700">{roomCount} phòng</span>
                  <span className="hidden sm:inline">
                    <span className="text-slate-400"> · </span>
                    Điện/Nước • Thu tiền
                  </span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg md:hidden"
                aria-label="Mở menu"
              >
                ☰
              </button>
              <div className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm sm:block">
                <div className="font-medium text-slate-800">{user.name}</div>
                <div className="text-xs text-slate-500">{user.email || user.phone}</div>
              </div>
              {String(user?.role || '').toLowerCase() === 'admin' && (
                <select disabled={adminViewLoading} value={adminViewUserId} onChange={(event) => changeAdminView(event.target.value)} className="w-32 max-w-48 rounded-xl border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-900 disabled:opacity-60 sm:w-48 sm:text-sm">
                  <option value="">Xem: tài khoản tôi</option>
                  {adminUsers.filter((account) => String(account.id) !== String(user.id) && account.isActive !== false).map((account) => <option key={account.id} value={account.id}>Xem: {account.name || account.email || account.phone}</option>)}
                </select>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </header>
        {saveError && (
          <div className="mx-auto mt-3 w-full max-w-7xl px-3 sm:px-4">
            <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <span>Lưu dữ liệu thất bại: {saveError}</span>
              <button type="button" onClick={() => setSaveError('')} className="shrink-0 font-medium text-red-700 hover:underline">
                Đóng
              </button>
            </div>
          </div>
        )}
        <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-1 gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:gap-4 sm:px-4 sm:pt-4">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="min-w-0 flex-1">
            <Routes>
              <Route path="/rooms" element={<Rooms />} />
              <Route path="/tenants" element={<Tenants />} />
              <Route path="/meter" element={<Meter />} />
              <Route path="/service-orders" element={<ServiceOrders />} />
              <Route path="/service-catalog" element={<ServiceCatalog />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/reports" element={<ReportsHub />} />
              <Route path="/settings" element={<Settings user={user} />} />
              <Route path="*" element={<Navigate to="/rooms" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}
