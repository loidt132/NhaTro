import React, { useState } from 'react';
import { sendOtp, confirmOtp, isFirebaseConfigured } from '../utils/firebase';
import { tenantVerifyPhone } from '../utils/auth';

const RECAPTCHA_CONTAINER_ID = 'tenant-auth-recaptcha';

export default function TenantAuth({ onAuthSuccess, onBack }) {
  const [step, setStep] = useState('phone'); // 'phone' | 'code'
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async (event) => {
    event.preventDefault();
    setError('');
    if (!isFirebaseConfigured()) {
      setError('Đăng nhập khách thuê chưa được cấu hình. Vui lòng liên hệ chủ trọ.');
      return;
    }
    if (!phone.trim()) {
      setError('Nhập số điện thoại.');
      return;
    }
    setBusy(true);
    try {
      const result = await sendOtp(phone, RECAPTCHA_CONTAINER_ID);
      setConfirmationResult(result);
      setStep('code');
    } catch (err) {
      setError(err?.message || 'Không gửi được mã OTP.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event) => {
    event.preventDefault();
    setError('');
    if (!code.trim()) {
      setError('Nhập mã OTP.');
      return;
    }
    setBusy(true);
    try {
      const idToken = await confirmOtp(confirmationResult, code.trim());
      const result = await tenantVerifyPhone(idToken);
      onAuthSuccess(result);
    } catch (err) {
      setError(err?.message || 'Mã OTP không đúng hoặc đã hết hạn.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100svh] bg-[radial-gradient(circle_at_top,_#dcfce7,_#f8fafc_48%,_#e2e8f0)] px-3 py-4 sm:px-4 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100svh-2rem)] max-w-md items-center justify-center sm:min-h-[calc(100vh-4rem)]">
        <div className="w-full rounded-[1.5rem] border border-white/70 bg-white/90 p-6 shadow-xl backdrop-blur sm:rounded-[2rem] sm:p-8 sm:shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Nha Tro Unified</div>
          <h1 className="mt-2 text-xl font-bold leading-tight text-slate-900 sm:text-2xl">Khách thuê đăng nhập</h1>
          <p className="mt-1 text-sm text-slate-500">Dùng số điện thoại đã đăng ký với chủ trọ để tải ảnh công tơ.</p>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {step === 'phone' ? (
            <form className="mt-5 space-y-3.5" onSubmit={sendCode}>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Số điện thoại</label>
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="09xxxxxxxx"
                  inputMode="tel"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="h-12 w-full rounded-2xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Đang gửi mã...' : 'Gửi mã OTP'}
              </button>
            </form>
          ) : (
            <form className="mt-5 space-y-3.5" onSubmit={verifyCode}>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Mã OTP đã gửi tới {phone}</label>
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="h-12 w-full rounded-2xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Đang xác thực...' : 'Xác nhận'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('phone'); setCode(''); setError(''); }}
                className="h-11 w-full rounded-2xl border border-slate-200 text-sm text-slate-600"
              >
                Đổi số điện thoại
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={onBack}
            className="mt-4 w-full text-center text-sm font-medium text-slate-500 underline underline-offset-2"
          >
            Quay lại đăng nhập chủ trọ
          </button>
        </div>
      </div>
      <div id={RECAPTCHA_CONTAINER_ID} />
    </div>
  );
}
