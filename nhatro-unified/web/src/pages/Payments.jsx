// src/pages/Payments.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { loadState, saveState, currency, monthKey, calcTotals, uid, hydrateState } from '../utils/state';
import SearchBar from '../components/SearchBar';
import TotalsBar from '../components/TotalsBar';
import ViewSwitch from '../components/ViewSwitch';
import Footer from '../components/Footer';
import Page from '../components/Page';
import { exportInvoicePdfByJsPDF } from '../utils/pdf/exportInvoiceJspdf';

const makeAddInfo = (inv, rooms, settings) => {
  const tpl = (settings.qrNoteTemplate ?? 'Tien phong {room} {month}');
  const r = rooms.find(x => x.id === inv.roomId);
  return tpl.replaceAll('{room}', r?.name ?? '').replaceAll('{month}', inv.month);
};

const STATUS_UNPAID = 'Chưa thanh toán';
const STATUS_PAID = 'Đã thanh toán';

export default function Payments() {
  const [state, setState] = useState(loadState());
  // Keep in-sync with other parts of the app that call saveState()
  useEffect(() => {
    const handler = () => setState(loadState());
    window.addEventListener('boarding_state_updated', handler);
    hydrateState({ tables: ['rooms', 'tenants', 'readings', 'invoices', 'payments', 'settings'] });
    return () => window.removeEventListener('boarding_state_updated', handler);
  }, []);
  const { invoices, rooms, tenants, settings, payments, readings } = state;
  const [month, setMonth] = useState(monthKey());
  const [view, setView] = useState('cards');
  const [query, setQuery] = useState('');

  const todayYmd = new Date().toISOString().slice(0,10);
  const getMonthBounds = (ym)=>{
    const y = +ym.slice(0,4); const m = +ym.slice(5,7);
    const lastDay = new Date(y, m, 0).getDate();
    const first = `${ym}-01`;
    const last = `${ym}-${String(lastDay).padStart(2,'0')}`;
    return { first, last };
  };

  const isActiveTenant = (t)=>{
    const mode = (settings?.occupancyMode) || 'month';
    const s = (t.startDate ?? '').slice(0,10);
    const e = (t.endDate ?? '').slice(0,10);
    if(mode === 'today'){
      const startOk = !s || s <= todayYmd;
      const endOk = !e || e >= todayYmd;
      return startOk && endOk;
    } else {
      const { first, last } = getMonthBounds(month);
      const ss = s || '0000-01-01';
      const ee = e || '9999-12-31';
      return ss <= last && ee >= first;
    }
  };

  const roomMap = useMemo(() => Object.fromEntries(rooms.map(r => [r.id, r])), [rooms]);

  const tenantsByRoom = useMemo(() => {
    const m = {};
    tenants.forEach(t => { if (!m[t.roomId]) m[t.roomId] = []; m[t.roomId].push(t); });
    return m;
  }, [tenants]);

  const items = useMemo(
    () =>
      {
        const list = rooms.map(room => {
        const inv = invoices.find(i => i.roomId === room.id && i.month === month);
        const occupants = tenantsByRoom[room.id] ?? [];
        const occActive = occupants.filter(isActiveTenant);
        const tenantId = room.primaryTenantId ?? occActive[0]?.id ?? occupants[0]?.id;
        const tenant = occupants.find(t => t.id === tenantId);
        const reading = (readings ?? []).find(r => r.roomId === room.id && r.month === month);
        const eUse = Math.max(0, (reading?.electricEnd ?? 0) - (reading?.electricStart ?? 0));
        const wUse = Math.max(0, (reading?.waterEnd ?? 0) - (reading?.waterStart ?? 0));
        const eAmt = eUse * (room.electricRate ?? 0);
        const wAmt = wUse * (room.waterRate ?? 0);
        const totalDraft = (room.baseRent ?? 0) + eAmt + wAmt;
        const names = (occActive.length ? occActive : occupants).map(t => t.name).join(', ');
        return { room, occupants, names, tenant, reading, invoice: inv, draft: { eUse, wUse, eAmt, wAmt, totalDraft } };
      });
      // sort items by room name for consistent ordering across pages
      return list.slice().sort((a, b) => (a.room.name || '').localeCompare(b.room.name || ''));
    },
    [rooms, invoices, tenantsByRoom, readings, month, settings?.occupancyMode]
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(({ room, names, invoice }) => {
      const roomHit = room.name?.toLowerCase().includes(q);
      const namesHit = names?.toLowerCase().includes(q);
      const status = invoice?.status ?? 'Chưa tạo HĐ';
      const statusHit = status.toLowerCase().includes(q);
      return roomHit || namesHit || statusHit;
    });
  }, [items, query]);

  const togglePaid = (id) => {
    const next = invoices.map(i =>
      i.id === id
        ? {
            ...i,
            status: i.status === STATUS_PAID ? STATUS_UNPAID : STATUS_PAID,
            paidAt: i.status === STATUS_PAID ? undefined : new Date().toISOString()
          }
        : i
    );
    const s2 = { ...state, invoices: next };
    setState(s2);
    saveState(s2);
  };

  const addInvoiceFromReading = (roomId) => {
    const room = roomMap[roomId];
    const occ = tenantsByRoom[roomId] ?? [];
    const t = occ.find(x => x.id === room.primaryTenantId) ?? occ[0];
    if (!room || !t) return alert('Phòng chưa có khách');
    const reading = (readings ?? []).find(r => r.roomId === roomId && r.month === month);
    if (!reading) return alert('Chưa có chỉ số điện nước cho tháng này');
    const eUse = Math.max(0, (reading.electricEnd ?? 0) - (reading.electricStart ?? 0));
    const wUse = Math.max(0, (reading.waterEnd ?? 0) - (reading.waterStart ?? 0));
    const inv = {
      id: uid(), roomId, tenantId: t.id, month,
      rent: room.baseRent ?? 0,
      electricUsage: eUse, electricEnd: reading.electricEnd, electricStart: reading.electricStart,
      waterUsage: wUse, waterEnd: reading.waterEnd, waterStart: reading.waterStart,
      electricAmount: eUse * (room.electricRate ?? 0),
      waterAmount: wUse * (room.waterRate ?? 0),
      other: 0,
      total: (room.baseRent ?? 0) + eUse * (room.electricRate ?? 0) + wUse * (room.waterRate ?? 0),
      status: STATUS_UNPAID, createdAt: new Date().toISOString()
    };
    const s2 = { ...state, invoices: [inv, ...invoices] };
    setState(s2); saveState(s2);
  };

  const printPdf = async (inv) => {
    const item = items.find(it => it.invoice?.id === inv.id) ?? {};
    const { room, names } = item;
    const note = makeAddInfo(inv, rooms, settings);
    const data = {
      monthLabel: inv.month,
      roomCode: room?.name ?? '',
      tenants: names ? names.split(',').map(s => s.trim()) : [],
      items: [
        { name: 'Tiền phòng', spec: '-', qty: '-', unitPrice: inv.rent, amount: inv.rent },
        { name: 'Điện',  spec: `${inv.electricEnd} kWh - ${inv.electricStart} kWh`, qty: inv.electricUsage, unitPrice: room?.electricRate ?? 0, amount: inv.electricAmount },
        { name: 'Nước',  spec: `${inv.waterEnd} m³ - ${inv?.waterStart} m³`,       qty: inv.waterUsage,   unitPrice: room?.waterRate ?? 0, amount: inv.waterAmount },
      ],
      total: inv.total,
      paid: (inv.status === STATUS_PAID),
      paidDateLabel: inv.paidAt ? new Date(inv.paidAt).toLocaleDateString('vi-VN') : undefined,
      note
    };
    await exportInvoicePdfByJsPDF(data, {
      bankCode: settings.bankCode,
      accountNumber: settings.accountNo,
      accountName: settings.accountName,
      addInfoTemplate: settings.qrNoteTemplate ?? 'Tien phong {room} {month}',
      landlordName: settings.landlordName,
      landlordPhone: settings.landlordPhone,
      landlordAddress: settings.landlordAddress
    });
  };

  const { sumPaid, sumDebt } = calcTotals(invoices, payments, month);

  const Table = () => (
    <>
      <div className="lg:hidden">
        <Cards />
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
              {filteredItems.map(({ room, names, invoice, draft }) => {
                if (!invoice) {
                  return (
                    <tr key={room.id} className="border-t border-slate-100 bg-slate-50/60">
                      <td className="p-2 font-medium whitespace-nowrap">{room.name}</td>
                      <td className="p-2 max-w-[12rem]">{names ?? <i className="text-slate-400">(chưa có)</i>}</td>
                      <td className="p-2 whitespace-nowrap">{month}</td>
                      <td className="p-2 whitespace-nowrap">{currency(room.baseRent)}</td>
                      <td className="p-2 whitespace-nowrap">{currency(draft.eAmt)} <span className="text-slate-400">({draft.eUse} kWh)</span></td>
                      <td className="p-2 whitespace-nowrap">{currency(draft.wAmt)} <span className="text-slate-400">({draft.wUse} m³)</span></td>
                      <td className="p-2 font-semibold whitespace-nowrap">{currency(draft.totalDraft)}</td>
                      <td className="p-2"><span className="rounded-full px-2 py-1 text-xs bg-amber-100 text-amber-700 whitespace-nowrap">Chưa tạo HĐ</span></td>
                      <td className="p-2"><button type="button" onClick={() => addInvoiceFromReading(room.id)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Tạo hóa đơn</button></td>
                    </tr>
                  );
                }
                const i = invoice;
                return (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="p-2 font-medium whitespace-nowrap">{room.name}</td>
                    <td className="p-2 max-w-[12rem]">{names}</td>
                    <td className="p-2 whitespace-nowrap">{i.month}</td>
                    <td className="p-2 whitespace-nowrap">{currency(i.rent)}</td>
                    <td className="p-2 whitespace-nowrap">{currency(i.electricAmount)} <span className="text-slate-400">({i.electricUsage} kWh)</span></td>
                    <td className="p-2 whitespace-nowrap">{currency(i.waterAmount)} <span className="text-slate-400">({i.waterUsage} m³)</span></td>
                    <td className="p-2 font-semibold whitespace-nowrap">{currency(i.total)}</td>
                    <td className="p-2">
                      <span className={'rounded-full px-2 py-1 text-xs whitespace-nowrap ' + (i.status === STATUS_PAID ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700') }>{i.status}</span>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => togglePaid(i.id)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">{i.status === STATUS_PAID ? 'Đánh dấu chưa thanh toán' : 'Đánh dấu đã trả'}</button>
                        <button type="button" onClick={() => printPdf(i)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Xuất PDF</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const Cards = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
      {filteredItems.map(({ room, names, invoice, draft }) => {
        if (!invoice) {
          return (
            <div key={room.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm flex flex-col gap-3 min-w-0">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="font-semibold text-[15px] sm:text-base min-w-0 break-words pr-1">PHÒNG {room.name} — {names ?? ''}</div>
                <span className="shrink-0 rounded-full px-2 py-1 text-xs bg-amber-100 text-amber-700">Chưa tạo HĐ</span>
              </div>
              <div className="text-sm space-y-1.5 min-w-0">
                <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Tiền phòng</span><b className="text-right tabular-nums">{currency(room.baseRent)}</b></div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-2"><span className="text-slate-500">Điện</span><span className="min-w-0 text-right sm:text-left break-words">{draft.eUse} kWh × {currency(room.electricRate ?? 0)} = <b className="tabular-nums">{currency(draft.eAmt)}</b></span></div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-2"><span className="text-slate-500">Nước</span><span className="min-w-0 text-right sm:text-left break-words">{draft.wUse} m³ × {currency(room.waterRate ?? 0)} = <b className="tabular-nums">{currency(draft.wAmt)}</b></span></div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-1 border-t border-slate-100">
                <div className="text-lg font-semibold tabular-nums">{currency(draft.totalDraft)} đ</div>
                <button type="button" onClick={() => addInvoiceFromReading(room.id)} className="w-full sm:w-auto rounded-lg border px-3 py-2.5 sm:py-1 text-sm font-medium">Tạo hóa đơn</button>
              </div>
            </div>
          );
        }
        const i = invoice;
        const status = i.status ?? STATUS_UNPAID;
        const badge = status === STATUS_PAID ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700';
        return (
          <div key={i.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm flex flex-col gap-3 min-w-0">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="font-semibold text-[15px] sm:text-base min-w-0 break-words pr-1">PHÒNG {room.name} — {names ?? ''}</div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${badge}`}>{status}</span>
            </div>
            <div className="text-sm space-y-1.5 min-w-0">
              <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Tiền phòng</span><b className="text-right tabular-nums">{currency(i.rent)}</b></div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-2"><span className="text-slate-500">Điện</span><span className="min-w-0 text-right sm:text-left break-words">{i.electricUsage} kWh × {currency(room.electricRate ?? 0)} = <b className="tabular-nums">{currency(i.electricAmount)}</b></span></div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-2"><span className="text-slate-500">Nước</span><span className="min-w-0 text-right sm:text-left break-words">{i.waterUsage} m³ × {currency(room.waterRate ?? 0)} = <b className="tabular-nums">{currency(i.waterAmount)}</b></span></div>
              <div className="text-xs text-slate-500">Trạng thái: {status}</div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between pt-1 border-t border-slate-100">
              <div className="text-lg font-semibold tabular-nums shrink-0">{currency(i.total)} đ</div>
              <div className="flex flex-col gap-2 w-full">
                <button type="button" onClick={() => togglePaid(i.id)} className="w-full rounded-lg border px-3 py-2.5 sm:py-1.5 text-sm font-medium">{status === STATUS_PAID ? 'Đánh dấu chưa thanh toán' : 'Đánh dấu đã trả'}</button>
                <button type="button" onClick={() => printPdf(i)} className="w-full rounded-lg border px-3 py-2.5 sm:py-1.5 text-sm font-medium">Xuất PDF</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <Page className="space-y-4">
      <TotalsBar sumPaid={sumPaid} sumDebt={sumDebt} />
      <SearchBar month={month} onMonthChange={setMonth} query={query} onQueryChange={setQuery} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between min-w-0">
        <h2 className="text-base sm:text-lg font-semibold min-w-0 break-words">Hóa đơn tháng {month}</h2>
        <div className="shrink-0 self-start sm:self-auto">
          <ViewSwitch value={view} onChange={setView} />
        </div>
      </div>
      {view === 'table' ? <Table /> : <Cards />}

      <div className="rounded-2xl border bg-white p-3 text-xs text-slate-500">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Luôn hiển thị đủ phòng. Phòng chưa có HĐ tháng hiện nút <b>Tạo hóa đơn</b> từ chỉ số.</li>
          <li>Danh sách khách ưu tiên người đang ở theo <b>cấu hình</b> (theo tháng / theo ngày).</li>
        </ol>
      </div>
      <Footer></Footer>
    </Page>
  );
}
