import React, { useEffect, useMemo, useState } from 'react';
import { hydrateState, loadState, saveState, uid } from '../utils/state';
import Footer from '../components/Footer';
import Page from '../components/Page';
import PaginationControls from '../components/PaginationControls';

const EMPTY_FORM = {
  id: null,
  name: '',
  cccd: '',
  phone: '',
  roomId: '',
  startDate: '',
  endDate: '',
};

function compareByName(a = '', b = '') {
  return String(a).localeCompare(String(b), 'vi');
}

export default function Tenants() {
  const [state, setState] = useState(() => loadState());
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  useEffect(() => {
    const refresh = () => setState(loadState());
    window.addEventListener('boarding_state_updated', refresh);
    hydrateState({ tables: ['rooms', 'tenants'] });
    return () => window.removeEventListener('boarding_state_updated', refresh);
  }, []);

  const { rooms = [], tenants = [] } = state || {};
  const roomMap = useMemo(() => Object.fromEntries((rooms || []).map((r) => [r.id, r])), [rooms]);

  const visibleTenants = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (tenants || []).slice().sort((a, b) => compareByName(a.name, b.name));
    if (!q) return rows;
    return rows.filter((t) => {
      const roomName = roomMap[t.roomId]?.name || '';
      return [t.name, t.cccd, t.phone, roomName].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [tenants, query, roomMap]);

  const totalPages = Math.max(1, Math.ceil(visibleTenants.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pagedTenants = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return visibleTenants.slice(start, start + perPage);
  }, [visibleTenants, currentPage, perPage]);

  useEffect(() => {
    setPage(1);
  }, [query, perPage]);

  const resetForm = () => setForm(EMPTY_FORM);

  const submit = (e) => {
    e.preventDefault();
    const name = String(form.name || '').trim();
    const cccd = String(form.cccd || '').trim();
    if (!name || !cccd) {
      alert('Nhập đủ Họ tên và CCCD');
      return;
    }

    const sd = form.startDate ? new Date(form.startDate) : null;
    const ed = form.endDate ? new Date(form.endDate) : null;
    if (sd && Number.isNaN(sd.getTime())) return alert('Ngày bắt đầu không hợp lệ');
    if (ed && Number.isNaN(ed.getTime())) return alert('Ngày kết thúc không hợp lệ');
    if (sd && ed && sd > ed) return alert('Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc');

    const payload = {
      id: form.id || uid(),
      name,
      cccd,
      phone: String(form.phone || '').trim(),
      roomId: form.roomId || '',
      startDate: form.startDate || '',
      endDate: form.endDate || '',
    };

    const nextTenants = form.id
      ? tenants.map((t) => (t.id === form.id ? payload : t))
      : [...tenants, payload];

    const next = { ...state, tenants: nextTenants };
    setState(next);
    saveState(next);
    resetForm();
  };

  const editTenant = (t) => {
    setForm({
      id: t.id,
      name: t.name || '',
      cccd: t.cccd || '',
      phone: t.phone || '',
      roomId: t.roomId || '',
      startDate: t.startDate || '',
      endDate: t.endDate || '',
    });
  };

  const removeTenant = (tenantId) => {
    if (!window.confirm('Xóa khách thuê này?')) return;
    const nextTenants = tenants.filter((t) => t.id !== tenantId);
    const nextRooms = rooms.map((r) => (r.primaryTenantId === tenantId ? { ...r, primaryTenantId: '' } : r));
    const next = { ...state, tenants: nextTenants, rooms: nextRooms };
    setState(next);
    saveState(next);
    if (form.id === tenantId) resetForm();
  };

  const setPrimaryTenant = (tenant) => {
    if (!tenant?.roomId) return;
    const nextRooms = rooms.map((r) => (r.id === tenant.roomId ? { ...r, primaryTenantId: tenant.id } : r));
    const next = { ...state, rooms: nextRooms };
    setState(next);
    saveState(next);
  };

  const isPrimary = (tenant) => Boolean(tenant?.roomId && roomMap[tenant.roomId]?.primaryTenantId === tenant.id);

  return (
    <Page className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Quản lý khách thuê</h2>
        <p className="mt-1 text-sm text-slate-500">Thêm, sửa, xóa và phân phòng khách thuê.</p>
      </div>

      <form onSubmit={submit} className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-slate-500">Họ tên</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">CCCD</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.cccd}
              onChange={(e) => setForm((prev) => ({ ...prev, cccd: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Số điện thoại</label>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Phòng</label>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.roomId}
              onChange={(e) => setForm((prev) => ({ ...prev, roomId: e.target.value }))}
            >
              <option value="">Chưa gán phòng</option>
              {(rooms || [])
                .slice()
                .sort((a, b) => compareByName(a.name, b.name))
                .map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Ngày bắt đầu</label>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.startDate}
              onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Ngày kết thúc</label>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={form.endDate}
              onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="submit" className="rounded-xl bg-emerald-600 px-4 py-2 text-white">
            {form.id ? 'Cập nhật khách thuê' : 'Thêm khách thuê'}
          </button>
          {form.id ? (
            <button type="button" className="rounded-xl border px-4 py-2" onClick={resetForm}>
              Hủy sửa
            </button>
          ) : null}
        </div>
      </form>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold">Danh sách khách thuê ({visibleTenants.length})</h3>
          <input
            className="w-full rounded-xl border px-3 py-2 sm:w-72"
            placeholder="Tìm theo tên, CCCD, SĐT, phòng..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="mt-3">
          <PaginationControls
            totalItems={visibleTenants.length}
            page={currentPage}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
          />
        </div>

        <div className="mt-4 space-y-3 lg:hidden">
          {pagedTenants.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{t.name}</div>
                  <div className="text-sm text-slate-600">CCCD: {t.cccd}</div>
                  <div className="text-sm text-slate-600">SĐT: {t.phone || '—'}</div>
                  <div className="text-sm text-slate-600">Phòng: {roomMap[t.roomId]?.name || 'Chưa gán'}</div>
                  <div className="text-xs text-slate-500">
                    {t.startDate || '—'} → {t.endDate || '—'}
                  </div>
                </div>
                {isPrimary(t) ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700">Đại diện</span> : null}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => editTenant(t)}>
                  Sửa
                </button>
                <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setPrimaryTenant(t)}>
                  Đặt đại diện
                </button>
                <button
                  type="button"
                  className="col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                  onClick={() => removeTenant(t.id)}
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
          {!pagedTenants.length ? <div className="text-sm text-slate-500">Chưa có khách thuê.</div> : null}
        </div>

        <div className="mt-4 hidden overflow-x-auto lg:block">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="p-2">Họ tên</th>
                <th className="p-2">CCCD</th>
                <th className="p-2">SĐT</th>
                <th className="p-2">Phòng</th>
                <th className="p-2">Bắt đầu</th>
                <th className="p-2">Kết thúc</th>
                <th className="p-2">Đại diện</th>
                <th className="p-2">Tác vụ</th>
              </tr>
            </thead>
            <tbody>
              {pagedTenants.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="p-2">{t.name}</td>
                  <td className="p-2">{t.cccd}</td>
                  <td className="p-2">{t.phone || ''}</td>
                  <td className="p-2">{roomMap[t.roomId]?.name || 'Chưa gán'}</td>
                  <td className="p-2">{t.startDate || ''}</td>
                  <td className="p-2">{t.endDate || ''}</td>
                  <td className="p-2">{isPrimary(t) ? '★' : ''}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" className="rounded border px-2 py-1" onClick={() => editTenant(t)}>
                        Sửa
                      </button>
                      <button type="button" className="rounded border px-2 py-1" onClick={() => setPrimaryTenant(t)}>
                        Đặt đại diện
                      </button>
                      <button type="button" className="rounded border px-2 py-1" onClick={() => removeTenant(t.id)}>
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!pagedTenants.length ? (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={8}>
                    Chưa có khách thuê.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Footer />
    </Page>
  );
}
