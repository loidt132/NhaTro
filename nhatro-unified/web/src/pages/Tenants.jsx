import React, { useEffect, useMemo, useState } from 'react';
import { hydrateState, loadState, uid } from '../utils/state';
import { tenantsApi, roomsApi } from '../utils/api/tables';
import Footer from '../components/Footer';
import Page from '../components/Page';
import PaginationControls from '../components/PaginationControls';
import { badgeBase, btn, btnDanger, btnPrimary, card, input, table, tableWrap, td, th } from '../ui';

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
  const [tenants, setTenants] = useState([]);
  const [query, setQuery] = useState('');
  const [tenantModal, setTenantModal] = useState({ open: false, form: EMPTY_FORM });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const loadTenants = async () => {
    try {
      setTenants(await tenantsApi.list());
    } catch (error) {
      console.error('load tenants failed', error);
    }
  };

  useEffect(() => {
    // Bulk-synced fields only (rooms, via /api/state) — tenants itself is
    // fetched once below and kept in sync locally from each mutation's
    // response, so it must not re-fetch here too.
    const refresh = () => setState(loadState());
    window.addEventListener('boarding_state_updated', refresh);
    loadTenants();
    hydrateState({ tables: ['rooms'] });
    return () => window.removeEventListener('boarding_state_updated', refresh);
  }, []);

  const { rooms = [] } = state || {};
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

  const closeTenantModal = () => setTenantModal({ open: false, form: EMPTY_FORM });
  const openCreateTenant = () => setTenantModal({ open: true, form: EMPTY_FORM });

  const submit = async (e) => {
    e.preventDefault();
    const name = String(tenantModal.form.name || '').trim();
    const cccd = String(tenantModal.form.cccd || '').trim();
    if (!name || !cccd) {
      alert('Nhập đủ Họ tên và CCCD');
      return;
    }

    const sd = tenantModal.form.startDate ? new Date(tenantModal.form.startDate) : null;
    const ed = tenantModal.form.endDate ? new Date(tenantModal.form.endDate) : null;
    if (sd && Number.isNaN(sd.getTime())) return alert('Ngày bắt đầu không hợp lệ');
    if (ed && Number.isNaN(ed.getTime())) return alert('Ngày kết thúc không hợp lệ');
    if (sd && ed && sd > ed) return alert('Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc');

    const payload = {
      id: tenantModal.form.id || uid(),
      name,
      cccd,
      phone: String(tenantModal.form.phone || '').trim(),
      roomId: tenantModal.form.roomId || '',
      startDate: tenantModal.form.startDate || '',
      endDate: tenantModal.form.endDate || '',
    };

    try {
      if (tenantModal.form.id) {
        const updated = await tenantsApi.update(tenantModal.form.id, payload);
        setTenants((prev) => prev.map((t) => (t.id === tenantModal.form.id ? updated : t)));
      } else {
        const created = await tenantsApi.create(payload);
        setTenants((prev) => [...prev, created]);
      }
    } catch (error) {
      alert(error?.message || 'Không thể lưu khách thuê.');
      return;
    }
    closeTenantModal();
  };

  const editTenant = (t) => {
    setTenantModal({
      open: true,
      form: {
      id: t.id,
      name: t.name || '',
      cccd: t.cccd || '',
      phone: t.phone || '',
      roomId: t.roomId || '',
      startDate: t.startDate || '',
      endDate: t.endDate || '',
      }
    });
  };

  const removeTenant = async (tenantId) => {
    if (!window.confirm('Xóa khách thuê này?')) return;
    try {
      await tenantsApi.remove(tenantId);
      setTenants((prev) => prev.filter((t) => t.id !== tenantId));
      const affectedRoom = rooms.find((r) => r.primaryTenantId === tenantId);
      if (affectedRoom) {
        await roomsApi.update(affectedRoom.id, { ...affectedRoom, primaryTenantId: '' });
        await hydrateState({ tables: ['rooms'] });
      }
    } catch (error) {
      alert(error?.message || 'Không thể xoá khách thuê.');
      return;
    }
    if (tenantModal.form.id === tenantId) closeTenantModal();
  };

  const setPrimaryTenant = async (tenant) => {
    if (!tenant?.roomId) return;
    const room = roomMap[tenant.roomId];
    if (!room) return;
    try {
      await roomsApi.update(room.id, { ...room, primaryTenantId: tenant.id });
      await hydrateState({ tables: ['rooms'] });
    } catch (error) {
      alert(error?.message || 'Không thể đặt khách đại diện.');
    }
  };

  const isPrimary = (tenant) => Boolean(tenant?.roomId && roomMap[tenant.roomId]?.primaryTenantId === tenant.id);

  return (
    <Page className="space-y-4">
      <div className={card}>
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Quản lý khách thuê</h2>
        <p className="mt-1 text-sm text-slate-500">Thêm, sửa, xóa và phân phòng khách thuê.</p>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={openCreateTenant} className={btnPrimary}>
            Thêm khách thuê
          </button>
        </div>
      </div>

      <div className={card}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-semibold text-slate-900">Danh sách khách thuê ({visibleTenants.length})</h3>
          <input
            className={`${input} sm:w-72`}
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
                {isPrimary(t) ? <span className={`${badgeBase} bg-emerald-100 text-emerald-700`}>Đại diện</span> : null}
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                <button type="button" className={`${btn} !px-2.5 !py-1 !text-xs`} onClick={() => editTenant(t)}>
                  Sửa
                </button>
                <button type="button" className={`${btn} !px-2.5 !py-1 !text-xs`} onClick={() => setPrimaryTenant(t)}>
                  Đặt đại diện
                </button>
                <button
                  type="button"
                  className={`${btnDanger} !px-2.5 !py-1`}
                  onClick={() => removeTenant(t.id)}
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
          {!pagedTenants.length ? <div className="text-sm text-slate-500">Chưa có khách thuê.</div> : null}
        </div>

        <div className={`mt-4 hidden lg:block ${tableWrap}`}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Họ tên</th>
                <th className={th}>CCCD</th>
                <th className={th}>SĐT</th>
                <th className={th}>Phòng</th>
                <th className={th}>Bắt đầu</th>
                <th className={th}>Kết thúc</th>
                <th className={th}>Đại diện</th>
                <th className={`${th} text-right`}>Tác vụ</th>
              </tr>
            </thead>
            <tbody>
              {pagedTenants.map((t) => (
                <tr key={t.id}>
                  <td className={`${td} font-medium text-slate-900`}>{t.name}</td>
                  <td className={td}>{t.cccd}</td>
                  <td className={td}>{t.phone || ''}</td>
                  <td className={td}>{roomMap[t.roomId]?.name || 'Chưa gán'}</td>
                  <td className={td}>{t.startDate || ''}</td>
                  <td className={td}>{t.endDate || ''}</td>
                  <td className={td}>{isPrimary(t) ? <span className={`${badgeBase} bg-emerald-100 text-emerald-700`}>★</span> : ''}</td>
                  <td className={td}>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" className={`${btn} !py-1.5 !text-xs`} onClick={() => editTenant(t)}>
                        Sửa
                      </button>
                      <button type="button" className={`${btn} !py-1.5 !text-xs`} onClick={() => setPrimaryTenant(t)}>
                        Đặt đại diện
                      </button>
                      <button type="button" className={btnDanger} onClick={() => removeTenant(t.id)}>
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!pagedTenants.length ? (
                <tr>
                  <td className={`${td} text-slate-500`} colSpan={8}>
                    Chưa có khách thuê.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Footer />

      {tenantModal.open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-2xl rounded-none sm:rounded-2xl bg-white shadow-lg flex flex-col max-h-[100dvh] sm:max-h-[min(90dvh,900px)]">
            <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0">
                <div className="text-base sm:text-lg font-semibold leading-snug">{tenantModal.form.id ? 'Cập nhật khách thuê' : 'Thêm khách thuê'}</div>
                <div className="text-sm text-slate-600 mt-0.5">Nhập thông tin khách và gán phòng (nếu có).</div>
              </div>
              <button type="button" onClick={closeTenantModal} className={`${btn} flex-shrink-0`}>Đóng</button>
            </div>

            <form onSubmit={submit} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-5 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-500">Họ tên</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                    value={tenantModal.form.name}
                    onChange={(e) => setTenantModal((prev) => ({ ...prev, form: { ...prev.form, name: e.target.value } }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-500">CCCD</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                    value={tenantModal.form.cccd}
                    onChange={(e) => setTenantModal((prev) => ({ ...prev, form: { ...prev.form, cccd: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Số điện thoại</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                    value={tenantModal.form.phone}
                    onChange={(e) => setTenantModal((prev) => ({ ...prev, form: { ...prev.form, phone: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Phòng</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                    value={tenantModal.form.roomId}
                    onChange={(e) => setTenantModal((prev) => ({ ...prev, form: { ...prev.form, roomId: e.target.value } }))}
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
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                    value={tenantModal.form.startDate}
                    onChange={(e) => setTenantModal((prev) => ({ ...prev, form: { ...prev.form, startDate: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Ngày kết thúc</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                    value={tenantModal.form.endDate}
                    onChange={(e) => setTenantModal((prev) => ({ ...prev, form: { ...prev.form, endDate: e.target.value } }))}
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-2">
                <button type="button" className={btn} onClick={closeTenantModal}>
                  Hủy
                </button>
                <button type="submit" className={btnPrimary}>
                  {tenantModal.form.id ? 'Cập nhật' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Page>
  );
}
