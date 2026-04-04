// src/pages/Meter.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { loadState, saveState, monthKey, uid, calcTotals, hydrateState } from '../utils/state';
import SearchBar from '../components/SearchBar';
import TotalsBar from '../components/TotalsBar';
import Footer from '../components/Footer';
import Page from '../components/Page';

export default function Meter() {
  const [state, setState] = useState(loadState());
  useEffect(() => {
    const handler = () => setState(loadState());
    window.addEventListener('boarding_state_updated', handler);
    hydrateState({ tables: ['rooms', 'tenants', 'readings', 'invoices', 'payments', 'settings'] });
    return () => window.removeEventListener('boarding_state_updated', handler);
  }, []);
  const { rooms, tenants, readings = [], invoices, payments, settings } = state;
  const [month, setMonth] = useState(monthKey());
  const [query, setQuery] = useState('');

  const [form, setForm] = useState({
    roomId: '',
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

  const roomMap = useMemo(() => {
    const m = {};
    rooms.forEach(r => { m[r.id] = r; });
    return m;
  }, [rooms]);

  const readingsOfMonth = useMemo(() => {
    const list = (readings || []).filter(r => r.month === month);
    // sort readings by room name for consistent order
    return list.slice().sort((a, b) => (roomMap[a.roomId]?.name || '').localeCompare(roomMap[b.roomId]?.name || ''));
  }, [readings, month, roomMap]);

  const onEditReading = (r) => {
    // load reading into form; month is always the currently selected month
    setForm({
      id: r.id,
      roomId: r.roomId,
      electricStart: r.electricStart?.toString() ?? '',
      electricEnd: r.electricEnd?.toString() ?? '',
      waterStart: r.waterStart?.toString() ?? '',
      waterEnd: r.waterEnd?.toString() ?? ''
    });
  };

  const onDeleteReading = (id) => {
    if (!window.confirm('Xóa chỉ số này?')) return;
    const nextReadings = (state.readings || []).filter(x => x.id !== id);
    const s2 = { ...state, readings: nextReadings };
    setState(s2); saveState(s2);
  };

  const filteredRooms = useMemo(() => {
    const scope = settings?.meterRoomScope || 'occupied';
    let base = rooms || [];

    if (scope === 'occupied') {
      // build a set of roomIds that have at least one tenant active for the selected month
      const occ = new Set((tenants || []).filter(isActiveTenant).map(t => t.roomId));
      base = (rooms || []).filter(r => occ.has(r.id));
    }

    const q = (query || '').toLowerCase();
    let filtered = q ? base.filter(r => r.name && r.name.toLowerCase().includes(q)) : base;
    // sort by room name
    return filtered.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rooms, tenants, query, settings?.meterRoomScope, settings?.occupancyMode, month]);

  // rooms that already have a reading for the selected month
  const recordedRooms = useMemo(() => {
    const seen = new Set((readings || []).filter(r => r.month === month).map(r => r.roomId));
    return (rooms || []).filter(r => seen.has(r.id)).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rooms, readings, month]);

  // unrecorded rooms (respecting filteredRooms scope and search)
  const unrecordedRooms = useMemo(() => {
    const recIds = new Set(recordedRooms.map(r => r.id));
    return filteredRooms.filter(r => !recIds.has(r.id));
  }, [filteredRooms, recordedRooms]);

  // readings for the selected month, filtered by search query
  const readingsVisible = useMemo(() => {
    const q = (query || '').toLowerCase();
    if (!q) return readingsOfMonth;
    return readingsOfMonth.filter(r => (roomMap[r.roomId]?.name || '').toLowerCase().includes(q));
  }, [readingsOfMonth, query, roomMap]);

  const submit = (e) => {
    e.preventDefault();
    if (!form.roomId) return alert('Chọn phòng');

    // Validation: ensure starts/ends are numeric when provided and end >= start
    const errors = [];
    const parseOrNull = (v) => (v === '' || v === null || v === undefined) ? null : Number(v);
    const es = parseOrNull(form.electricStart);
    const ee = parseOrNull(form.electricEnd);
    const ws = parseOrNull(form.waterStart);
    const we = parseOrNull(form.waterEnd);

    if ((es === null) !== (ee === null)) {
      errors.push('Nếu nhập chỉ số điện thì phải nhập cả Điện đầu và Điện cuối.');
    }
    if ((ws === null) !== (we === null)) {
      errors.push('Nếu nhập chỉ số nước thì phải nhập cả Nước đầu và Nước cuối.');
    }
    if (es !== null && ee !== null && Number.isFinite(es) && Number.isFinite(ee) && ee < es) {
      errors.push('Chỉ số Điện: Điện cuối phải lớn hơn hoặc bằng Điện đầu.');
    }
    if (ws !== null && we !== null && Number.isFinite(ws) && Number.isFinite(we) && we < ws) {
      errors.push('Chỉ số Nước: Nước cuối phải lớn hơn hoặc bằng Nước đầu.');
    }
    if (errors.length) return alert(errors.join('\n'));

    const nowIso = new Date().toISOString();
    if (form.id) {
      // update existing reading
      const nextReadings = (state.readings || []).map(r => r.id === form.id ? ({
        ...r,
        roomId: form.roomId,
        month: month,
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
        month: month,
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
    setForm({ roomId: '', electricStart: '', electricEnd: '', waterStart: '', waterEnd: '' });
  };

  const { sumPaid, sumDebt } = calcTotals(invoices, payments, month);

  return (
    <Page className="space-y-4">
      <TotalsBar sumPaid={sumPaid} sumDebt={sumDebt} />
      <SearchBar
        month={month}
        onMonthChange={setMonth}
        query={query}
        onQueryChange={setQuery}
      />

      <div className="grid gap-3">
        

        <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
          <select
            className="h-12 w-full rounded-lg border border-slate-200 px-3 text-base sm:h-auto sm:text-sm"
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
          <input placeholder="Điện đầu (kWh)" className="h-12 w-full rounded-lg border border-slate-200 px-3 text-base sm:h-10 sm:text-sm" value={form.electricStart} onChange={e=>setForm({...form,electricStart:e.target.value})}/>
          <input placeholder="Điện cuối (kWh)" className="h-12 w-full rounded-lg border border-slate-200 px-3 text-base sm:h-10 sm:text-sm" value={form.electricEnd} onChange={e=>setForm({...form,electricEnd:e.target.value})}/>

          <h4 className="font-semibold">Chỉ số nước (m³)</h4>
          <input placeholder="Nước đầu (m³)" className="h-12 w-full rounded-lg border border-slate-200 px-3 text-base sm:h-10 sm:text-sm" value={form.waterStart} onChange={e=>setForm({...form,waterStart:e.target.value})}/>
          <input placeholder="Nước cuối (m³)" className="h-12 w-full rounded-lg border border-slate-200 px-3 text-base sm:h-10 sm:text-sm" value={form.waterEnd} onChange={e=>setForm({...form,waterEnd:e.target.value})}/>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="submit" className="h-12 rounded-xl bg-emerald-600 px-4 text-base font-medium text-white sm:h-auto sm:py-2">Lưu chỉ số</button>
            {form.id && (<button type="button" onClick={()=>setForm({ roomId:'', month, electricStart:'', electricEnd:'', waterStart:'', waterEnd:'' })} className="h-12 rounded-xl border px-4 text-base sm:h-auto sm:py-2">Hủy sửa</button>)}
          </div>
        </form>
        {readingsVisible.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
            <div className="mb-3 font-semibold">Danh sách chỉ số — {month}</div>
            <div className="space-y-3 lg:hidden">
              {readingsVisible.map(r => {
                const eUse = Math.max(0, (r.electricEnd || 0) - (r.electricStart || 0));
                const wUse = Math.max(0, (r.waterEnd || 0) - (r.waterStart || 0));
                return (
                  <div key={r.id} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                    <div className="font-semibold text-slate-900">{roomMap[r.roomId]?.name || r.roomId}</div>
                    <dl className="mt-2 space-y-1 text-sm text-slate-700">
                      <div><span className="text-slate-500">Điện: </span>{(r.electricStart ?? '')} — {r.electricEnd ?? ''} <span className="text-slate-400">({eUse} kWh)</span></div>
                      <div><span className="text-slate-500">Nước: </span>{(r.waterStart ?? '')} — {r.waterEnd ?? ''} <span className="text-slate-400">({wUse} m³)</span></div>
                    </dl>
                    <div className="mt-3 flex flex-col gap-2">
                      <button type="button" onClick={() => onEditReading(r)} className="h-11 w-full rounded-lg border border-slate-200 bg-white text-sm font-medium">Sửa</button>
                      <button type="button" onClick={() => onDeleteReading(r.id)} className="h-11 w-full rounded-lg border border-rose-200 bg-rose-50 text-sm font-medium text-rose-800">Xóa</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="p-2">Phòng</th>
                    <th className="p-2">Điện</th>
                    <th className="p-2">Nước</th>
                    <th className="p-2">Tác vụ</th>
                  </tr>
                </thead>
                <tbody>
                  {readingsVisible.map(r => {
                    const eUse = Math.max(0, (r.electricEnd || 0) - (r.electricStart || 0));
                    const wUse = Math.max(0, (r.waterEnd || 0) - (r.waterStart || 0));
                    return (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="p-2 font-medium">{roomMap[r.roomId]?.name || r.roomId}</td>
                        <td className="p-2">{(r.electricStart ?? '') + ' — ' + (r.electricEnd ?? '')} <span className="text-slate-400">({eUse} kWh)</span></td>
                        <td className="p-2">{(r.waterStart ?? '') + ' — ' + (r.waterEnd ?? '')} <span className="text-slate-400">({wUse} m³)</span></td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" onClick={() => onEditReading(r)} className="rounded border px-2 py-1 text-xs sm:text-sm">Sửa</button>
                            <button type="button" onClick={() => onDeleteReading(r.id)} className="rounded border px-2 py-1 text-xs sm:text-sm">Xóa</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </Page>
  );
}
