// src/utils/vietqr.js
export function buildVietQrUrl(bankCode, accountNumber, amount, addInfo, accountName) {
  const bank = String(bankCode ?? '').trim();
  const account = String(accountNumber ?? '').replace(/\s+/g, '');
  const total = Math.round(Number(amount));
  if (!bank || !account) throw new Error('Thiếu mã ngân hàng hoặc số tài khoản.');
  if (!Number.isFinite(total) || total <= 0) throw new Error('Số tiền phải lớn hơn 0 để tạo mã QR.');
  return `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-qr_only.png`
    + `?amount=${total}`
    + `&addInfo=${encodeURIComponent(addInfo ?? '')}`
    + (accountName ? `&accountName=${encodeURIComponent(accountName)}` : '');
}

// Returns a data URL when the image can be fetched (CORS ok); otherwise falls
// back to the plain image URL, which an <img> loads without CORS. A 4xx from
// VietQR means the bank code / account / amount was rejected — report that
// instead of silently falling back.
export async function fetchVietQrPngDataUrl(bankCode, accountNumber, amount, addInfo, accountName) {
  const url = buildVietQrUrl(bankCode, accountNumber, amount, addInfo, accountName);
  let res;
  try {
    res = await fetch(url, { mode: 'cors', cache: 'no-store' });
  } catch {
    return url;
  }
  if (!res.ok) {
    throw new Error(`VietQR từ chối yêu cầu (${res.status}) — kiểm tra lại Mã NH, số tài khoản và số tiền trong Cài đặt.`);
  }
  return await blobToDataUrl(await res.blob());
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
  return template.replace(/\{room\}/gi, ctx.room ?? '');
}
