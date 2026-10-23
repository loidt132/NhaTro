// src/pages/Payments.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { loadState, currency, monthKey, calcTotalsWithAdvance, hydrateState } from '../utils/state';
import { invoicesApi, paymentsApi, rentPeriodsApi, paymentAllocationsApi, depositsApi, depositTransactionsApi } from '../utils/api/tables';
import * as paymentWorkflow from '../utils/api/paymentWorkflow';
import SearchBar from '../components/SearchBar';
import TotalsBar from '../components/TotalsBar';
import TopStats from '../components/TopStats';
import ViewSwitch from '../components/ViewSwitch';
import Footer from '../components/Footer';
import Page from '../components/Page';
import { exportInvoicePdfByJsPDF } from '../utils/pdf/exportInvoiceJspdf';
import PaginationControls from '../components/PaginationControls';

const makeAddInfo = (inv, rooms, settings) => {
  const tpl = (settings.qrNoteTemplate ?? 'Tien phong {room} {month}');
  const r = rooms.find(x => x.id === inv.roomId);
  return tpl.replaceAll('{room}', r?.name ?? '').replaceAll('{month}', inv.month);
};

const STATUS_UNPAID = 'Chưa thanh toán';
const STATUS_PAID = 'Đã thanh toán';
const LEGACY_STATUS_UNPAID = 'Chưa thanh toán';

const isUnpaidStatus = (status = '') => {
  const s = String(status || '').trim();
  return s === STATUS_UNPAID || s === LEGACY_STATUS_UNPAID;
};

const hasMeterValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const meterSpec = (start, end, unit) => (
  hasMeterValue(start) && hasMeterValue(end)
    ? `${start} ${unit} — ${end} ${unit}`
    : `0 ${unit} — 0 ${unit}`
);

const addMonths = (ym, count) => {
  const [year, month] = String(ym).split('-').map(Number);
  const date = new Date(year, month - 1 + Math.max(0, count - 1), 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// Số tháng (bao gồm cả 2 đầu) giữa 2 mốc "YYYY-MM" — dùng để suy ra số tháng
// đóng trước từ khoảng "từ tháng – đến tháng" người dùng chọn, thay vì chỉ
// cho chọn 1 trong vài số tháng cố định (1, 2, 3, 6, 12).
const monthsBetween = (fromYm, toYm) => {
  const [fy, fm] = String(fromYm).split('-').map(Number);
  const [ty, tm] = String(toYm).split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
};

export default function Payments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState(loadState());
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [rentPeriods, setRentPeriods] = useState([]);
  const [paymentAllocations, setPaymentAllocations] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [depositTransactions, setDepositTransactions] = useState([]);
  const loadFinancials = async () => {
    try {
      const [inv, pay, rp, pa, dep, dt] = await Promise.all([
        invoicesApi.list(), paymentsApi.list(), rentPeriodsApi.list(),
        paymentAllocationsApi.list(), depositsApi.list(), depositTransactionsApi.list(),
      ]);
      setInvoices(inv); setPayments(pay); setRentPeriods(rp);
      setPaymentAllocations(pa); setDeposits(dep); setDepositTransactions(dt);
    } catch (error) {
      console.error('load financials failed', error);
    }
  };
  // Keep in-sync with other parts of the app that call saveState()
  useEffect(() => {
    const handler = () => setState(loadState());
    window.addEventListener('boarding_state_updated', handler);
    loadFinancials();
    // rooms/tenants/readings only — invoices/payments/rentPeriods/
    // paymentAllocations/deposits/depositTransactions are REST resources of
    // their own (loadFinancials above), kept in sync locally from each
    // mutation's own response.
    hydrateState({ tables: ['rooms', 'tenants', 'readings'] });
    return () => window.removeEventListener('boarding_state_updated', handler);
  }, []);
  const { rooms, tenants, settings, readings } = state;
  const [month, setMonth] = useState(() => searchParams.get('month') || monthKey());
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'all');
  const [collectionModal, setCollectionModal] = useState({ open: false, type: 'advance', roomId: '', fromMonth: '', toMonth: '', amount: '', note: '' });
  const [view, setView] = useState('cards');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [month, query, perPage]);

  useEffect(() => {
    const requestedMonth = searchParams.get('month');
    const requestedStatus = searchParams.get('status') || 'all';
    if (requestedMonth && requestedMonth !== month) setMonth(requestedMonth);
    if (requestedStatus !== statusFilter) setStatusFilter(requestedStatus);
  }, [searchParams]);

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

  const latestReadingOfMonth = useMemo(() => {
    const list = readings ?? [];
    const byKey = new Map();
    for (const r of list) {
      if (!r?.roomId || !r?.month) continue;
      const key = `${r.roomId}__${r.month}`;
      const prev = byKey.get(key);
      const prevTime = prev?.updated_at || prev?.created_at || '';
      const nextTime = r?.updated_at || r?.created_at || '';
      if (!prev || String(nextTime) > String(prevTime)) byKey.set(key, r);
    }
    return byKey;
  }, [readings]);

  const tenantsByRoom = useMemo(() => {
    const m = {};
    tenants.forEach(t => { if (!m[t.roomId]) m[t.roomId] = []; m[t.roomId].push(t); });
    return m;
  }, [tenants]);
