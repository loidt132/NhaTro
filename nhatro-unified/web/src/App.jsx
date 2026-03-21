
import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Rooms from './pages/Rooms';
import Meter from './pages/Meter';
import Payments from './pages/Payments';
import Settings from './pages/Settings';

export default function App(){
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-10 border-b bg-white/70 backdrop-blur">
          <div className="mx-auto max-w-7xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-emerald-600" />
              <div>
                <div className="text-xl font-bold">Quản lý trọ</div>
                <div className="text-xs text-slate-500">Phòng • Điện/Nước • Thu tiền</div>
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
              <Route path="/settings" element={<Settings/>} />
              <Route path="*" element={<Navigate to="/rooms" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}
