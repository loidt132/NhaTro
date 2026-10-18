import React, { useEffect, useMemo, useState } from 'react';
import { monthKey } from '../utils/state';
import { fetchOwnedRows } from '../utils/nocodb';
import { listMeterSubmissions, createMeterSubmission } from '../utils/meterSubmissions';
import { uploadMeterPhoto } from '../utils/meterOcr';

const METER_LABELS = {
  electric: 'Điện',
  water: 'Nước',
};

const STATUS_LABELS = {
  pending: 'Chờ chủ trọ duyệt',
  confirmed: 'Đã xác nhận',
  rejected: 'Bị từ chối',
};

function UploadCard({ meterType, roomId, month, onSubmitted, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { photoUrl, ocrRawText, ocrValue }
  const [sent, setSent] = useState(false);

  const onFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setSent(false);
    setBusy(true);
    try {
      const ocr = await uploadMeterPhoto(file, { roomId, month, meterType });
      setResult(ocr);
    } catch (err) {
      setError(err?.message || 'Không tải ảnh lên được.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!result) return;
    setBusy(true);
    setError('');
    try {
      await onSubmitted(meterType, result);
      setSent(true);
      setResult(null);
    } catch (err) {
      setError(err?.message || 'Không gửi được cho chủ trọ.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-2 font-semibold">Công tơ {METER_LABELS[meterType]}</div>

      {error ? (
        <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      ) : null}

      {sent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Đã gửi ảnh cho chủ trọ, đang chờ duyệt.
        </div>
      ) : result ? (
        <div className="space-y-2">
          <img src={result.photoUrl} alt={`Ảnh công tơ ${METER_LABELS[meterType]}`} className="max-h-56 w-full rounded-lg object-contain bg-slate-50" />
          <div className="text-sm text-slate-700">
            Số đọc được: <span className="font-semibold">{result.ocrValue ?? 'Không đọc được'}</span>
            <div className="text-xs text-slate-400">Chủ trọ sẽ kiểm tra và xác nhận số này.</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={send} disabled={busy} className="h-10 flex-1 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-60">
              {busy ? 'Đang gửi...' : 'Gửi cho chủ trọ'}
            </button>
            <label className="h-10 flex items-center justify-center rounded-lg border border-slate-200 px-3 text-sm cursor-pointer">
              Chụp lại
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} disabled={busy || disabled} />
            </label>
          </div>
        </div>
      ) : (
        <label className={`flex h-28 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-sm text-slate-500 ${busy || disabled ? 'opacity-60' : 'cursor-pointer'}`}>
          {busy ? 'Đang nhận diện ảnh...' : 'Chạm để chụp/chọn ảnh công tơ'}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} disabled={busy || disabled} />
        </label>
      )}
    </div>
  );
}

export default function TenantMeterUpload({ user }) {
  const [month, setMonth] = useState(monthKey());
  const [roomName, setRoomName] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [loadError, setLoadError] = useState('');

  const landlordId = user?.landlordId || '';
  const roomId = user?.linkedRoomId || '';

  const loadSubmissions = async () => {
    if (!landlordId) return;
    try {
      const rows = await listMeterSubmissions();
      setSubmissions(
        rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      );
    } catch (err) {
      setLoadError(err?.message || 'Không tải được lịch sử gửi ảnh.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!landlordId || !roomId) return;
      try {
        const rooms = await fetchOwnedRows('rooms', landlordId);
        if (cancelled) return;
        const room = rooms.find((r) => String(r.id) === String(roomId));
        setRoomName(room?.name || '');
      } catch (err) {
        if (!cancelled) setLoadError(err?.message || 'Không tải được thông tin phòng.');
      }
    })();
    loadSubmissions();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landlordId, roomId]);

  const missingLink = !landlordId || !roomId;

  const handleSubmitted = async (meterType, ocr) => {
    await createMeterSubmission({
      roomId,
      month,
      meterType,
      photoUrl: ocr.photoUrl,
      ocrRawText: ocr.ocrRawText || '',
      ocrValue: ocr.ocrValue,
    });
    await loadSubmissions();
  };

  const recentSubmissions = useMemo(() => submissions.slice(0, 10), [submissions]);

  if (missingLink) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Tài khoản của bạn chưa được liên kết với phòng nào. Vui lòng liên hệ chủ trọ.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
        <div className="text-sm text-slate-500">Phòng của bạn</div>
        <div className="text-lg font-semibold">{roomName || '—'}</div>
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Tháng</label>
          <input
            type="month"
            className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm sm:w-48"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadError}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <UploadCard meterType="electric" roomId={roomId} month={month} onSubmitted={handleSubmitted} />
        <UploadCard meterType="water" roomId={roomId} month={month} onSubmitted={handleSubmitted} />
      </div>

      {recentSubmissions.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
          <div className="mb-2 font-semibold">Lịch sử đã gửi</div>
          <div className="space-y-2">
            {recentSubmissions.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{METER_LABELS[row.meterType] || row.meterType} — {row.month}</div>
                  <div className="text-xs text-slate-500">Số: {row.finalValue ?? row.ocrValue ?? '—'}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  row.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800'
                  : row.status === 'rejected' ? 'bg-rose-100 text-rose-800'
                  : 'bg-amber-100 text-amber-800'
                }`}>
                  {STATUS_LABELS[row.status] || row.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
