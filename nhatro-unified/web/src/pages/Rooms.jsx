
// src/pages/Rooms.jsx
import React, { useMemo, useState, useEffect } from 'react';
import TopStats from '../components/TopStats';
import SearchBar from '../components/SearchBar';
import TotalsBar from '../components/TotalsBar';
import ViewSwitch from '../components/ViewSwitch';
import Page from '../components/Page';
import { loadState, saveState, monthKey, currency, uid, calcTotals } from '../utils/state';
import Footer from '../components/Footer';

export default function Rooms(){
  //const [state, setState] = useState(loadState());
  const [state, setState] = useState(null);
  useEffect(() => {
    const refresh = () => setState(loadState());
    window.addEventListener('boarding_state_updated', refresh);
    return () => window.removeEventListener('boarding_state_updated', refresh);
  }, []);
  if (!state) return <div className="p-6">Đang tải dữ liệu...</div>;
  const [month, setMonth] = useState(monthKey());
  const { rooms, tenants, readings, invoices, payments } = state;
  const [query, setQuery] = useState('');

  // ===== Derived =====
  const roomMap = useMemo(()=> Object.fromEntries(rooms.map(r=>[r.id, r])), [rooms]);
  const tenantByRoom = useMemo(()=>{
    const map = {}; (tenants||[]).forEach(t=>{ if(!map[t.roomId]) map[t.roomId]=[]; map[t.roomId].push(t); });
    return map;
  }, [tenants]);
  const unpaidCount = invoices.filter(i=> i.status !== 'Đã thanh toán').length;

  const latestReadingOf = (roomId, ym) => {
    const list = (readings||[]).filter(r=> r.roomId===roomId && r.month===ym).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    return list[0];
  };

  // ===== Room CRUD =====
  const [roomModal, setRoomModal] = useState({ open:false, mode:'create', roomId:null, form:{ name:'', baseRent:2500000, electricRate:3500, waterRate:12000 } });
  const openCreateRoom = ()=> setRoomModal({ open:true, mode:'create', roomId:null, form:{ name:'', baseRent:2500000, electricRate:3500, waterRate:12000 }});
  const openEditRoom = (r)=> setRoomModal({ open:true, mode:'edit', roomId:r.id, form:{ name:r.name, baseRent:r.baseRent, electricRate:r.electricRate, waterRate:r.waterRate }});
  const saveRoom = (e)=>{
    e.preventDefault();
    const f = roomModal.form; const n = (f.name||'').trim();
    if(!n) return alert('Nhập tên phòng');
    const payload = { id: roomModal.roomId || uid(), name:n, baseRent:+f.baseRent||0, electricRate:+f.electricRate||0, waterRate:+f.waterRate||0, primaryTenantId: roomMap[roomModal.roomId]?.primaryTenantId };
    const nextRooms = roomModal.mode==='edit' ? rooms.map(r=> r.id===roomModal.roomId? payload : r) : [...rooms, payload];
    // If editing an existing room, update unpaid invoices for this room so Payments view shows new rent
    let nextInvoices = invoices;
    if(roomModal.mode === 'edit'){
      nextInvoices = (invoices||[]).map(inv => {
        if(inv.roomId !== payload.id) return inv;
        // update only unpaid invoices to preserve historical paid records
        if(inv.status === 'Đã thanh toán') return inv;
        const newRent = +payload.baseRent || 0;
        const newTotal = newRent + (inv.electricAmount || 0) + (inv.waterAmount || 0) + (inv.other || 0);
        return { ...inv, rent: newRent, total: newTotal };
      });
    }
    const s2 = { ...state, rooms: nextRooms, invoices: nextInvoices };
    setState(s2); saveState(s2);
    setRoomModal({ open:false, mode:'create', roomId:null, form:{ name:'', baseRent:2500000, electricRate:3500, waterRate:12000 }});
  };
  const removeRoom = (id)=>{
    if(!confirm('Xóa phòng này? Khách thuê sẽ bị bỏ gán phòng.')) return;
    const nextRooms = rooms.filter(r=> r.id!==id);
    const nextTenants = (tenants||[]).map(t=> t.roomId===id? ({...t, roomId:undefined}) : t);
    const s2 = { ...state, rooms: nextRooms, tenants: nextTenants };
    setState(s2); saveState(s2);
  };

  // ===== Tenant CRUD (multi-tenant per room) =====
  const [tenantModal, setTenantModal] = useState({ open:false, roomId:null, form:{ id:null, name:'', cccd:'', phone:'', startDate:'', endDate:'' } });
  const openTenantManager = (roomId)=> setTenantModal({ open:true, roomId, form:{ id:null, name:'', cccd:'', phone:'', startDate:'', endDate:'' } });

  const submitTenant = (e)=>{
    e.preventDefault();
    const f = tenantModal.form; const name=(f.name||'').trim(); const cccd=(f.cccd||'').trim();
    if(!name || !cccd) return alert('Nhập đủ Họ tên và CCCD');
    // Validate date range: if both provided, startDate must be <= endDate
    const sd = f.startDate ? new Date(f.startDate) : null;
    const ed = f.endDate ? new Date(f.endDate) : null;
    if (sd && isNaN(sd.getTime())) return alert('Ngày bắt đầu không hợp lệ');
    if (ed && isNaN(ed.getTime())) return alert('Ngày kết thúc không hợp lệ');
    if (sd && ed && sd > ed) return alert('Ngày bắt đầu phải nhỏ hơn hoặc bằng Ngày kết thúc');
    const payload = { id: f.id || uid(), name, cccd, phone:(f.phone||'').trim(), roomId: tenantModal.roomId, startDate: f.startDate, endDate: f.endDate };
    const nextTenants = f.id ? tenants.map(t=> t.id===f.id? payload : t) : [...tenants, payload];
    const s2 = { ...state, tenants: nextTenants };
    setState(s2); saveState(s2);
    setTenantModal(tm=> ({ ...tm, form:{ id:null, name:'', cccd:'', phone:'', startDate:'', endDate:'' } }));
  };

  const editTenant = (t)=> setTenantModal(tm=> ({ ...tm, form:{ id:t.id, name:t.name, cccd:t.cccd, phone:t.phone||'', startDate:t.startDate, endDate:t.endDate } }));
  const removeTenant = (id)=>{
    if(!confirm('Xóa khách thuê này?')) return;
    const nextTenants = tenants.filter(t=> t.id!==id);
    const s2 = { ...state, tenants: nextTenants };
    setState(s2); saveState(s2);
  };
  const moveTenant = (tenantId, newRoomId)=>{
    const nextTenants = tenants.map(t=> t.id===tenantId? ({...t, roomId:newRoomId}) : t);
    const s2 = { ...state, tenants: nextTenants };
    setState(s2); saveState(s2);
  };
  const setPrimaryTenant = (roomId, tenantId)=>{
    const nextRooms = rooms.map(r=> r.id===roomId? ({...r, primaryTenantId: tenantId}) : r);
    const s2 = { ...state, rooms: nextRooms };
    setState(s2); saveState(s2);
  };

  // ===== Render helpers =====
  const { sumPaid, sumDebt } = calcTotals(invoices, payments, month);
  const [view, setView] = useState('cards'); // 'table' or 'cards'

  // compute month-scoped top stats: rooms occupied in month, tenants active in month, invoices for month, unpaid for month
  const getMonthBounds = (ym) => {
    const y = +ym.slice(0,4); const m = +ym.slice(5,7);
    const lastDay = new Date(y, m, 0).getDate();
    const first = `${ym}-01`;
    const last = `${ym}-${String(lastDay).padStart(2,'0')}`;
    return { first, last };
  };

  const isTenantActiveForMonth = (t, ym) => {
    const s = (t.startDate||'').slice(0,10); const e = (t.endDate||'').slice(0,10);
    const { first, last } = getMonthBounds(ym);
    const ss = s || '0000-01-01'; const ee = e || '9999-12-31';
    return ss <= last && ee >= first;
  };

  const tenantsActiveCount = useMemo(() => (tenants||[]).filter(t => isTenantActiveForMonth(t, month)).length, [tenants, month]);

  const invoicesForMonth = useMemo(() => (invoices||[]).filter(i => i.month === month).length, [invoices, month]);

  const unpaidForMonth = useMemo(() => (invoices||[]).filter(i => i.month === month && i.status !== 'Đã thanh toán').length, [invoices, month]);

  // visible rooms (filtered by search and ordered by name)
  const visibleRooms = useMemo(() => {
    const q = (query || '').toLowerCase();
    const base = (rooms || []).filter(r => {
      if (!q) return true;
      const nameHit = (r.name || '').toLowerCase().includes(q);
      const tenantsForRoom = tenantByRoom[r.id] || [];
      const tenantHit = tenantsForRoom.some(t => {
        const tn = (t.name || '').toLowerCase();
        const tc = (t.cccd || '').toLowerCase();
        const tp = (t.phone || '').toLowerCase();
        return tn.includes(q) || tc.includes(q) || tp.includes(q);
      });
      return nameHit || tenantHit;
    });
    return base.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rooms, query, tenantByRoom]);

  // items for room table (used to display payments-style table on Rooms page)
  const roomItems = useMemo(() =>
    visibleRooms.map(room => {
      const inv = invoices.find(i=> i.roomId===room.id && i.month===month);
      const occupants = tenantByRoom[room.id] || [];
      const occActive = occupants.filter(t=>{
        const s = (t.startDate||'').slice(0,10); const e = (t.endDate||'').slice(0,10);
        const { first, last } = (function(ym){ const y=+ym.slice(0,4); const m=+ym.slice(5,7); const d=new Date(y,m,0).getDate(); return { first:`${ym}-01`, last:`${ym}-${String(d).padStart(2,'0')}` }; })(month);
        const ss = s||'0000-01-01'; const ee = e||'9999-12-31'; return ss<= last && ee>= first;
      });
      const tenantId = room.primaryTenantId ?? occActive[0]?.id ?? occupants[0]?.id;
      const tenant = occupants.find(t=> t.id===tenantId);
      const reading = latestReadingOf(room.id, month);
      const eUse = Math.max(0, (reading?.electricEnd||0) - (reading?.electricStart||0));
      const wUse = Math.max(0, (reading?.waterEnd||0) - (reading?.waterStart||0));
      const eAmt = eUse * (room.electricRate||0);
      const wAmt = wUse * (room.waterRate||0);
      const totalDraft = (room.baseRent||0) + eAmt + wAmt;
      return { room, occupants, tenant, reading, invoice: inv, draft: { eUse, wUse, eAmt, wAmt, totalDraft } };
    })
  , [visibleRooms, invoices, tenantByRoom, readings, month]);

  // readings are managed on the Meter page; Rooms shows room/payment info only

  const Card = ({ room })=>{
    const occupants = tenantByRoom[room.id] || [];
    const inv = invoices.find(i=> i.roomId===room.id && i.month===month);
    const status = inv?.status || 'Còn nợ';
    const badge = status==='Đã thanh toán' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700';
    const total = inv?.total ?? room.baseRent ?? 0;
    const primary = occupants.find(t=> t.id===room.primaryTenantId) || occupants[0];

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm flex flex-col gap-3 min-w-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="font-semibold text-[15px] sm:text-base min-w-0 break-words pr-1">PHÒNG {room.name}</div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${badge}`}>{status}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 text-sm min-w-0">
          <div><div className="text-slate-500">Tiền phòng</div><div className="font-medium">{currency(room.baseRent)} đ</div></div>
          <div><div className="text-slate-500">Đơn giá điện</div><div className="font-medium">{currency(room.electricRate)} đ/kWh</div></div>
          <div><div className="text-slate-500">Đơn giá nước</div><div className="font-medium">{currency(room.waterRate)} đ/m³</div></div>
          <div>
            <div className="text-slate-500">Khách</div>
            {occupants.length? (
              <div className="flex flex-wrap gap-1">
                {occupants.map(t=> (
                  <span key={t.id} title={t.cccd}
                        className={`rounded-full px-2 py-0.5 text-xs border ${t.id===room.primaryTenantId? 'border-emerald-400 bg-emerald-50':'border-slate-200 bg-slate-50'}`}>
                    {t.name}{t.id===room.primaryTenantId? ' ★':''}
                  </span>
                ))}
              </div>
            ) : <i className="text-slate-400">(trống)</i>}
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-lg font-semibold">{currency(total)} đ</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={()=>openEditRoom(room)} className="flex-1 min-w-[6.5rem] rounded-lg border px-3 py-2 text-sm sm:flex-none sm:py-1">Sửa phòng</button>
            <button onClick={()=>openTenantManager(room.id)} className="flex-1 min-w-[6.5rem] rounded-lg border px-3 py-2 text-sm sm:flex-none sm:py-1">Quản lý khách</button>
            <button onClick={()=>removeRoom(room.id)} className="flex-1 min-w-[6.5rem] rounded-lg border px-3 py-2 text-sm sm:flex-none sm:py-1">Xóa</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Page className="space-y-4">
      <TopStats rooms={rooms.length} tenants={tenantsActiveCount} invoices={invoicesForMonth} debts={unpaidForMonth} />
      <TotalsBar sumPaid={sumPaid} sumDebt={sumDebt} />
      <SearchBar month={month} onMonthChange={setMonth} query={query} onQueryChange={setQuery} />
      <div className="text-slate-600 text-sm font-medium">Các lần ghi trước:</div>
  

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div></div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <ViewSwitch value={view} onChange={setView} />
          <button onClick={openCreateRoom} className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm sm:text-base">Thêm phòng</button>
        </div>
      </div>

      {/* Bảng: từ lg trở lên; dưới lg (gồm iPhone ngang ~844px) dùng thẻ để không ép cuộn ngang */}
      {view === 'table' && (
        <>
          <div className="lg:hidden grid gap-3 sm:gap-4">
            {visibleRooms.map(r => <Card key={r.id} room={r} />)}
          </div>
          <div className="hidden lg:block rounded-2xl border bg-white p-4 shadow-sm">
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="min-w-[720px] w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="p-2 whitespace-nowrap">Phòng</th>
                <th className="p-2 min-w-[8rem]">Khách</th>
                <th className="p-2 whitespace-nowrap">Tháng</th>
                <th className="p-2 whitespace-nowrap">Tiền phòng</th>
                <th className="p-2 whitespace-nowrap">Điện</th>
                <th className="p-2 whitespace-nowrap">Nước</th>
                <th className="p-2 whitespace-nowrap">Tổng</th>
                <th className="p-2 whitespace-nowrap">Trạng thái</th>
                <th className="p-2 whitespace-nowrap">Tác vụ</th>
              </tr>
            </thead>
            <tbody>
              {roomItems.map(({ room, occupants, tenant, reading, invoice, draft })=> (
                <tr key={room.id} className="border-t border-slate-100">
                  <td className="p-2 font-medium whitespace-nowrap">{room.name}</td>
                  <td className="p-2 max-w-[12rem]">{(occupants.length? occupants.map(t=>t.name).join(', ') : <i className="text-slate-400">(chưa có)</i>)}</td>
                  <td className="p-2 whitespace-nowrap">{month}</td>
                  <td className="p-2 whitespace-nowrap">{currency(room.baseRent)}</td>
                  <td className="p-2 whitespace-nowrap">{currency(draft.eAmt)} <span className="text-slate-400">({draft.eUse} kWh)</span></td>
                  <td className="p-2 whitespace-nowrap">{currency(draft.wAmt)} <span className="text-slate-400">({draft.wUse} m³)</span></td>
                  <td className="p-2 font-semibold whitespace-nowrap">{currency(invoice? invoice.total : draft.totalDraft)}</td>
                  <td className="p-2">{invoice ? <span className={'rounded-full px-2 py-1 text-xs whitespace-nowrap ' + (invoice.status === 'Đã thanh toán' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>{invoice.status}</span> : <span className="rounded-full px-2 py-1 text-xs bg-amber-100 text-amber-700 whitespace-nowrap">Chưa tạo HĐ</span>}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={()=>openEditRoom(room)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Sửa phòng</button>
                      <button type="button" onClick={()=>openTenantManager(room.id)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Quản lý khách</button>
                      <button type="button" onClick={()=>removeRoom(room.id)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
        </>
      )}

      {/* Readings moved to Meter page - removed from Rooms UI */}


      {view === 'cards' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {visibleRooms.map(r=> <Card key={r.id} room={r} />)}
        </div>
      )}

      {/* ===== Room Modal ===== */}
      {roomModal.open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow">
            <div className="mb-3 text-lg font-semibold">{roomModal.mode==='edit'? 'Cập nhật phòng' : 'Thêm phòng'}</div>
            <form onSubmit={saveRoom} className="grid grid-cols-2 gap-3">
              <input className="col-span-2 rounded-xl border px-3 py-2" placeholder="Tên phòng (VD: P201)" value={roomModal.form.name}
                     onChange={e=>setRoomModal(m=>({...m, form:{...m.form, name:e.target.value}}))} />
              <div>
                <label className="text-xs text-slate-500">Tiền phòng (VNĐ)</label>
                <input type="number" className="w-full rounded-xl border px-3 py-2" value={roomModal.form.baseRent}
                       onChange={e=>setRoomModal(m=>({...m, form:{...m.form, baseRent:e.target.value}}))} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Giá điện (đ/kWh)</label>
                <input type="number" className="w-full rounded-xl border px-3 py-2" value={roomModal.form.electricRate}
                       onChange={e=>setRoomModal(m=>({...m, form:{...m.form, electricRate:e.target.value}}))} />
              </div>
              <div>
                <label className="text-xs text-slate-500">Giá nước (đ/m³)</label>
                <input type="number" className="w-full rounded-xl border px-3 py-2" value={roomModal.form.waterRate}
                       onChange={e=>setRoomModal(m=>({...m, form:{...m.form, waterRate:e.target.value}}))} />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <button className="rounded-xl bg-emerald-600 text-white px-4 py-2">Lưu</button>
                <button type="button" onClick={()=>setRoomModal(m=>({...m, open:false}))} className="rounded-xl border px-4 py-2">Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== Tenant Manager Modal ===== */}
      {tenantModal.open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-3xl rounded-none sm:rounded-2xl bg-white shadow-lg flex flex-col max-h-[100dvh] sm:max-h-[min(90dvh,900px)]">
            <div className="flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0">
                <div className="text-base sm:text-lg font-semibold leading-snug">Quản lý khách thuê</div>
                <div className="text-sm text-slate-600 mt-0.5">Phòng <span className="font-medium text-slate-800">{roomMap[tenantModal.roomId]?.name}</span></div>
              </div>
              <button type="button" onClick={()=>setTenantModal(m=>({...m, open:false}))} className="flex-shrink-0 rounded-xl border px-3 py-2 text-sm">Đóng</button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4 space-y-4">
              {/* Mobile: card list */}
              <div className="lg:hidden space-y-3">
                {(tenantByRoom[tenantModal.roomId]||[]).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">Chưa có khách trong phòng này.</div>
                ) : (
                  (tenantByRoom[tenantModal.roomId]||[]).map(t => (
                    <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{t.name}</div>
                          {roomMap[tenantModal.roomId]?.primaryTenantId === t.id && (
                            <span className="inline-block mt-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">Đại diện TT ★</span>
                          )}
                        </div>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm mb-3">
                        <div>
                          <dt className="text-xs text-slate-500">CCCD</dt>
                          <dd className="font-mono text-slate-800 break-all">{t.cccd}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-500">SĐT</dt>
                          <dd className="text-slate-800">{t.phone || '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-500">Từ ngày</dt>
                          <dd>{t.startDate ? (new Date(t.startDate)).toLocaleDateString('vi-VN') : '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-500">Đến ngày</dt>
                          <dd>{t.endDate ? (new Date(t.endDate)).toLocaleDateString('vi-VN') : '—'}</dd>
                        </div>
                      </dl>
                      <div className="flex flex-col gap-2">
                        <button type="button" onClick={()=>editTenant(t)} className="w-full rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium">Sửa</button>
                        <button type="button" onClick={()=>setPrimaryTenant(tenantModal.roomId, t.id)} className="w-full rounded-lg border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-medium text-emerald-800">Đặt đại diện thanh toán</button>
                        <button type="button" onClick={()=>removeTenant(t.id)} className="w-full rounded-lg border border-rose-200 bg-rose-50 py-2.5 text-sm font-medium text-rose-800">Xóa</button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* md+: table */}
              <div className="hidden lg:block overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="p-2 text-left whitespace-nowrap">Họ tên</th>
                      <th className="p-2 text-left whitespace-nowrap">CCCD</th>
                      <th className="p-2 text-left whitespace-nowrap">SĐT</th>
                      <th className="p-2 text-left whitespace-nowrap">Từ ngày</th>
                      <th className="p-2 text-left whitespace-nowrap">Đến ngày</th>
                      <th className="p-2 text-left whitespace-nowrap">Đại diện TT</th>
                      <th className="p-2 text-left whitespace-nowrap">Tác vụ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tenantByRoom[tenantModal.roomId]||[]).map(t=> (
                      <tr key={t.id} className="border-t border-slate-100">
                        <td className="p-2 align-top">{t.name}</td>
                        <td className="p-2 font-mono align-top text-xs sm:text-sm">{t.cccd}</td>
                        <td className="p-2 align-top">{t.phone||''}</td>
                        <td className="p-2 align-top whitespace-nowrap">{t.startDate? (new Date(t.startDate)).toLocaleDateString('vi-VN') : ''}</td>
                        <td className="p-2 align-top whitespace-nowrap">{t.endDate? (new Date(t.endDate)).toLocaleDateString('vi-VN') : ''}</td>
                        <td className="p-2 align-top">{roomMap[tenantModal.roomId]?.primaryTenantId===t.id? '★' : ''}</td>
                        <td className="p-2 align-top">
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" onClick={()=>editTenant(t)} className="rounded border px-2 py-1 text-xs sm:text-sm">Sửa</button>
                            <button type="button" onClick={()=>removeTenant(t.id)} className="rounded border px-2 py-1 text-xs sm:text-sm">Xóa</button>
                            <button type="button" onClick={()=>setPrimaryTenant(tenantModal.roomId, t.id)} className="rounded border px-2 py-1 text-xs sm:text-sm">Đặt đại diện</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form onSubmit={submitTenant} className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                <div className="sm:col-span-2 text-sm font-medium text-slate-700">{tenantModal.form.id ? 'Sửa khách' : 'Thêm khách mới'}</div>
                <input className="rounded-xl border border-slate-200 px-3 py-2.5 text-base sm:text-sm" placeholder="Họ tên" value={tenantModal.form.name} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, name:e.target.value}}))} />
                <input className="rounded-xl border border-slate-200 px-3 py-2.5 text-base sm:text-sm" placeholder="SĐT" inputMode="tel" autoComplete="tel" value={tenantModal.form.phone} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, phone:e.target.value}}))} />
                <input className="sm:col-span-2 rounded-xl border border-slate-200 px-3 py-2.5 text-base sm:text-sm" placeholder="CCCD" inputMode="numeric" value={tenantModal.form.cccd} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, cccd:e.target.value}}))} />

                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Ngày bắt đầu</label>
                    <input type="date" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base sm:text-sm" value={tenantModal.form.startDate} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, startDate:e.target.value}}))} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Ngày kết thúc</label>
                    <input type="date" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base sm:text-sm" value={tenantModal.form.endDate} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, endDate:e.target.value}}))} />
                  </div>
                </div>

                <div className="sm:col-span-2 flex flex-col-reverse sm:flex-row sm:items-center gap-2 pt-1">
                  <button type="submit" className="w-full sm:w-auto rounded-xl bg-emerald-600 text-white px-4 py-3 sm:py-2 text-base sm:text-sm font-medium">{tenantModal.form.id? 'Cập nhật khách':'Thêm khách'}</button>
                  {tenantModal.form.id && (<button type="button" className="w-full sm:w-auto rounded-xl border px-4 py-3 sm:py-2 text-base sm:text-sm" onClick={()=>setTenantModal(m=>({...m, form:{ id:null, name:'', cccd:'', phone:'', startDate:'', endDate:'' }}))}>Hủy sửa</button>)}
                </div>
              </form>

              <div className="text-xs text-slate-500 leading-relaxed pb-1">Mẹo: có thể đặt 1 người làm <b>Đại diện TT</b> (đại diện thanh toán) cho phòng; hoá đơn sẽ ưu tiên gắn người này.</div>
            </div>
          </div>
        </div>
      )}
      <Footer></Footer>
    </Page>
  );
}
