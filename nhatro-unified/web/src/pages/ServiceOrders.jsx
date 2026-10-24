// src/pages/ServiceOrders.jsx
// Tạo/theo dõi đơn dịch vụ. Quản lý danh mục & bảng giá đã tách sang
// ServiceCatalog.jsx — màn này chỉ còn việc đặt đơn. Đơn có thể gắn với một
// phòng/khách thuê, hoặc để trống (khách vãng lai, ghi tên tự do). Một đơn có
// thể gồm nhiều dịch vụ — mỗi dịch vụ là một dòng cùng orderGroupId.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadState, hydrateState, monthKey, currency } from '../utils/state';
import * as catalog from '../utils/catalog';
import Page from '../components/Page';
import PaginationControls from '../components/PaginationControls';
import { badgeBase, btn, btnDanger, btnPrimary, card, input, table, tableWrap, td, th } from '../ui';

const STATUS_LABELS = {
  pending: 'Chờ xử lý',
  in_progress: 'Đang xử lý',
  done: 'Hoàn thành',
  cancelled: 'Đã hủy',
};
const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-sky-100 text-sky-700',
  done: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-600',
};
const STATUS_OPTIONS = Object.keys(STATUS_LABELS);

export default function ServiceOrders() {
  const [state, setState] = useState(() => loadState());
  const { rooms = [], tenants = [] } = state || {};
  const [month, setMonth] = useState(monthKey());
  const [statusFilter, setStatusFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [orderForm, setOrderForm] = useState({
    open: false,
    customerType: 'walkin', // 'tenant' | 'walkin'
    roomId: '',
    tenantId: '',
    customerName: '',
    lines: [{ itemId: '', quantity: 1 }],
    note: '',
  });

  useEffect(() => {
    setState(loadState());
    hydrateState({ tables: ['rooms', 'tenants'] });
  }, []);

  const roomMap = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r])), [rooms]);
  const tenantsByRoom = useMemo(() => {
    const map = {};
    (tenants || []).forEach((t) => {
      if (!t?.roomId) return;
      (map[t.roomId] ||= []).push(t);
    });
    return map;
  }, [tenants]);
  const tenantMap = useMemo(() => Object.fromEntries((tenants || []).map((t) => [t.id, t])), [tenants]);

  async function reloadCatalog() {
    setLoading(true);
    setError('');
    try {
      const its = await catalog.listItems();
      setItems(its || []);
    } catch (err) {
      setError(err.message || 'Không tải được danh mục dịch vụ.');
    } finally {
      setLoading(false);
    }
  }

  async function reloadOrders() {
    try {
      const params = { month };
      if (roomFilter !== 'all') params.roomId = roomFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      const rows = await catalog.listOrders(params);
      setOrders(rows || []);
    } catch (err) {
      setError(err.message || 'Không tải được danh sách đơn.');
    }
  }

  useEffect(() => { reloadCatalog(); }, []);
  useEffect(() => { reloadOrders(); }, [month, roomFilter, statusFilter]);
  useEffect(() => { setPage(1); }, [month, roomFilter, statusFilter, query, perPage]);

  const itemMap = useMemo(() => Object.fromEntries(items.map((it) => [it.id, it])), [items]);

  // Gom các dòng cùng orderGroupId thành một đơn (đơn cũ 1 dịch vụ = nhóm 1 dòng).
  const groupedOrders = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      const key = o.orderGroupId || o.id;
      if (!map.has(key)) map.set(key, { id: key, lines: [], first: o });
      map.get(key).lines.push(o);
    }
    return [...map.values()].map((g) => ({
      ...g,
      status: g.first.status,
      total: g.lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    }));
  }, [orders]);

  const visibleOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groupedOrders;
    return groupedOrders.filter((g) => {
      const haystack = [customerLabel(g.first), g.first.note, ...g.lines.map((l) => l.itemName)];
      return haystack.some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [groupedOrders, query, tenantMap]);

  const totalPages = Math.max(1, Math.ceil(visibleOrders.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pagedOrders = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return visibleOrders.slice(start, start + perPage);
  }, [visibleOrders, currentPage, perPage]);

  function openOrderForm() {
    setOrderForm({
      open: true,
      customerType: 'walkin',
      roomId: rooms[0]?.id || '',
      tenantId: '',
      customerName: '',
      lines: [{ itemId: items[0]?.id || '', quantity: 1 }],
      note: '',
    });
  }

  function setLine(index, patch) {
    setOrderForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  }
  function addLine() {
    setOrderForm((f) => ({ ...f, lines: [...f.lines, { itemId: items[0]?.id || '', quantity: 1 }] }));
  }
  function removeLine(index) {
    setOrderForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== index) : f.lines }));
  }
  const formTotal = orderForm.lines.reduce((sum, l) => sum + (Number(itemMap[l.itemId]?.price) || 0) * (Number(l.quantity) || 0), 0);

  async function submitOrder(e) {
    e.preventDefault();
    const lines = orderForm.lines
      .map((l) => ({ item: itemMap[l.itemId], quantity: Number(l.quantity) || 0 }))
      .filter((l) => l.item && l.quantity > 0);
    if (!lines.length) return alert('Chọn ít nhất một dịch vụ với số lượng lớn hơn 0.');
    const walkIn = orderForm.customerType === 'walkin';
    if (walkIn && !orderForm.customerName.trim()) return alert('Nhập tên khách vãng lai.');
    if (!walkIn && !orderForm.roomId) return alert('Chọn phòng trước.');
    try {
      await catalog.createOrder({
        items: lines.map(({ item, quantity }) => ({
          itemId: item.id,
          itemName: item.name,
          unit: item.unit,
          price: item.price,
          quantity,
        })),
        roomId: walkIn ? null : orderForm.roomId,
        tenantId: walkIn ? null : (orderForm.tenantId || null),
        customerName: walkIn ? orderForm.customerName.trim() : (roomMap[orderForm.roomId]?.name || null),
        month,
        note: orderForm.note.trim() || null,
      });
      setOrderForm((f) => ({ ...f, open: false }));
      await reloadOrders();
    } catch (err) {
      alert(err.message || 'Không tạo được đơn.');
    }
  }

  async function changeStatus(order, status) {
    try {
      await catalog.updateOrderGroup(order.id, { status });
      await reloadOrders();
    } catch (err) {
      alert(err.message || 'Không đổi được trạng thái.');
    }
  }

  async function removeOrder(id) {
    if (!confirm('Xóa đơn này?')) return;
    try {
      await catalog.deleteOrderGroup(id);
      await reloadOrders();
    } catch (err) {
      alert(err.message || 'Không xóa được đơn.');
    }
  }

  function customerLabel(order) {
    if (!order.roomId) return order.customerName ? `${order.customerName} (vãng lai)` : 'Khách vãng lai';
    return order.customerName || tenantMap[order.tenantId]?.name || '—';
  }

  return (
    <Page className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Đơn dịch vụ</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/reports?tab=services" className={`${btn} !px-3 !py-1.5 !text-xs`}>📊 Doanh thu dịch vụ</Link>
          <Link to="/service-catalog" className={`${btn} !px-3 !py-1.5 !text-xs`}>⚙️ Quản lý dịch vụ</Link>
        </div>
      </div>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-500">Đang tải danh mục...</div> : null}
      {!items.length && !loading ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Chưa có dịch vụ nào trong danh mục. Vào <Link to="/service-catalog" className="underline">Quản lý dịch vụ</Link> để thêm.
        </div>
      ) : null}

      <div className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" className={`${input} w-auto`} value={month} onChange={(e) => setMonth(e.target.value)} />
          <select className={`${input} w-auto`} value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
            <option value="all">Tất cả phòng</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className={`${input} w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <input
            className={`${input} w-auto sm:w-64`}
            placeholder="Tìm theo phòng, tên khách, dịch vụ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className={`${btnPrimary} ml-auto`} onClick={openOrderForm} disabled={!items.length}>+ Tạo đơn</button>
        </div>

        {orderForm.open ? (
          <form onSubmit={submitOrder} className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-5">
            <div className="col-span-2 sm:col-span-5">
              <label className="text-xs font-medium text-slate-600">Khách hàng</label>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => setOrderForm((f) => ({ ...f, customerType: 'tenant' }))} className={`rounded-xl border px-3 py-1 text-xs font-medium ${orderForm.customerType === 'tenant' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>Khách thuê trọ</button>
                <button type="button" onClick={() => setOrderForm((f) => ({ ...f, customerType: 'walkin' }))} className={`rounded-xl border px-3 py-1 text-xs font-medium ${orderForm.customerType === 'walkin' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>Khách vãng lai</button>
              </div>
            </div>
            {orderForm.customerType === 'tenant' ? (
              <>
                <div>
                  <label className="text-xs font-medium text-slate-600">Phòng</label>
                  <select className={input} value={orderForm.roomId} onChange={(e) => setOrderForm((f) => ({ ...f, roomId: e.target.value, tenantId: '' }))}>
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Khách</label>
                  <select className={input} value={orderForm.tenantId} onChange={(e) => setOrderForm((f) => ({ ...f, tenantId: e.target.value }))}>
                    <option value="">— Không chọn —</option>
                    {(tenantsByRoom[orderForm.roomId] || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-600">Tên khách vãng lai</label>
                <input className={input} value={orderForm.customerName} onChange={(e) => setOrderForm((f) => ({ ...f, customerName: e.target.value }))} placeholder="Tên khách / SĐT" />
              </div>
            )}
            <div className="col-span-2 space-y-2 sm:col-span-5">
              <label className="text-xs font-medium text-slate-600">Dịch vụ</label>
              {orderForm.lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className={`${input} min-w-0 flex-1`} value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                    {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({currency(it.price)} đ/{it.unit || 'lần'})</option>)}
                  </select>
                  <input type="number" min="0" step="any" className={`${input} w-20 shrink-0`} aria-label="Số lượng" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  <button type="button" className={`${btn} !px-2.5`} onClick={() => removeLine(i)} disabled={orderForm.lines.length === 1} aria-label="Xoá dòng">✕</button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <button type="button" className={`${btn} !py-1 !text-xs`} onClick={addLine}>+ Thêm dịch vụ</button>
                <span className="text-sm text-slate-700">Tạm tính: <strong className="tabular-nums">{currency(formTotal)} đ</strong></span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Ghi chú</label>
              <input className={input} value={orderForm.note} onChange={(e) => setOrderForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            <div className="col-span-2 flex gap-2 sm:col-span-5">
              <button type="submit" className={btnPrimary}>Tạo đơn</button>
              <button type="button" className={btn} onClick={() => setOrderForm((f) => ({ ...f, open: false }))}>Hủy</button>
            </div>
          </form>
        ) : null}
      </div>

      <div className={card}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-semibold text-slate-900">Danh sách đơn ({visibleOrders.length})</h3>
        </div>
        <div className="mt-3">
          <PaginationControls
            totalItems={visibleOrders.length}
            page={currentPage}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
          />
        </div>
        <div className={`mt-3 ${tableWrap}`}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Khách</th>
                <th className={th}>Dịch vụ</th>
                <th className={`${th} text-right`}>Thành tiền</th>
                <th className={th}>Trạng thái</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {pagedOrders.map((o) => (
                <tr key={o.id}>
                  <td className={td}>{customerLabel(o.first)}</td>
                  <td className={`${td} !whitespace-normal`}>
                    {o.lines.map((l) => (
                      <div key={l.id}>{l.itemName} × {l.quantity} {l.unit}</div>
                    ))}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{currency(o.total)} đ</td>
                  <td className={td}>
                    <select
                      className={`${badgeBase} border-0 ${STATUS_BADGE[o.status] || ''}`}
                      value={o.status}
                      onChange={(e) => changeStatus(o, e.target.value)}
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <td className={td}>
                    <div className="flex justify-end">
                      <button type="button" className={btnDanger} onClick={() => removeOrder(o.id)}>Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!pagedOrders.length ? (
                <tr><td colSpan={5} className={`${td} text-center text-slate-500`}>{query.trim() ? 'Không tìm thấy đơn phù hợp.' : 'Chưa có đơn dịch vụ nào trong tháng này.'}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}
