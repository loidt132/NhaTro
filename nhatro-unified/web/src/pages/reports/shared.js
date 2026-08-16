import { loadState as loadAppState } from '../../utils/state';

export function loadState() {
  const s = loadAppState();
  return { rooms: s.rooms || [], tenants: s.tenants || [], invoices: s.invoices || [], payments: s.payments || [], readings: s.readings || [], rentPeriods: s.rentPeriods || [], paymentAllocations: s.paymentAllocations || [], deposits: s.deposits || [], depositTransactions: s.depositTransactions || [] };
}

export function isInMonth(inv, ym) { return ym ? inv.month === ym : true; }
export function isInYear(inv, year) { return year ? (inv.month || '').startsWith(year + '-') : true; }

export function paidAmount(inv, payments) {
  return (payments || []).filter((p) => p.invoiceId === inv.id).reduce((a, b) => a + (+b.amount || 0), 0);
}

export function advanceAmount(inv, rentPeriods = [], paymentAllocations = []) {
  const period = (rentPeriods || []).find((item) => item.roomId === inv.roomId && item.month === inv.month);
  if (!period) return 0;
  return (paymentAllocations || []).filter((item) => String(item.rentPeriodId) === String(period.id)).reduce((sum, item) => sum + (+item.amount || 0), 0);
}

export function debtAmount(inv, payments) {
  const paid = paidAmount(inv, payments);
  const total = +inv.total || 0;
  return Math.max(0, total - paid);
}
