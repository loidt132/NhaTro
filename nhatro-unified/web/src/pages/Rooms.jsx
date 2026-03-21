
// src/pages/Rooms.jsx
import React, { useMemo, useState } from 'react';
import TopStats from '../components/TopStats';
import SearchBar from '../components/SearchBar';
import TotalsBar from '../components/TotalsBar';
import { loadState, saveState, monthKey, currency, uid, calcTotals } from '../utils/state';
import Footer from '../components/Footer';

export default function Rooms(){
  const [state, setState] = useState(loadState());
  const [month, setMonth] = useState(monthKey());
  const { rooms, tenants, readings, invoices, payments } = state;

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
    const s2 = { ...state, rooms: nextRooms };
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
  const [tenantModal, setTenantModal] = useState({ open:false, roomId:null, form:{ id:null, name:'', cccd:'', phone:'' } });
  const openTenantManager = (roomId)=> setTenantModal({ open:true, roomId, form:{ id:null, name:'', cccd:'', phone:'' } });

  const submitTenant = (e)=>{
    e.preventDefault();
    const f = tenantModal.form; const name=(f.name||'').trim(); const cccd=(f.cccd||'').trim();
    if(!name || !cccd) return alert('Nhập đủ Họ tên và CCCD');
    const payload = { id: f.id || uid(), name, cccd, phone:(f.phone||'').trim(), roomId: tenantModal.roomId };
    const nextTenants = f.id ? tenants.map(t=> t.id===f.id? payload : t) : [...tenants, payload];
    const s2 = { ...state, tenants: nextTenants };
    setState(s2); saveState(s2);
    setTenantModal(tm=> ({ ...tm, form:{ id:null, name:'', cccd:'', phone:'' } }));
  };

  const editTenant = (t)=> setTenantModal(tm=> ({ ...tm, form:{ id:t.id, name:t.name, cccd:t.cccd, phone:t.phone||'' } }));
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
    <div className="space-y-4">
      <TopStats rooms={rooms.length} tenants={tenants.length} invoices={invoices.length} debts={unpaidCount} />
      <SearchBar month={month} onMonthChange={setMonth} />
      <div className="text-slate-600 text-sm font-medium">Các lần ghi trước:</div>
      <TotalsBar sumPaid={sumPaid} sumDebt={sumDebt} />

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">Quản trị phòng và khách thuê từ giao diện thẻ bên dưới.</div>
        <button onClick={openCreateRoom} className="rounded-xl bg-emerald-600 text-white px-4 py-2">Thêm phòng</button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rooms.map(r=> <Card key={r.id} room={r} />)}
      </div>

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
              <div className="col-span-3 flex items-center gap-2">
                <button className="rounded-xl bg-emerald-600 text-white px-4 py-2">{tenantModal.form.id? 'Cập nhật khách':'Thêm khách'}</button>
                {tenantModal.form.id && (<button type="button" className="rounded-xl border px-4 py-2" onClick={()=>setTenantModal(m=>({...m, form:{ id:null, name:'', cccd:'', phone:'' }}))}>Hủy sửa</button>)}
              </div>
            </form>

            <div className="text-xs text-slate-500">Mẹo: có thể đặt 1 người làm <b>Đại diện TT</b> (đại diện thanh toán) cho phòng; hoá đơn sẽ ưu tiên gắn người này.</div>
          </div>
        </div>
      )}
<Footer></Footer>
    </div>
  );
}
