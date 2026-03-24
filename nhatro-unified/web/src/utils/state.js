
const KEY = 'boarding_state_v1';
import { dbGet, dbSet } from './db';

/** Trống = fetch `/api` cùng origin; dev: `VITE_API_ORIGIN` trong `.env.development`. */
function apiUrl(path) {
  console.log('import.meta.env.VITE_API_ORIGIN', import.meta.env.VITE_API_ORIGIN);
  const base = (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  console.log(base ? `${base}${p}` : p);
  return base ? `${base}${p}` : p;
}

// In-memory state snapshot (synchronous access for existing code paths)
let memoryState = null;

import { isNocoConfigured, loadStateFromNoco, saveStateToNoco } from './nocodb';

async function loadStateFromServer() {
  if (isNocoConfigured()) {
    try {
      console.log('loadStateFromNoco');
      const state = await loadStateFromNoco();  
      console.log('state', state);
      if (state) return state;
    } catch (e) {
      // noco fails, fallback next
    }
  }

  try {
    console.log(apiUrl('/api/state'));
    const resp = await fetch(apiUrl('/api/state'));
    console.log(resp);
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json && json.state) return json.state;
  } catch (e) {
    // server unavailable, ignore
  }
  return null;
}

async function saveStateToServer(state) {
  let saved = false;

  if (isNocoConfigured()) {
    try {
      await saveStateToNoco(state);
      saved = true;
    } catch (e) {
      // continue to local server fallback
    }
  }

  if (!saved) {
    try {
      await fetch(apiUrl('/api/state'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) });
      saved = true;
    } catch (e) {
      // server unavailable, ignore
    }
  }

  return saved;
}

function applyDefaults(s) {
  return {
    rooms: s.rooms || [],
    tenants: s.tenants || [],
    readings: s.readings || [],
    invoices: s.invoices || [],
    payments: s.payments || [],
    settings: s.settings||{ bankCode:'VCB', accountNo:'', accountName:'', qrNoteTemplate:'Tien phong {room} {month}', landlordName:'', landlordPhone:'', landlordAddress:'' }
  };
}

// loadState remains synchronous for compatibility; it returns the in-
export function loadState(){
  if (!memoryState) {
    // initialize with seed so UI has something to show immediately
    memoryState = seed();
    // persist seed to DB asynchronously
    (async ()=>{ try{ await dbSet(KEY, memoryState); }catch(e){} })();
    // also notify listeners that state is available
    if(typeof window !== 'undefined' && window.dispatchEvent){ try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){} }
  }
  return applyDefaults(memoryState);
}

// Attempt to hydrate memoryState from IndexedDB on module load
// Migration: if there is an existing localStorage copy, migrate it to IndexedDB once
(async ()=>{
  try{
    if(typeof localStorage !== 'undefined'){
      const raw = localStorage.getItem(KEY);
      if(raw){
        try{
          const parsed = JSON.parse(raw);
          memoryState = parsed;
          try{ await dbSet(KEY, parsed); }catch(e){}
          try{ localStorage.removeItem(KEY); }catch(e){}
          if(typeof window !== 'undefined' && window.dispatchEvent){ try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){} }
          return;
        }catch(e){ /* ignore parse errors */ }
      }
    }

    // try server copy first (non-blocking if endpoint absent)
    const serverState = await loadStateFromServer();
    if (serverState) {
      memoryState = serverState;
      try { await dbSet(KEY, serverState); } catch (e) {}
      if(typeof window !== 'undefined' && window.dispatchEvent){ try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){} }
      return;
    }

    const dbState = await dbGet(KEY);
    if(dbState){
      memoryState = dbState;
      if(typeof window !== 'undefined' && window.dispatchEvent){ try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){} }
    }
  }catch(e){ /* ignore */ }
})();
function seed(){
  const uid = () => Math.random().toString(36).slice(2);
  const monthKey = (d=new Date())=>{ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`; };
  const r1={ id:uid(), name:'P101', baseRent:2500000, electricRate:3500, waterRate:12000 };
  const r2={ id:uid(), name:'P102', baseRent:2700000, electricRate:3500, waterRate:12000 };
  const t1={ id:uid(), name:'Nguyễn Văn A', cccd:'012345678901', phone:'0901234567', roomId:r1.id };
  const readings=[{ id:uid(), roomId:r1.id, month:monthKey(), electricStart:100, electricEnd:120, waterStart:30, waterEnd:32, createdAt:new Date().toISOString() }];
  const s={ rooms:[r1,r2], tenants:[t1], readings, invoices:[], payments:[], settings:{ bankCode:'VCB', accountNo:'', accountName:'', qrNoteTemplate:'Tien phong {room} {month}', landlordName:'', landlordPhone:'', landlordAddress:'' }, __meta: { lastModified: new Date().toISOString() } };
  return s;
}
export function saveState(next){ 
  try{
    const withMeta = { ...next, __meta: { lastModified: new Date().toISOString() } };
    // update in-memory snapshot
    memoryState = withMeta;
    // async write to IndexedDB for persistence across sessions
    (async ()=>{
      try{ await dbSet(KEY, withMeta); }catch(e){}
      try{ await saveStateToServer(withMeta); }catch(e){}
      // notify same-tab listeners that state changed (after DB write)
      if(typeof window !== 'undefined' && window.dispatchEvent){
        try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){}
      }
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
