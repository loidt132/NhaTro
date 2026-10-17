import { getStoredToken } from './auth';

function apiBase() {
  return (import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');
}

// Uploads a meter photo, returns { photoUrl, ocrRawText, ocrValue }.
// Used by both the landlord's inline "Tải ảnh & nhận diện" button and the
// tenant upload page — the server endpoint doesn't distinguish the caller.
export async function uploadMeterPhoto(file, { roomId, month, meterType }) {
  const formData = new FormData();
  formData.append('photo', file);
  formData.append('roomId', roomId || '');
  formData.append('month', month || '');
  formData.append('meterType', meterType || '');

  const res = await fetch(`${apiBase()}/api/meter/ocr-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getStoredToken()}` },
    body: formData,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    throw new Error(data?.error || 'Không thể xử lý ảnh công tơ.');
  }

  return data;
}
