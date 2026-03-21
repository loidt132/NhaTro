// src/utils/pdf/fontLoader.js (font fix: cache TTF, ALWAYS register per jsPDF doc)
import jsPDF from 'jspdf';

let ttfCache = null;         // { regular: base64, bold: base64 }
let ttfLoading = null;       // Promise cache to dedupe concurrent loads

async function fetchTtfAsBase64(path) {
  const res = await fetch(path, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Không tải được font: ${path} (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function loadTtfCache() {
  if (ttfCache) return ttfCache;
  if (!ttfLoading) {
    console.time('[PDF] load-fonts(base64)');
    ttfLoading = Promise.all([
      fetchTtfAsBase64('/fonts/NotoSans-Regular.ttf'),
      fetchTtfAsBase64('/fonts/NotoSans-Bold.ttf'),
    ]).then(([regular, bold]) => {
      console.timeEnd('[PDF] load-fonts(base64)');
      ttfCache = { regular, bold };
      return ttfCache;
    }).catch(err => {
      ttfLoading = null; // allow retry on next call
      throw err;
    });
  }
  return await ttfLoading;
}

export async function ensureVietnameseFonts(doc) {
  // Fonts in jsPDF are per-document. We MUST register on every new jsPDF instance.
  const { regular, bold } = await loadTtfCache();

  // Add file content into current doc's VFS, then register the face names
  doc.addFileToVFS('NotoSans-Regular.ttf', regular);
  doc.addFileToVFS('NotoSans-Bold.ttf', bold);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');

  // Optional: log available fonts for this doc
  if (typeof doc.getFontList === 'function') {
    const list = doc.getFontList();
    // console.log('[PDF] Fonts ready for this doc:', list);
  }
}
