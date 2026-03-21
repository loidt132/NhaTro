
const KEY = 'boarding_state_v1';
import { dbGet, dbSet } from './db';

export function loadState(){
  try{
    const raw = localStorage.getItem(KEY);
    if(!raw) {
      const s = seed();
      // also persist seed async to DB
      try{ dbSet(KEY, s); }catch(e){}
      return s;
    }
    const s = JSON.parse(raw);
    // kick off an async check against IndexedDB and reconcile if DB has newer
    (async ()=>{
      try{
        const dbState = await dbGet(KEY);
        if(dbState && dbState.__meta && s.__meta){
          if(dbState.__meta.lastModified && (!s.__meta.lastModified || dbState.__meta.lastModified > s.__meta.lastModified)){
            localStorage.setItem(KEY, JSON.stringify(dbState));
            if(typeof window !== 'undefined' && window.dispatchEvent){
              try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){}
            }
          }
        }
      }catch(e){}
    })();

    return {
      rooms: s.rooms||[], tenants: s.tenants||[], readings: s.readings||[], invoices: s.invoices||[], payments: s.payments||[],
      settings: s.settings||{ bankCode:'VCB', accountNo:'', accountName:'', qrNoteTemplate:'Tien phong {room} {month}' }
    };
  }catch{ return seed(); }
}
function seed(){
  const uid = () => Math.random().toString(36).slice(2);
  const monthKey = (d=new Date())=>{ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`; };
  const r1={ id:uid(), name:'P101', baseRent:2500000, electricRate:3500, waterRate:12000 };
  const r2={ id:uid(), name:'P102', baseRent:2700000, electricRate:3500, waterRate:12000 };
  const t1={ id:uid(), name:'Nguyễn Văn A', cccd:'012345678901', phone:'0901234567', roomId:r1.id };
  const readings=[{ id:uid(), roomId:r1.id, month:monthKey(), electricStart:100, electricEnd:120, waterStart:30, waterEnd:32, createdAt:new Date().toISOString() }];
  const s={ rooms:[r1,r2], tenants:[t1], readings, invoices:[], payments:[], settings:{ bankCode:'VCB', accountNo:'', accountName:'', qrNoteTemplate:'Tien phong {room} {month}' } };
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
export function saveState(next){ 
  try{
    const withMeta = { ...next, __meta: { lastModified: new Date().toISOString() } };
    localStorage.setItem(KEY, JSON.stringify(withMeta));
    // notify same-tab listeners that state changed
    if(typeof window !== 'undefined' && window.dispatchEvent){
      try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){ /* ignore */ }
    }
    // async write to IndexedDB for persistence across sessions
    (async ()=>{
      try{ await dbSet(KEY, withMeta); }catch(e){}
    })();
  }catch(e){ /* ignore write errors */ }
}
export const monthKey = (d=new Date())=>{ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`; };
export const currency = v => new Intl.NumberFormat('vi-VN').format(v||0);
export const uid = ()=> Math.random().toString(36).slice(2);

// payment/debt helpers
export const isInMonth = (inv, ym) => ym ? inv.month===ym : true;
export function calcTotals(invoices=[], payments=[], ym){
  const filtered = ym? invoices.filter(i=> isInMonth(i, ym)) : invoices;
  const paidOf = (i)=>{
    const fromPayments = (payments||[]).filter(p=>p.invoiceId===i.id).reduce((a,b)=>a+(+b.amount||0),0);
    if (fromPayments>0) return fromPayments;
    return i.status==='Đã thanh toán' ? (+i.total||0) : 0;
  };
  const sumPaid = filtered.reduce((a,i)=> a + paidOf(i), 0);
  const sumDebt = filtered.reduce((a,i)=> a + Math.max(0,(+i.total||0) - paidOf(i)), 0);
  return { sumPaid, sumDebt };
}
