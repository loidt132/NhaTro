
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { loadState } from './utils/state';
import Sidebar from './components/Sidebar';
import Rooms from './pages/Rooms';
import Meter from './pages/Meter';
import Payments from './pages/Payments';
import Settings from './pages/Settings';
import ReportsHub from './pages/ReportsHub';

export default function App(){
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [roomCount, setRoomCount] = useState(() => (loadState().rooms || []).length);
  useEffect(() => {
    const sync = () => setRoomCount((loadState().rooms || []).length);
    window.addEventListener('boarding_state_updated', sync);
    sync();
    return () => window.removeEventListener('boarding_state_updated', sync);
  }, []);
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
              <select
                className="h-11 max-w-[9.5rem] min-w-0 shrink rounded-xl border border-slate-200 bg-white px-2 text-sm sm:max-w-none sm:px-3"
                aria-label="Vai trò"
              >
                <option>Chủ trọ</option>
                <option>Khách thuê</option>
              </select>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-1 gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:gap-4 sm:px-4 sm:pt-4">
          <Sidebar isOpen={sidebarOpen} onClose={()=>setSidebarOpen(false)} />
          <div className="min-w-0 flex-1">
            <Routes>
              <Route path="/rooms" element={<Rooms/>} />
              <Route path="/meter" element={<Meter/>} />
              <Route path="/payments" element={<Payments/>} />
              <Route path="/reports" element={<ReportsHub/>} />
              <Route path="/settings" element={<Settings/>} />
              <Route path="*" element={<Navigate to="/rooms" replace />} />
            </Routes>
          </div>
        </main>
      </div> 
    </BrowserRouter>
  );
}
