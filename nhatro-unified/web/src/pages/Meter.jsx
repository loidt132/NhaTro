// src/pages/Meter.jsx
import React, { useMemo, useState } from 'react';
import { loadState, saveState, monthKey, uid, calcTotals } from '../utils/state';
import SearchBar from '../components/SearchBar';
import TotalsBar from '../components/TotalsBar';
import Footer from '../components/Footer';

export default function Meter() {
  const [state, setState] = useState(loadState());
  const { rooms, tenants, readings = [], invoices, payments, settings } = state;
  const [month, setMonth] = useState(monthKey());
  const [query, setQuery] = useState('');

  const [form, setForm] = useState({
    roomId: '',
    month,
    electricStart: '',
    electricEnd: '',
    waterStart: '',
    waterEnd: ''
  });

  const getMonthBounds = (ym) => {
    const y = +ym.slice(0, 4);
    const m = +ym.slice(5, 7);
    const d = new Date(y, m, 0).getDate();
    return { first: `${ym}-01`, last: `${ym}-${String(d).padStart(2, '0')}` };
  };

  const isActiveTenant = (t) => {
    const mode = settings?.occupancyMode || 'month';
    const s = (t.startDate || '').slice(0, 10);
    const e = (t.endDate || '').slice(0, 10);

    if (mode === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      return (!s || s <= today) && (!e || e >= today);
    }

    const { first, last } = getMonthBounds(month);
    return (s || '0000-01-01') <= last && (e || '9999-12-31') >= first;
  };

  const tenantsByRoom = useMemo(() => {
    const m = {};
    tenants.forEach(t => {
      if (!m[t.roomId]) m[t.roomId] = [];
      m[t.roomId].push(t);
    });
    return m;
  }, [tenants]);

  const filteredRooms = useMemo(() => {
    const scope = settings?.meterRoomScope || 'occupied';
    let base = rooms;

    if (scope === 'occupied') {
      base = rooms.filter(r => (tenantsByRoom[r.id] || []).some(isActiveTenant));
    }

    const q = query.toLowerCase();
    if (!q) return base;

    return base.filter(r =>
      r.name.toLowerCase().includes(q)
    );
  }, [rooms, tenantsByRoom, query, settings?.meterRoomScope, settings?.occupancyMode, month]);

  // rooms that already have a reading for the selected month
  const recordedRooms = useMemo(() => {
    const seen = new Set((readings || []).filter(r => r.month === month).map(r => r.roomId));
    return rooms.filter(r => seen.has(r.id));
  }, [rooms, readings, month]);

  // unrecorded rooms (respecting filteredRooms scope and search)
  const unrecordedRooms = useMemo(() => {
    const recIds = new Set(recordedRooms.map(r => r.id));
    return filteredRooms.filter(r => !recIds.has(r.id));
  }, [filteredRooms, recordedRooms]);

  const submit = (e) => {
    e.preventDefault();
    if (!form.roomId) return alert('Chọn phòng');
    const nowIso = new Date().toISOString();
    if (form.id) {
      // update existing reading
      const nextReadings = (state.readings || []).map(r => r.id === form.id ? ({
        ...r,
        roomId: form.roomId,
        month: form.month || month,
        electricStart: +form.electricStart,
        electricEnd: +form.electricEnd,
        waterStart: +form.waterStart,
        waterEnd: +form.waterEnd,
        updatedAt: nowIso
      }) : r);
      const next = { ...state, readings: nextReadings };
      setState(next); saveState(next);
      alert('Đã cập nhật chỉ số');
    } else {
      const reading = {
        id: uid(),
        roomId: form.roomId,
        month: form.month || month,
        electricStart: +form.electricStart,
        electricEnd: +form.electricEnd,
        waterStart: +form.waterStart,
        waterEnd: +form.waterEnd,
        createdAt: nowIso
      };
      const next = { ...state, readings: [reading, ...(state.readings || [])] };
      setState(next); saveState(next);
      alert('Đã lưu chỉ số');
    }

    // reset form
    setForm({ roomId: '', month, electricStart: '', electricEnd: '', waterStart: '', waterEnd: '' });
  };

  const { sumPaid, sumDebt } = calcTotals(invoices, payments, month);

  return (
    <div className="space-y-4">
      <SearchBar
        month={month}
        onMonthChange={setMonth}
        query={query}
        onQueryChange={setQuery}
      />

      <div className="grid gap-3">
        {recordedRooms.length > 0 && (
          <div className="border rounded-xl bg-white p-3">
            <div className="font-semibold mb-2">Phòng đã ghi chỉ số — {month}</div>
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
                  {recordedRooms.map(r => {
                    const reading = (readings || []).find(x => x.roomId === r.id && x.month === month);
                    const occupants = (tenants || []).filter(t => t.roomId === r.id);
                    const occActive = occupants.filter(isActiveTenant);
                    const tenantId = r.primaryTenantId ?? occActive[0]?.id ?? occupants[0]?.id;
                    const tenantNames = (occActive.length ? occActive : occupants).map(t => t.name).join(', ');
                    const inv = (state.invoices || []).find(i => i.roomId === r.id && i.month === month);
                    const eUse = reading ? Math.max(0, (reading.electricEnd || 0) - (reading.electricStart || 0)) : 0;
                    const wUse = reading ? Math.max(0, (reading.waterEnd || 0) - (reading.waterStart || 0)) : 0;
                    const eAmt = eUse * (r.electricRate ?? 0);
                    const wAmt = wUse * (r.waterRate ?? 0);
                    const totalDraft = (r.baseRent ?? 0) + eAmt + wAmt;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 font-medium">{r.name}</td>
                        <td className="p-2">{tenantNames || <i className="text-slate-400">(chưa có)</i>}</td>
                        <td className="p-2">{month}</td>
                        <td className="p-2">{(r.baseRent||0).toLocaleString('vi-VN')}</td>
                        <td className="p-2">{eAmt.toLocaleString('vi-VN')} <span className="text-slate-400">({eUse} kWh)</span></td>
                        <td className="p-2">{wAmt.toLocaleString('vi-VN')} <span className="text-slate-400">({wUse} m³)</span></td>
                        <td className="p-2 font-semibold">{(inv ? inv.total : totalDraft).toLocaleString('vi-VN')}</td>
                        <td className="p-2">{inv ? <span className={'rounded-full px-2 py-1 text-xs ' + (inv.status === 'Đã thanh toán' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>{inv.status}</span> : <span className="rounded-full px-2 py-1 text-xs bg-amber-100 text-amber-700">Chưa tạo HĐ</span>}</td>
                        <td className="p-2 space-x-2">
                          {!inv && (<button onClick={() => {
                            // create invoice from reading
                            const t = (tenants || []).find(x => x.id === tenantId) || occupants[0];
                            if (!reading) return alert('Không có chỉ số để tạo hóa đơn');
                            if (!t) return alert('Phòng chưa có khách');
                            const eUse2 = Math.max(0, (reading.electricEnd || 0) - (reading.electricStart || 0));
                            const wUse2 = Math.max(0, (reading.waterEnd || 0) - (reading.waterStart || 0));
                            const invObj = {
                              id: uid(), roomId: r.id, tenantId: t.id, month,
                              rent: r.baseRent || 0,
                              electricUsage: eUse2, electricEnd: reading.electricEnd, electricStart: reading.electricStart,
                              waterUsage: wUse2, waterEnd: reading.waterEnd, waterStart: reading.waterStart,
                              electricAmount: eUse2 * (r.electricRate || 0),
                              waterAmount: wUse2 * (r.waterRate || 0),
                              other: 0,
                              total: (r.baseRent || 0) + eUse2 * (r.electricRate || 0) + wUse2 * (r.waterRate || 0),
                              status: 'Còn nợ', createdAt: new Date().toISOString()
                            };
                            const s2 = { ...state, invoices: [invObj, ...(state.invoices || [])] };
                            setState(s2); saveState(s2);
                          }} className="rounded-lg border px-3 py-1 text-sm">Tạo hóa đơn</button>)}
                          {inv && (<button onClick={() => {
                            const next = (state.invoices || []).map(i => i.id === inv.id ? ({ ...i, status: i.status === 'Đã thanh toán' ? 'Còn nợ' : 'Đã thanh toán', paidAt: i.status === 'Đã thanh toán' ? undefined : new Date().toISOString() }) : i);
                            const s2 = { ...state, invoices: next };
                            setState(s2); saveState(s2);
                          }} className="rounded-lg border px-3 py-1 text-sm">{inv?.status === 'Đã thanh toán' ? 'Đánh dấu còn nợ' : 'Đánh dấu đã trả'}</button>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="border rounded-xl bg-white p-4 space-y-3">
          <select
            className="w-full border rounded px-3 py-2"
            value={form.roomId}
            onChange={e => setForm({ ...form, roomId: e.target.value })}
          >
            <option value="">— Chọn phòng —</option>
            {(() => {
              const opts = [];
              // if currently editing an existing reading, ensure its room appears in select
              if (form.roomId) {
                const cur = rooms.find(rr => rr.id === form.roomId);
                if (cur && !unrecordedRooms.some(u => u.id === cur.id)) {
                  opts.push(<option key={cur.id} value={cur.id}>{cur.name}</option>);
                }
              }
              return opts.concat(unrecordedRooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              )));
            })()}
          </select>

          <h4 className="font-semibold">Chỉ số điện (kWh)</h4>
          <input placeholder="Điện đầu (kWh)" className="input" value={form.electricStart} onChange={e=>setForm({...form,electricStart:e.target.value})}/>
          <input placeholder="Điện cuối (kWh)" className="input" value={form.electricEnd} onChange={e=>setForm({...form,electricEnd:e.target.value})}/>

          <h4 className="font-semibold">Chỉ số nước (m³)</h4>
          <input placeholder="Nước đầu (m³)" className="input" value={form.waterStart} onChange={e=>setForm({...form,waterStart:e.target.value})}/>
          <input placeholder="Nước cuối (m³)" className="input" value={form.waterEnd} onChange={e=>setForm({...form,waterEnd:e.target.value})}/>

          <div className="flex items-center gap-2">
            <button className="bg-emerald-600 text-white px-4 py-2 rounded">Lưu chỉ số</button>
            {form.id && (<button type="button" onClick={()=>setForm({ roomId:'', month, electricStart:'', electricEnd:'', waterStart:'', waterEnd:'' })} className="rounded border px-3 py-2">Hủy sửa</button>)}
          </div>
        </form>
      </div>
      <TotalsBar sumPaid={sumPaid} sumDebt={sumDebt} />
      <Footer />
    </div>
  );
}