console.log('get data by month ', month);
  const items = useMemo(
    () =>
      {
        const list = rooms.map(room => {
        const inv = invoices.find(i => i.roomId === room.id && i.month === month);
        const occupants = tenantsByRoom[room.id] ?? [];
        const occActive = occupants.filter(isActiveTenant);
        const tenantId = room.primaryTenantId ?? occActive[0]?.id ?? occupants[0]?.id;
        const tenant = occupants.find(t => t.id === tenantId);
        const reading = latestReadingOfMonth.get(`${room.id}__${month}`);
        //console.log('calculating item for room', room.name, { inv, tenant, reading });
        const eUse = Math.max(0, (reading?.electricEnd ?? 0) - (reading?.electricStart ?? 0));
        const wUse = Math.max(0, (reading?.waterEnd ?? 0) - (reading?.waterStart ?? 0));
        const eAmt = eUse * (room.electricRate ?? 0);
        const wAmt = wUse * (room.waterRate ?? 0);
        const totalDraft = (room.baseRent ?? 0) + eAmt + wAmt;
        //console.log('draft amounts calculated', { eUse, wUse, eAmt, wAmt, totalDraft });
        const names = (occActive.length ? occActive : occupants).map(t => t.name).join(', ');
        return { room, occupants, names, tenant, reading, invoice: inv, draft: { eUse, wUse, eAmt, wAmt, totalDraft } };
      });
      // sort items by room name for consistent ordering across pages
      return list.slice().sort((a, b) => (a.room.name || '').localeCompare(b.room.name || ''));
    },
    [rooms, invoices, tenantsByRoom, latestReadingOfMonth, month, settings?.occupancyMode]
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(({ room, names, invoice }) => {
      const roomHit = !q || room.name?.toLowerCase().includes(q);
      const namesHit = !q || names?.toLowerCase().includes(q);
      const status = invoice?.status ?? 'Chưa tạo HĐ';
      const statusHit = !q || status.toLowerCase().includes(q);
      const directPaid = invoice ? (payments || []).filter((payment) => String(payment.invoiceId || '') === String(invoice.id)).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) : 0;
      const period = invoice ? rentPeriods.find((item) => String(item.roomId) === String(invoice.roomId) && item.month === invoice.month) : null;
      const advance = invoice && period ? Math.min(Number(invoice.rent) || 0, paymentAllocations.filter((item) => String(item.rentPeriodId || '') === String(period.id)).reduce((sum, item) => sum + (Number(item.amount) || 0), 0)) : 0;
      const remaining = invoice ? Math.max(0, (Number(invoice.total) || 0) - advance - directPaid) : 0;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'invoice' && invoice) || (statusFilter === 'debt' && invoice && remaining > 0) || (statusFilter === 'paid' && invoice && directPaid > 0) || (statusFilter === 'advance' && invoice && advance > 0) || (statusFilter === 'no-advance' && advance === 0);
      return (roomHit || namesHit || statusHit) && matchesStatus;
    });
  }, [items, query, statusFilter, payments, rentPeriods, paymentAllocations]);
