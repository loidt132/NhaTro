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

  const handleExport = () => {
    const data = loadState();
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nhatro-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // Basic validation
        if (!data.rooms || !data.tenants || !data.readings || !data.invoices || !data.payments) {
          throw new Error('Dữ liệu không hợp lệ: thiếu các trường cần thiết');
        }
        saveState(data);
        setState(data);
        alert('Đã nhập dữ liệu thành công');
      } catch (err) {
        alert('Lỗi nhập dữ liệu: ' + err.message);
      }
    };
    reader.readAsText(file);
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
        <h3 className="text-lg font-semibold">Thông tin chủ trọ</h3>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <div>
            <label className="text-xs text-slate-500">Tên chủ trọ</label>
            <input className="w-full rounded-xl border px-3 py-2" value={s.landlordName || ''}
              onChange={e=>setS({ ...s, landlordName: e.target.value })}/>
          </div>
          <div>
            <label className="text-xs text-slate-500">Số điện thoại</label>
            <input className="w-full rounded-xl border px-3 py-2" value={s.landlordPhone || ''}
              onChange={e=>setS({ ...s, landlordPhone: e.target.value })}/>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500">Địa chỉ</label>
            <input className="w-full rounded-xl border px-3 py-2" value={s.landlordAddress || ''}
              onChange={e=>setS({ ...s, landlordAddress: e.target.value })}/>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold">Quản lý dữ liệu</h3>
        <div className="mt-3 space-y-3">
          <button onClick={handleExport} className="rounded-xl bg-blue-600 text-white px-4 py-2">Xuất dữ liệu</button>
          <div>
            <label className="block text-sm text-slate-500">Nhập dữ liệu từ file JSON</label>
            <input type="file" accept=".json" onChange={handleImport} className="mt-1" />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={onSave} className="rounded-xl bg-emerald-600 text-white px-4 py-2">Lưu cấu hình</button>
      </div>
      <Footer />
    </Page>
  );
}
