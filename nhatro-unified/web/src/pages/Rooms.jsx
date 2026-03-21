
// src/pages/Rooms.jsx
import React, { useMemo, useState } from 'react';
import TopStats from '../components/TopStats';
import SearchBar from '../components/SearchBar';
import TotalsBar from '../components/TotalsBar';
import ViewSwitch from '../components/ViewSwitch';
import Page from '../components/Page';
import { loadState, saveState, monthKey, currency, uid, calcTotals } from '../utils/state';
import Footer from '../components/Footer';

export default function Rooms(){
  const [state, setState] = useState(loadState());
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
  const [view, setView] = useState('table'); // 'table' or 'cards'

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

  const roomsOccupiedCount = useMemo(() => {
    const { first, last } = getMonthBounds(month);
    const roomIds = new Set((tenants||[]).filter(t => isTenantActiveForMonth(t, month)).map(t => t.roomId));
    return (rooms||[]).filter(r => roomIds.has(r.id)).length;
  }, [rooms, tenants, month]);

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
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">PHÒNG {room.name}</div>
          <span className={`rounded-full px-2 py-1 text-xs ${badge}`}>{status}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
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
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{currency(total)} đ</div>
          <div className="flex items-center gap-2">
            <button onClick={()=>openEditRoom(room)} className="rounded-lg border px-3 py-1 text-sm">Sửa phòng</button>
            <button onClick={()=>openTenantManager(room.id)} className="rounded-lg border px-3 py-1 text-sm">Quản lý khách</button>
            <button onClick={()=>removeRoom(room.id)} className="rounded-lg border px-3 py-1 text-sm">Xóa</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Page className="space-y-4">
      <TopStats rooms={roomsOccupiedCount} tenants={tenantsActiveCount} invoices={invoicesForMonth} debts={unpaidForMonth} />
  <SearchBar month={month} onMonthChange={setMonth} query={query} onQueryChange={setQuery} />
      <div className="text-slate-600 text-sm font-medium">Các lần ghi trước:</div>
      <TotalsBar sumPaid={sumPaid} sumDebt={sumDebt} />

      <div className="flex items-center justify-between">
        <div></div>
        <div className="flex items-center gap-3">
          <ViewSwitch value={view} onChange={setView} />
          <button onClick={openCreateRoom} className="rounded-xl bg-emerald-600 text-white px-4 py-2">Thêm phòng</button>
        </div>
      </div>

      {/* Payments-style table (rooms) */}
      {view === 'table' && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="p-2">Phòng</th>
                <th className="p-2">Khách</th>
                <th className="p-2">Tháng</th>
                <th className="p-2">Tiền phòng</th>
                <th className="p-2">Điện</th>
                <th className="p-2">Nước</th>
                <th className="p-2">Tổng</th>
                <th className="p-2">Trạng thái</th>
                <th className="p-2">Tác vụ</th>
              </tr>
            </thead>
            <tbody>
              {roomItems.map(({ room, occupants, tenant, reading, invoice, draft })=> (
                <tr key={room.id} className="border-t">
                  <td className="p-2 font-medium">{room.name}</td>
                  <td className="p-2">{(occupants.length? occupants.map(t=>t.name).join(', ') : <i className="text-slate-400">(chưa có)</i>)}</td>
                  <td className="p-2">{month}</td>
                  <td className="p-2">{currency(room.baseRent)}</td>
                  <td className="p-2">{currency(draft.eAmt)} <span className="text-slate-400">({draft.eUse} kWh)</span></td>
                  <td className="p-2">{currency(draft.wAmt)} <span className="text-slate-400">({draft.wUse} m³)</span></td>
                  <td className="p-2 font-semibold">{currency(invoice? invoice.total : draft.totalDraft)}</td>
                  <td className="p-2">{invoice ? <span className={'rounded-full px-2 py-1 text-xs ' + (invoice.status === 'Đã thanh toán' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>{invoice.status}</span> : <span className="rounded-full px-2 py-1 text-xs bg-amber-100 text-amber-700">Chưa tạo HĐ</span>}</td>
                  <td className="p-2 space-x-2">
                    <button onClick={()=>openEditRoom(room)} className="rounded-lg border px-3 py-1 text-sm">Sửa phòng</button>
                    <button onClick={()=>openTenantManager(room.id)} className="rounded-lg border px-3 py-1 text-sm">Quản lý khách</button>
                    <button onClick={()=>removeRoom(room.id)} className="rounded-lg border px-3 py-1 text-sm">Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* Readings moved to Meter page - removed from Rooms UI */}


      {view === 'cards' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
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
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Quản lý khách thuê — Phòng {roomMap[tenantModal.roomId]?.name}</div>
              <button onClick={()=>setTenantModal(m=>({...m, open:false}))} className="rounded-xl border px-3 py-1">Đóng</button>
            </div>

            <div className="overflow-auto border rounded">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="p-2 text-left">Họ tên</th>
                    <th className="p-2 text-left">CCCD</th>
                    <th className="p-2 text-left">SĐT</th>
                    <th className="p-2 text-left">Từ ngày</th>
                    <th className="p-2 text-left">Đến ngày</th>
                    <th className="p-2 text-left">Đại diện TT</th>
                    <th className="p-2 text-left">Tác vụ</th>
                  </tr>
                </thead>
                <tbody>
                  {(tenantByRoom[tenantModal.roomId]||[]).map(t=> (
                    <tr key={t.id} className="border-t">
                        <td className="p-2">{t.name}</td>
                        <td className="p-2 font-mono">{t.cccd}</td>
                        <td className="p-2">{t.phone||''}</td>
                        <td className="p-2">{t.startDate? (new Date(t.startDate)).toLocaleDateString() : ''}</td>
                        <td className="p-2">{t.endDate? (new Date(t.endDate)).toLocaleDateString() : ''}</td>
                        <td className="p-2">{roomMap[tenantModal.roomId]?.primaryTenantId===t.id? '★' : ''}</td>
                        <td className="p-2 space-x-2">
                        <button onClick={()=>editTenant(t)} className="rounded border px-3 py-1">Sửa</button>
                        <button onClick={()=>removeTenant(t.id)} className="rounded border px-3 py-1">Xóa</button>
                        <button onClick={()=>setPrimaryTenant(tenantModal.roomId, t.id)} className="rounded border px-3 py-1">Đặt đại diện</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form onSubmit={submitTenant} className="grid grid-cols-3 gap-3">
              <input className="rounded-xl border px-3 py-2" placeholder="Họ tên" value={tenantModal.form.name} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, name:e.target.value}}))} />
              <input className="rounded-xl border px-3 py-2" placeholder="SĐT" value={tenantModal.form.phone} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, phone:e.target.value}}))} />
              <input className="col-span-3 rounded-xl border px-3 py-2" placeholder="CCCD" value={tenantModal.form.cccd} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, cccd:e.target.value}}))} />

              <div className="col-span-3 grid grid-cols-2 gap-3">
                <input type="date" className="rounded-xl border px-3 py-2" placeholder="Ngày bắt đầu" value={tenantModal.form.startDate} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, startDate:e.target.value}}))} />
                <input type="date" className="rounded-xl border px-3 py-2" placeholder="Ngày kết thúc" value={tenantModal.form.endDate} onChange={e=>setTenantModal(m=>({...m, form:{...m.form, endDate:e.target.value}}))} />
              </div>

              <div className="col-span-3 flex items-center gap-2">
                <button className="rounded-xl bg-emerald-600 text-white px-4 py-2">{tenantModal.form.id? 'Cập nhật khách':'Thêm khách'}</button>
                {tenantModal.form.id && (<button type="button" className="rounded-xl border px-4 py-2" onClick={()=>setTenantModal(m=>({...m, form:{ id:null, name:'', cccd:'', phone:'', startDate:'', endDate:'' }}))}>Hủy sửa</button>)}
              </div>
            </form>

            <div className="text-xs text-slate-500">Mẹo: có thể đặt 1 người làm <b>Đại diện TT</b> (đại diện thanh toán) cho phòng; hoá đơn sẽ ưu tiên gắn người này.</div>
          </div>
        </div>
      )}
      <Footer></Footer>
    </Page>
  );
}
