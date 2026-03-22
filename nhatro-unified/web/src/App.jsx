
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
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-10 border-b bg-white/70 backdrop-blur">
          <div className="mx-auto max-w-7xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-emerald-600" />
              <div>
                <div className="text-xl font-bold">Quản lý trọ</div>
                <div className="text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{roomCount} phòng</span>
                  <span className="text-slate-400"> · </span>
                  Điện/Nước • Thu tiền
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setSidebarOpen(true)} className="md:hidden rounded-lg p-2 border">☰</button>
              <select className="rounded-xl border px-3 py-2"><option>Chủ trọ</option><option>Khách thuê</option></select>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-4 flex gap-4">
          <Sidebar isOpen={sidebarOpen} onClose={()=>setSidebarOpen(false)} />
          <div className="flex-1">
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
