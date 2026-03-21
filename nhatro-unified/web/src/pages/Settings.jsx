// src/pages/Settings.jsx
import React, { useState } from 'react';
import { loadState, saveState } from '../utils/state';
import Footer from '../components/Footer';
import Page from '../components/Page';

export default function Settings() {
  const [state, setState] = useState(loadState());
  const [s, setS] = useState(() => state.settings || {});

  const onSave = () => {
    const next = { ...state, settings: s };
    setState(next);
    saveState(next);
    alert('Đã lưu cấu hình');
  };

  return (
    <Page className="space-y-6">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold">Cài đặt thanh toán</h3>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <div>
            <label className="text-xs text-slate-500">Mã NH (VietQR)</label>
            <input className="w-full rounded-xl border px-3 py-2" value={s.bankCode || ''}
              onChange={e=>setS({ ...s, bankCode: e.target.value.toUpperCase() })}/>
          </div>
          <div>
            <label className="text-xs text-slate-500">Số tài khoản</label>
            <input className="w-full rounded-xl border px-3 py-2" value={s.accountNo || ''}
              onChange={e=>setS({ ...s, accountNo: e.target.value })}/>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500">Chủ tài khoản</label>
            <input className="w-full rounded-xl border px-3 py-2" value={s.accountName || ''}
              onChange={e=>setS({ ...s, accountName: e.target.value.toUpperCase() })}/>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500">Mẫu nội dung (addInfo)</label>
            <input className="w-full rounded-xl border px-3 py-2" value={s.qrNoteTemplate || ''}
              onChange={e=>setS({ ...s, qrNoteTemplate: e.target.value })}/>
            <div className="text-xs text-slate-500 mt-1">Dùng <code>{'{room}'}</code> và <code>{'{month}'}</code></div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold">Cấu hình ghi điện / nước</h3>
        <label className="text-xs text-slate-500">Danh sách phòng khi ghi chỉ số</label>
        <select className="w-full rounded-xl border px-3 py-2"
          value={s.meterRoomScope || 'occupied'}
          onChange={e=>setS({ ...s, meterRoomScope: e.target.value })}>
          <option value="occupied">Chỉ phòng có người ở theo tháng</option>
          <option value="all">Toàn bộ phòng</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} className="rounded-xl bg-emerald-600 text-white px-4 py-2">Lưu cấu hình</button>
      </div>
      <Footer />
    </Page>
  );
}
