// src/pages/Meter.jsx
import React, { useMemo, useState } from 'react';
import { loadState, saveState, monthKey, uid, calcTotals } from '../utils/state';
import SearchBar from '../components/SearchBar';
import TotalsBar from '../components/TotalsBar';
import Footer from '../components/Footer';

export default function Meter() {
  const [state, setState] = useState(loadState());
  const { rooms, tenants, invoices, payments, settings } = state;
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

  const submit = (e) => {
    e.preventDefault();
    if (!form.roomId) return alert('Chọn phòng');

    const reading = {
      id: uid(),
      ...form,
      electricStart: +form.electricStart,
      electricEnd: +form.electricEnd,
      waterStart: +form.waterStart,
      waterEnd: +form.waterEnd,
      createdAt: new Date().toISOString()
    };

    const next = {
      ...state,
      readings: [reading, ...(state.readings || [])]
    };

    setState(next);
    saveState(next);
    alert('Đã lưu chỉ số');
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

      <form onSubmit={submit} className="border rounded-xl bg-white p-4 space-y-3">
        <select
          className="w-full border rounded px-3 py-2"
          value={form.roomId}
          onChange={e => setForm({ ...form, roomId: e.target.value })}
        >
          <option value="">— Chọn phòng —</option>
          {filteredRooms.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>

        <h4 className="font-semibold">Chỉ số điện (kWh)</h4>
        <input placeholder="Điện đầu (kWh)" className="input" onChange={e=>setForm({...form,electricStart:e.target.value})}/>
        <input placeholder="Điện cuối (kWh)" className="input" onChange={e=>setForm({...form,electricEnd:e.target.value})}/>

        <h4 className="font-semibold">Chỉ số nước (m³)</h4>
        <input placeholder="Nước đầu (m³)" className="input" onChange={e=>setForm({...form,waterStart:e.target.value})}/>
        <input placeholder="Nước cuối (m³)" className="input" onChange={e=>setForm({...form,waterEnd:e.target.value})}/>

        <button className="bg-emerald-600 text-white px-4 py-2 rounded">
          Lưu chỉ số
        </button>
      </form>

      <TotalsBar sumPaid={sumPaid} sumDebt={sumDebt} />
      <Footer />
    </div>
  );
}
