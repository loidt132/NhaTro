// Minimal IndexedDB helper for storing the app state under a single key.
const DB_NAME = 'nha-tro-db';
const DB_VER = 1;
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return resolve(null);
    const req = window.indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function withStore(mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const r = fn(store);
    tx.oncomplete = () => resolve(r?.result ?? null);
    tx.onabort = tx.onerror = () => resolve(null);
  });
}

export async function dbGet(key) {
  return withStore('readonly', store => store.get(key));
}

export async function dbSet(key, value) {
  return withStore('readwrite', store => store.put(value, key));
}

export async function dbDelete(key) {
  return withStore('readwrite', store => store.delete(key));
}
