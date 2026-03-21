
// src/utils/pdf/vietqr.js
export async function fetchVietQrPngDataUrl(bankCode, accountNumber, amount, addInfo, accountName) {
  const url = `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(accountNumber)}-qr_only.png`
    + `?amount=${encodeURIComponent(amount)}`
    + `&addInfo=${encodeURIComponent(addInfo)}`
    + (accountName ? `&accountName=${encodeURIComponent(accountName)}` : '');
  const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
  if (!res.ok) throw new Error(`Tải VietQR thất bại: ${res.status}`);
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export function fillAddInfoTemplate(template, ctx) {
  return template.replace(/\{room\}/gi, ctx.room).replace(/\{month\}/gi, ctx.month);
}

export function vnd(n) { return (n ?? 0).toLocaleString('vi-VN'); }
