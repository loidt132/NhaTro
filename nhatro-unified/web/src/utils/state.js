
import { dbGet, dbSet } from './db';
import { getAuthSession, getStoredToken } from './auth';

/** Trống = fetch `/api` cùng origin; dev: `VITE_API_ORIGIN` trong `.env.development`. */
function resolveApiBase() {
  const configured = (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
  if (!configured) return '';

  if (typeof window === 'undefined') return configured;

  try {
    const configuredOrigin = new URL(configured).origin;
    if (configuredOrigin === window.location.origin) return configured;
  } catch (error) {
    return '';
  }

  return '';
}

function apiUrl(path) {
  const base = resolveApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

function authHeaders() {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function currentStateKey() {
  const { userId } = getAuthSession();
  return `boarding_state_v1:${userId || 'guest'}`;
}

// In-memory state snapshot (synchronous access for existing code paths)
let memoryState = null;
let activeStateKey = '';

import { isNocoConfigured, loadStateFromNoco, saveStateToNoco } from './nocodb';

function shouldUseNocoState() {
  return Boolean(import.meta.env.VITE_NOCODB_URL);
}

async function loadStateFromServer(options = {}) {
  const { tables = null } = options;
  if (shouldUseNocoState()) {
    try {
      const state = await loadStateFromNoco({ tables });
      if (state) return state;
    } catch (e) {
      // noco fails, fallback next
    }
  }

  try { 
    const resp = await fetch(apiUrl('/api/state'), { headers: authHeaders() }); 
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

  if (shouldUseNocoState()) {
    try {
        console.log('save to nocodb', state);
      await saveStateToNoco(state);
      saved = true;
    } catch (e) {
      // continue to local server fallback
    }
  }

  if (!saved && !shouldUseNocoState()) {
    try {
        console.log('save to backend state', state);
      await fetch(apiUrl('/api/state'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ state }) });
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

function mergeStateSlices(base, incoming, tables = null) {
  if (!incoming) return applyDefaults(base || {});
  if (!tables || tables.length === 0) {
    return applyDefaults(incoming);
  }

  const next = applyDefaults(base || {});
  tables.forEach((table) => {
    if (table === 'settings') next.settings = incoming.settings || next.settings;
    else if (table in next) next[table] = incoming[table] || [];
  });
  if (incoming.__meta) next.__meta = incoming.__meta;
  return next;
}

function ensureSessionBoundary() {
  const key = currentStateKey();
  if (activeStateKey && activeStateKey !== key) {
    memoryState = null;
    isReady = false;
    isHydrating = false;
  }
  activeStateKey = key;
  return key;
}

// loadState remains synchronous for compatibility; it returns the in-
// export function loadState(){
//   if (!memoryState) {
//   // initialize with seed so UI has something to show immediately
//       memoryState = seed();
//   // persist seed to DB asynchronously
//       (async ()=>{ try{ await dbSet(KEY, memoryState); }catch(e){} })();
//   // also notify listeners that state is available
//       if(typeof window !== 'undefined' && window.dispatchEvent){ try{ window.dispatchEvent(new Event('boarding_state_updated')); }catch(e){} }
//   }
//  return applyDefaults(memoryState);
// } 
let isReady = false;

export function isStateReady() {
  return isReady;
}
let isHydrating = false;

// So sánh state để tránh render lại vô ích
function isSameState(a, b) {
  const aLastModified = a?.__meta?.lastModified;
  const bLastModified = b?.__meta?.lastModified;
  if (!aLastModified || !bLastModified) return false;
  return aLastModified === bLastModified;
}

function hasStateChanged(nextState, prevState, tables = null) {
  if (!prevState) return true;
  if (!tables || tables.length === 0) return !isSameState(nextState, prevState);
  return JSON.stringify(nextState) !== JSON.stringify(prevState);
}
export function loadState() {
  ensureSessionBoundary();
  return applyDefaults(memoryState || {
    rooms: [],
    tenants: [],
    readings: [],
    invoices: [],
    payments: [],
    settings: {}
  });
}
export function resetStateSession() {
  activeStateKey = currentStateKey();
  memoryState = null;
  isReady = false;
  isHydrating = false;
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    try { window.dispatchEvent(new Event('boarding_state_updated')); } catch (e) {}
  }
}

export async function hydrateState(options = {}) {
  const { tables = null } = options;
  if (isHydrating) return;
  const key = ensureSessionBoundary();
  isHydrating = true;
  try {
    // 1. Load từ IndexedDB (NHANH)
    const dbState = await dbGet(key);
    if (dbState) {
      memoryState = mergeStateSlices(memoryState, dbState, tables);
      window.dispatchEvent(new Event('boarding_state_updated'));
    }

    // 2. Load từ Server (SYNC NGẦM)
    const serverState = await loadStateFromServer({ tables });
    const nextState = mergeStateSlices(memoryState, serverState, tables);
    if (serverState && hasStateChanged(nextState, memoryState, tables)) {
      memoryState = nextState;
      await dbSet(key, nextState);
      window.dispatchEvent(new Event('boarding_state_updated'));
    }

    isReady = true;
    window.dispatchEvent(new Event('boarding_state_ready'));

  } catch (e) {
    console.error('hydrateState error', e);
  } finally {
    isHydrating = false;
  }
}
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
    const key = ensureSessionBoundary();
    const withMeta = { ...next, __meta: { lastModified: new Date().toISOString() } };
    // update in-memory snapshot
    memoryState = withMeta;
    // async write to IndexedDB for persistence across sessions
    (async ()=>{
      try{ await dbSet(key, withMeta); }catch(e){}
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