console.log('filtered items', { query, filteredItems });

 const totalPages = Math.max(1, Math.ceil(filteredItems.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pagedPayments = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filteredItems.slice(start, start + perPage);
  }, [filteredItems, currentPage, perPage]);

  const paidAmountOf = (invoice) => {
    if (!invoice) return 0;
    const legacyPaid = (payments ?? [])
      .filter((payment) => String(payment.invoiceId || '') === String(invoice.id))
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    const period = rentPeriods.find((item) => item.roomId === invoice.roomId && item.month === invoice.month);
    const allocated = period
      ? paymentAllocations.filter((item) => String(item.rentPeriodId) === String(period.id)).reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
      : 0;
    return legacyPaid + Math.min(Number(invoice.rent) || 0, allocated);
  };

  const advanceAllocatedOf = (invoice) => {
    if (!invoice) return 0;
    const period = rentPeriods.find((item) => item.roomId === invoice.roomId && item.month === invoice.month);
    if (!period) return 0;
    const allocated = paymentAllocations
      .filter((item) => String(item.rentPeriodId) === String(period.id))
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    return Math.min(Number(invoice.rent) || 0, allocated);
  };

  const directPaidOf = (invoice) => (payments ?? [])
    .filter((payment) => String(payment.invoiceId || '') === String(invoice?.id || ''))
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const remainingOf = (invoice) => Math.max(0, (Number(invoice?.total) || 0) - advanceAllocatedOf(invoice) - directPaidOf(invoice));

  const advanceRangeOfRoom = (roomId) => {
    const months = rentPeriods
      .filter((period) => period.roomId === roomId && paymentAllocations.some((allocation) => String(allocation.rentPeriodId) === String(period.id) && (Number(allocation.amount) || 0) > 0))
      .map((period) => period.month)
      .sort();
    return months.length ? `${months[0]} → ${months[months.length - 1]}` : '';
  };

  const isPaidByPayments = (invoice) => paidAmountOf(invoice) >= (Number(invoice?.total) || 0);
  const hasDirectPaymentFor = (invoice) => (payments ?? []).some((payment) => String(payment.invoiceId || '') === String(invoice?.id));
  const advanceRemainingForMonth = (roomId, ym = month) => {
    const room = roomMap[roomId];
    const period = rentPeriods.find((item) => String(item.roomId) === String(roomId) && item.month === ym);
    const requiredRent = Number(period?.rent ?? room?.baseRent) || 0;
    const allocated = period ? paymentAllocations
      .filter((allocation) => String(allocation.rentPeriodId || '') === String(period.id))
      .reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0) : 0;
    return Math.max(0, requiredRent - allocated);
  };
  const advancePaymentStartMonth = (roomId) => {
    for (let index = 0; index < 60; index += 1) {
      const candidateMonth = addMonths(month, index + 1);
      if (advanceRemainingForMonth(roomId, candidateMonth) > 0) return candidateMonth;
    }
    return month;
  };
  const suggestedAdvanceAmount = (roomId, fromMonthYm, months) => {
    const startMonth = fromMonthYm || advancePaymentStartMonth(roomId);
    return Array.from({ length: Math.max(1, Number(months) || 1) }, (_, index) => advanceRemainingForMonth(roomId, addMonths(startMonth, index + 1)))
      .reduce((sum, remaining) => sum + remaining, 0);
  };
  const depositBalanceOfRoom = (roomId) => deposits
    .filter((deposit) => deposit.roomId === roomId && deposit.status === 'held')
    .reduce((sum, deposit) => sum + (Number(deposit.remainingAmount ?? deposit.amount) || 0), 0);
  const eligibleRoomsForCollection = () => {
    if (collectionModal.type === 'deposit') return rooms.filter((room) => depositBalanceOfRoom(room.id) === 0);
    if (collectionModal.type === 'refund') return rooms.filter((room) => depositBalanceOfRoom(room.id) > 0);
    // A room is offered in the month before its prepaid range ends, so the
    // landlord can collect the next month without ever charging a covered
    // month twice. Example: paid through October -> shown in October for November.
    const nextMonth = addMonths(month, 2);
    return rooms.filter((room) => advancePaymentStartMonth(room.id) <= nextMonth && (tenantsByRoom[room.id] || []).length > 0);
  };

  const receiveAdvancePayment = async () => {
    const room = roomMap[collectionModal.roomId];
    if (!room) return alert('Hãy chọn phòng cần thu tiền.');
    const tenant = (tenantsByRoom[room.id] || []).find(isActiveTenant) || (tenantsByRoom[room.id] || [])[0];
    if (!tenant) return alert('Phòng chưa có khách thuê.');
    const startMonth = collectionModal.fromMonth || advancePaymentStartMonth(room.id);
    const toMonth = collectionModal.toMonth || startMonth;
    if (toMonth < startMonth) return alert('Tháng kết thúc phải từ tháng bắt đầu trở về sau.');
    const count = Math.min(60, Math.max(1, monthsBetween(startMonth, toMonth)));
    const amount = Math.max(0, Number(collectionModal.amount) || suggestedAdvanceAmount(room.id, startMonth, count));
    if (!amount) return alert('Nhập số tiền đóng trước.');
    try {
      const result = await paymentWorkflow.receiveAdvancePayment({
        roomId: room.id, tenantId: tenant.id, startMonth, count, amount, note: collectionModal.note,
      });
      setPayments((prev) => [result.payment, ...prev]);
      setRentPeriods((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        result.rentPeriods.forEach((p) => byId.set(p.id, p));
        return Array.from(byId.values());
      });
      setPaymentAllocations((prev) => [...result.paymentAllocations, ...prev]);
    } catch (error) {
      alert(error?.message || 'Không thể thu tiền đóng trước.');
      return;
    }
    setCollectionModal({ open: false, type: 'advance', roomId: '', fromMonth: '', toMonth: '', amount: '', note: '' });
  };

  const receiveDeposit = async () => {
    const room = roomMap[collectionModal.roomId];
    if (!room) return alert('Hãy chọn phòng cần thu cọc.');
    const tenant = (tenantsByRoom[room.id] || []).find(isActiveTenant) || (tenantsByRoom[room.id] || [])[0];
    const amount = Math.max(0, Number(collectionModal.amount) || 0);
    if (!tenant) return alert('Phòng chưa có khách thuê.');
    if (!amount) return alert('Nhập số tiền cọc.');
    try {
      const result = await paymentWorkflow.receiveDeposit({
        roomId: room.id, tenantId: tenant.id, amount, note: collectionModal.note,
      });
      setDeposits((prev) => [result.deposit, ...prev]);
      setDepositTransactions((prev) => [result.transaction, ...prev]);
    } catch (error) {
      alert(error?.message || 'Không thể thu tiền cọc.');
      return;
    }
    setCollectionModal({ open: false, type: 'advance', roomId: '', fromMonth: '', toMonth: '', amount: '', note: '' });
  };

  const refundDeposit = async () => {
    const room = roomMap[collectionModal.roomId];
    if (!room) return alert('Hãy chọn phòng hoàn cọc.');
    const refundedAmount = Math.max(0, Number(collectionModal.amount) || 0);
    const balance = depositBalanceOfRoom(room.id);
    if (!balance) return alert('Phòng này không còn tiền cọc để hoàn.');
    if (!refundedAmount || refundedAmount > balance) return alert(`Số hoàn cọc phải từ 1 đến ${currency(balance)} đ.`);
    try {
      const result = await paymentWorkflow.refundDeposit(room.id, { amount: refundedAmount, note: collectionModal.note });
      setDeposits((prev) => {
        const byId = new Map(result.deposits.map((d) => [d.id, d]));
        return prev.map((d) => byId.get(d.id) || d);
      });
      setDepositTransactions((prev) => [...result.transactions, ...prev]);
    } catch (error) {
      alert(error?.message || 'Không thể hoàn tiền cọc.');
      return;
    }
    setCollectionModal({ open: false, type: 'advance', roomId: '', fromMonth: '', toMonth: '', amount: '', note: '' });
  };
  const togglePaid = async (id) => {
    const inv = invoices.find(i => i.id === id);
    if (!inv) return;
    try {
      const result = await paymentWorkflow.toggleInvoicePaid(id);
      setInvoices((prev) => prev.map((invoice) => invoice.id === id ? result.invoice : invoice));
      if (result.removedPaymentIds) {
        const removed = new Set(result.removedPaymentIds.map(String));
        setPayments((prev) => prev.filter((p) => !removed.has(String(p.id))));
      } else if (result.payment) {
        setPayments((prev) => [result.payment, ...prev]);
      }
    } catch (error) {
      alert(error?.message || 'Không thể cập nhật trạng thái thanh toán.');
    }
  };

  const addInvoiceFromReading = async (roomId) => {
    const room = roomMap[roomId];
    const occ = tenantsByRoom[roomId] ?? [];
    const t = occ.find(x => x.id === room.primaryTenantId) ?? occ[0];
    if (!room || !t) return alert('Phòng chưa có khách');
    const reading = latestReadingOfMonth.get(`${roomId}__${month}`);
    if (!reading) return alert('Chưa có chỉ số điện nước cho tháng này');
    try {
      const result = await paymentWorkflow.createInvoiceFromReading({
        roomId, tenantId: t.id, month, readingId: reading.id,
      });
      setInvoices((prev) => [result.invoice, ...prev]);
      setRentPeriods((prev) => {
        const next = prev.filter((p) => p.id !== result.rentPeriod.id);
        return [result.rentPeriod, ...next];
      });
    } catch (error) {
      alert(error?.message || 'Không thể tạo hoá đơn.');
    }
  };

  const updateInvoiceFromReading = async (invoiceId) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;
    const reading = latestReadingOfMonth.get(`${inv.roomId}__${inv.month}`);
    if (!reading) return alert('Chưa có chỉ số điện nước cho tháng này');
    try {
      const result = await paymentWorkflow.updateInvoiceFromReading(invoiceId, { readingId: reading.id });
      setInvoices((prev) => prev.map((i) => i.id === invoiceId ? result.invoice : i));
    } catch (error) {
      alert(error?.message || 'Không thể cập nhật hoá đơn.');
    }
  };

  const printPdf = async (inv) => {
    // Settings are only required for PDF export (bank info, landlord info, QR template).
    if (!state?.settings || Object.keys(state.settings || {}).length === 0) {
      await hydrateState({ tables: ['settings'] });
    }
    const item = items.find(it => it.invoice?.id === inv.id) ?? {};
    const { room, names } = item;
    const note = makeAddInfo(inv, rooms, settings);
    const advanceAllocated = Math.min(Number(inv.rent) || 0, advanceAllocatedOf(inv));
    const remainingTotal = Math.max(0, (Number(inv.total) || 0) - advanceAllocated);
    const data = {
      monthLabel: inv.month,
      roomCode: room?.name ?? '',
      tenants: names ? names.split(',').map(s => s.trim()) : [],
      items: [
        ...(advanceAllocated > 0
          ? [{ name: advanceAllocated >= (Number(inv.rent) || 0) ? 'Tiền phòng' : 'Tiền phòng còn lại', spec: `Đã đóng trước: ${currency(advanceAllocated)} đ`, qty: '-', unitPrice: '-', amount: Math.max(0, (Number(inv.rent) || 0) - advanceAllocated) }]
          : [{ name: 'Tiền phòng', spec: '-', qty: '-', unitPrice: inv.rent, amount: inv.rent }]),
        { name: 'Điện', spec: meterSpec(inv.electricStart, inv.electricEnd, 'kWh'), qty: inv.electricUsage ?? 0, unitPrice: room?.electricRate ?? 0, amount: inv.electricAmount ?? 0 },
        { name: 'Nước', spec: meterSpec(inv.waterStart, inv.waterEnd, 'm³'), qty: inv.waterUsage ?? 0, unitPrice: room?.waterRate ?? 0, amount: inv.waterAmount ?? 0 },
      ],
      total: remainingTotal,
      paid: isPaidByPayments(inv),
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

  const { sumAdvance, sumPaid, sumDebt } = useMemo(
    () => calcTotalsWithAdvance(invoices, payments, rentPeriods, paymentAllocations, month),
    [invoices, payments, rentPeriods, paymentAllocations, month]
  );
  const activeTenantCount = useMemo(() => tenants.filter(isActiveTenant).length, [tenants, month, settings?.occupancyMode]);
  const invoicesForMonth = useMemo(() => invoices.filter((invoice) => invoice.month === month).length, [invoices, month]);
  const unpaidForMonth = useMemo(
    () => invoices.filter((invoice) => invoice.month === month && !isPaidByPayments(invoice)).length,
    [invoices, payments, rentPeriods, paymentAllocations, month]
  );

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
                <th className="p-2 whitespace-nowrap">Còn thu</th>
                <th className="p-2 whitespace-nowrap">Trạng thái</th>
                <th className="p-2 whitespace-nowrap">Tác vụ</th>
              </tr>
            </thead>
            <tbody>
              {pagedPayments.map(({ room, names, invoice, draft, reading: monthlyReading }) => {
                if (!invoice) {
                  const hasReading = Boolean(monthlyReading);
                  const advanceRange = advanceRangeOfRoom(room.id);
                  return (
                    <tr key={room.id} className="border-t border-slate-100 bg-slate-50/60">
                      <td className="p-2 font-medium whitespace-nowrap">{room.name}</td>
                      <td className="p-2 max-w-[12rem]">{names ?? <i className="text-slate-400">(chưa có)</i>}</td>
                      <td className="p-2 whitespace-nowrap">{month}</td>
                      <td className="p-2 whitespace-nowrap">{currency(room.baseRent)}</td>
                      <td className="p-2 whitespace-nowrap">{currency(draft.eAmt)} <span className="text-slate-400">({draft.eUse} kWh)</span></td>
                      <td className="p-2 whitespace-nowrap">{currency(draft.wAmt)} <span className="text-slate-400">({draft.wUse} m³)</span></td>
                      <td className="p-2 font-semibold whitespace-nowrap">{currency(draft.totalDraft)}</td>
                      <td className="p-2">
                        <span className="rounded-full px-2 py-1 text-xs bg-amber-100 text-amber-700 whitespace-nowrap">Chưa tạo HĐ</span>
                        {!hasReading && (
                          <div className="mt-1 text-xs text-rose-600">Chưa nhập chỉ số</div>
                        )}
                        {advanceRange && <div className="mt-1 text-xs text-emerald-700">Đóng trước: {advanceRange}</div>}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => addInvoiceFromReading(room.id)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Tạo hóa đơn</button>
                          {!hasReading && (
                            <Link to="/meter" className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Nhập chỉ số</Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                const i = invoice;
                const isPaid = isPaidByPayments(i);
                const advanceAllocated = advanceAllocatedOf(i);
                const hasDirectPayment = hasDirectPaymentFor(i);
                const advanceRange = advanceRangeOfRoom(room.id);
                const statusText = isPaid ? STATUS_PAID : STATUS_UNPAID;
                const reading = latestReadingOfMonth.get(`${room.id}__${i.month}`);
                const mismatch = Boolean(reading) && (
                  (Number(i.electricStart ?? 0) !== Number(reading.electricStart ?? 0)) ||
                  (Number(i.electricEnd ?? 0) !== Number(reading.electricEnd ?? 0)) ||
                  (Number(i.waterStart ?? 0) !== Number(reading.waterStart ?? 0)) ||
                  (Number(i.waterEnd ?? 0) !== Number(reading.waterEnd ?? 0))
                );
                return (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="p-2 font-medium whitespace-nowrap">{room.name}</td>
                    <td className="p-2 max-w-[12rem]">{names}</td>
                    <td className="p-2 whitespace-nowrap">{i.month}</td>
                    <td className="p-2 whitespace-nowrap">{currency(i.rent)}</td>
                    <td className="p-2 whitespace-nowrap">{currency(i.electricAmount)} <span className="text-slate-400">({i.electricUsage} kWh)</span></td>
                    <td className="p-2 whitespace-nowrap">{currency(i.waterAmount)} <span className="text-slate-400">({i.waterUsage} m³)</span></td>
                    <td className="p-2 font-semibold whitespace-nowrap">{currency(remainingOf(i))}</td>
                    <td className="p-2">
                      <span className={'rounded-full px-2 py-1 text-xs whitespace-nowrap ' + (isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700') }>{statusText}</span>
                      {advanceAllocated > 0 && <div className="mt-1 text-xs text-emerald-700">Đã cấn trừ đóng trước: {currency(advanceAllocated)} · Còn lại: {currency(Math.max(0, (Number(i.total) || 0) - advanceAllocated))}</div>}
                      {advanceAllocated > 0 && advanceRange && <div className="mt-1 text-xs text-emerald-700">Đóng trước: {advanceRange}</div>}
                      {mismatch && (
                        <div className="mt-1 text-xs text-amber-700">Chỉ số đã đổi</div>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" disabled={isPaid && !hasDirectPayment} onClick={() => togglePaid(i.id)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50">{hasDirectPayment ? 'Hoàn tác thanh toán' : isPaid ? 'Đã cấn đóng trước' : 'Thu phần còn lại'}</button>
                        <button type="button" onClick={() => printPdf(i)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Xuất PDF</button>
                        {mismatch && (
                          <button type="button" onClick={() => updateInvoiceFromReading(i.id)} className="rounded-lg border px-2 py-1 text-xs sm:text-sm whitespace-nowrap">Cập nhật từ chỉ số</button>
                        )}
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
      {pagedPayments.map(({ room, names, invoice, draft, reading: monthlyReading }) => {
        if (!invoice) {
          const hasReading = Boolean(monthlyReading);
          const advanceRange = advanceRangeOfRoom(room.id);
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
                {advanceRange && <div className="text-xs font-medium text-emerald-700">Đóng trước cho các tháng: {advanceRange}</div>}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-1 border-t border-slate-100">
                <div className="text-lg font-semibold tabular-nums">{currency(draft.totalDraft)} đ</div>
                <div className="flex w-full flex-wrap justify-end gap-1.5 sm:w-auto">
                  <button type="button" onClick={() => addInvoiceFromReading(room.id)} className="h-[29px] rounded-lg border px-2 text-[11px] font-medium">Tạo hóa đơn</button>
                  {!hasReading && (
                    <Link to="/meter" className="h-[29px] rounded-lg border px-2 text-center text-[11px] font-medium leading-[29px]">Nhập chỉ số</Link>
                  )}
                </div>
              </div>
            </div>
          );
        }
        const i = invoice;
        const isPaid = isPaidByPayments(i);
        const advanceAllocated = advanceAllocatedOf(i);
        const hasDirectPayment = hasDirectPaymentFor(i);
        const advanceRange = advanceRangeOfRoom(room.id);
        const status = isPaid ? STATUS_PAID : STATUS_UNPAID;
        const badge = isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700';
        const reading = latestReadingOfMonth.get(`${room.id}__${i.month}`);
        const mismatch = Boolean(reading) && (
          (Number(i.electricStart ?? 0) !== Number(reading.electricStart ?? 0)) ||
          (Number(i.electricEnd ?? 0) !== Number(reading.electricEnd ?? 0)) ||
          (Number(i.waterStart ?? 0) !== Number(reading.waterStart ?? 0)) ||
          (Number(i.waterEnd ?? 0) !== Number(reading.waterEnd ?? 0))
        );
        return (
          <div key={i.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm flex flex-col gap-3 min-w-0">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="font-semibold text-[15px] sm:text-base min-w-0 break-words pr-1">PHÒNG {room.name} — {names ?? ''}</div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${badge}`}>{status}</span>
            </div>
            {mismatch && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Chỉ số điện/nước đã thay đổi so với hóa đơn.
              </div>
            )}
            <div className="text-sm space-y-1.5 min-w-0">
              <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">Tiền phòng</span><b className="text-right tabular-nums">{currency(i.rent)}</b></div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-2"><span className="text-slate-500">Điện</span><span className="min-w-0 text-right sm:text-left break-words">{i.electricUsage} kWh × {currency(room.electricRate ?? 0)} = <b className="tabular-nums">{currency(i.electricAmount)}</b></span></div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-2"><span className="text-slate-500">Nước</span><span className="min-w-0 text-right sm:text-left break-words">{i.waterUsage} m³ × {currency(room.waterRate ?? 0)} = <b className="tabular-nums">{currency(i.waterAmount)}</b></span></div>
              <div className="text-xs text-slate-500">Trạng thái: {status}</div>
              {advanceAllocated > 0 && <div className="text-xs text-emerald-700">Đã cấn trừ đóng trước: {currency(advanceAllocated)} · Còn lại: {currency(Math.max(0, (Number(i.total) || 0) - advanceAllocated))}</div>}
              {advanceAllocated > 0 && advanceRange && <div className="text-xs text-emerald-700">Đóng trước cho các tháng: {advanceRange}</div>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between pt-1 border-t border-slate-100">
              <div className="shrink-0 text-right"><div className="text-xs text-slate-500">Còn thu</div><div className="text-lg font-semibold tabular-nums">{currency(remainingOf(i))} đ</div></div>
              <div className="flex w-full flex-wrap justify-end gap-1.5">
                <button type="button" disabled={isPaid && !hasDirectPayment} onClick={() => togglePaid(i.id)} className="h-[29px] rounded-lg border px-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50">
                  <span>{hasDirectPayment ? 'Hoàn tác thanh toán' : isPaid ? 'Đã cấn đóng trước' : 'Thu phần còn lại'}</span>
                </button>
                <button type="button" onClick={() => printPdf(i)} className="h-[29px] rounded-lg border px-2 text-[11px] font-medium">Xuất hóa đơn PDF</button>
                {mismatch && (
                  <button type="button" onClick={() => updateInvoiceFromReading(i.id)} className="h-[29px] rounded-lg border px-2 text-[11px] font-medium"><span className="sm:hidden">Cập nhật</span><span className="hidden sm:inline">Cập nhật từ chỉ số</span></button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <Page className="space-y-4">
      <TopStats rooms={rooms.length} tenants={activeTenantCount} invoices={invoicesForMonth} debts={unpaidForMonth} invoiceTo={`/payments?status=invoice&month=${month}`} debtTo={`/payments?status=debt&month=${month}`} />
      <TotalsBar sumAdvance={sumAdvance} sumPaid={sumPaid} sumDebt={sumDebt} month={month} />
      <SearchBar month={month} onMonthChange={setMonth} query={query} onQueryChange={setQuery} />
      <div className="flex justify-end">
        <select value={statusFilter} onChange={(event) => { const next = event.target.value; setStatusFilter(next); setSearchParams({ ...(month ? { month } : {}), ...(next !== 'all' ? { status: next } : {}) }); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="all">Tất cả</option>
          <option value="invoice">Đã có hóa đơn</option>
          <option value="debt">Còn nợ</option>
          <option value="paid">Đã thu hóa đơn</option>
          <option value="advance">Đã đóng trước</option>
          <option value="no-advance">Chưa đóng trước</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setCollectionModal({ open: true, type: 'advance', roomId: '', fromMonth: '', toMonth: '', amount: '', note: '' })} className="rounded-xl bg-emerald-600 px-4 py-2 font-medium text-white">Ghi nhận đóng trước / cọc</button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between min-w-0">
        <h2 className="text-base sm:text-lg font-semibold min-w-0 break-words">Hóa đơn tháng {month}</h2>
        <div className="shrink-0 self-start sm:self-auto">
          <ViewSwitch value={view} onChange={setView} />
        </div>
         <div className="mt-3">
          <PaginationControls
            totalItems={filteredItems.length}
            page={currentPage}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
          />
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
      {collectionModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Ghi nhận đóng trước và tiền cọc</h3>
              <button type="button" onClick={() => setCollectionModal((modal) => ({ ...modal, open: false }))} className="text-slate-500">Đóng</button>
            </div>
            <label className="block text-sm font-medium text-slate-700">Nghiệp vụ
              <select value={collectionModal.type} onChange={(e) => setCollectionModal((modal) => ({ ...modal, type: e.target.value, roomId: '', amount: '' }))} className="mt-1 block w-full rounded-xl border px-3 py-2">
                <option value="advance">Đóng trước tiền phòng</option>
                <option value="deposit">Thu tiền cọc</option>
                <option value="refund">Hoàn tiền cọc</option>
              </select>
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">Phòng
              <select
                value={collectionModal.roomId}
                onChange={(e) => {
                  const roomId = e.target.value;
                  const start = roomId ? advancePaymentStartMonth(roomId) : '';
                  setCollectionModal((modal) => ({
                    ...modal,
                    roomId,
                    fromMonth: modal.type === 'advance' ? start : modal.fromMonth,
                    toMonth: modal.type === 'advance' ? (start ? addMonths(start, 3) : '') : modal.toMonth,
                  }));
                }}
                className="mt-1 block w-full rounded-xl border px-3 py-2"
              >
                <option value="">Chọn phòng</option>
                {eligibleRoomsForCollection().map((room) => <option key={room.id} value={room.id}>{room.name}{collectionModal.type === 'advance' ? ` — đóng từ ${advancePaymentStartMonth(room.id)}` : collectionModal.type === 'refund' ? ` — còn cọc ${currency(depositBalanceOfRoom(room.id))} đ` : ''}</option>)}
              </select>
              {collectionModal.type === 'deposit' && <span className="mt-1 block text-xs text-slate-500">Chỉ hiển thị phòng chưa có tiền cọc đang giữ.</span>}
              {collectionModal.type === 'refund' && <span className="mt-1 block text-xs text-slate-500">Chỉ hiển thị phòng đang có tiền cọc. Hoàn thấp hơn tiền cọc sẽ tự ghi nhận phần chênh lệch là cấn trừ.</span>}
              {collectionModal.type === 'advance' && <span className="mt-1 block text-xs text-slate-500">Chỉ hiển thị phòng cần đóng trước trong tháng này hoặc tháng kế tiếp; khoản thu sẽ tự bắt đầu từ tháng chưa đóng đầu tiên.</span>}
            </label>
            {collectionModal.type === 'advance' ? (
              <>
                <div className="mt-4 text-sm font-medium text-slate-700">Đóng trước từ tháng – đến tháng</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="month"
                    value={collectionModal.fromMonth || ''}
                    onChange={(e) => setCollectionModal((modal) => ({ ...modal, fromMonth: e.target.value }))}
                    className="rounded-lg border px-3 py-2"
                  />
                  <span className="text-slate-400">đến</span>
                  <input
                    type="month"
                    value={collectionModal.toMonth || ''}
                    min={collectionModal.fromMonth || undefined}
                    onChange={(e) => setCollectionModal((modal) => ({ ...modal, toMonth: e.target.value }))}
                    className="rounded-lg border px-3 py-2"
                  />
                </div>
                {(() => {
                  const from = collectionModal.fromMonth;
                  const to = collectionModal.toMonth;
                  const count = from && to && to >= from ? monthsBetween(from, to) : 0;
                  const suggested = count ? suggestedAdvanceAmount(collectionModal.roomId, from, count) : 0;
                  return (
                    <>
                      <label className="mt-4 block text-sm font-medium text-slate-700">Số tiền đóng (VNĐ)
                        <input type="number" min="0" value={collectionModal.amount} onChange={(e) => setCollectionModal((modal) => ({ ...modal, amount: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2" placeholder={`Tự tính: ${currency(suggested)}`} />
                      </label>
                      <button type="button" disabled={!count} onClick={() => setCollectionModal((modal) => ({ ...modal, amount: suggested }))} className="mt-2 text-sm font-medium text-emerald-700 disabled:opacity-50">Dùng số tiền tự tính: {currency(suggested)} đ</button>
                      <p className="mt-3 text-sm text-slate-500">{count ? `Phân bổ ${count} tháng, từ ${from} đến ${to}.` : 'Chọn phòng và khoảng tháng để xem kỳ phân bổ.'} Khi lên từng hóa đơn tháng, khoản này tự được cấn trừ.</p>
                    </>
                  );
                })()}
              </>
            ) : (
              <label className="mt-4 block text-sm font-medium text-slate-700">{collectionModal.type === 'refund' ? 'Số tiền hoàn cọc (VNĐ)' : 'Số tiền cọc (VNĐ)'}
                <input type="number" min="0" value={collectionModal.amount} onChange={(e) => setCollectionModal((modal) => ({ ...modal, amount: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2" placeholder="Ví dụ: 2000000" />
              </label>
            )}
            {collectionModal.type !== 'advance' && <label className="mt-4 block text-sm font-medium text-slate-700">Ghi chú
              <input value={collectionModal.note} onChange={(e) => setCollectionModal((modal) => ({ ...modal, note: e.target.value }))} className="mt-1 block w-full rounded-xl border px-3 py-2" placeholder={collectionModal.type === 'refund' ? 'Ví dụ: Trừ hỏng máy lạnh trước khi hoàn' : 'Tùy chọn'} />
            </label>}
            <button type="button" onClick={collectionModal.type === 'advance' ? receiveAdvancePayment : collectionModal.type === 'deposit' ? receiveDeposit : refundDeposit} className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2 font-medium text-white">{collectionModal.type === 'refund' ? 'Xác nhận hoàn cọc' : 'Xác nhận thu tiền'}</button>
          </div>
        </div>
      )}
    </Page>
  );
}
