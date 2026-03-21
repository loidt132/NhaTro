
import { loadState as loadAppState } from '../../utils/state';

export function loadState() {
  const s = loadAppState();
  return { rooms: s.rooms||[], tenants: s.tenants||[], invoices: s.invoices||[], payments: s.payments||[], readings: s.readings||[] };
}
export function isInMonth(inv, ym) { return ym ? inv.month === ym : true; }
export function isInYear(inv, year) { return year ? (inv.month||'').startsWith(year + '-') : true; }
export function paidAmount(inv, payments) {
  const sum = (payments||[]).filter(p=>p.invoiceId===inv.id).reduce((a,b)=>a+(+b.amount||0),0);
  if (sum>0) return sum; return inv.status==='Đã thanh toán' ? (+inv.total||0) : 0;
}
export function debtAmount(inv, payments) { const paid = paidAmount(inv, payments); const total = +inv.total||0; return Math.max(0, total - paid); }
