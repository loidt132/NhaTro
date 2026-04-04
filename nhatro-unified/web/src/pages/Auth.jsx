import React, { useState } from 'react';

export default function Auth({ onLogin, onRegister, busy = false, error = '' }) {
  const [mode, setMode] = useState('login');
  const [loginForm, setLoginForm] = useState({ identifier: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [localError, setLocalError] = useState('');

  const submitLogin = async (event) => {
    event.preventDefault();
    setLocalError('');
    await onLogin(loginForm);
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    setLocalError('');

    if (!registerForm.email.trim() && !registerForm.phone.trim()) {
      setLocalError('Nhập email hoặc số điện thoại.');
      return;
    }
    if (registerForm.password.length < 6) {
      setLocalError('Mật khẩu tối thiểu 6 ký tự.');
      return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
      setLocalError('Mật khẩu xác nhận không khớp.');
      return;
    }

    await onRegister({
      name: registerForm.name,
      email: registerForm.email,
      phone: registerForm.phone,
      password: registerForm.password,
    });
  };

  const message = localError || error;

  return (
    <div className="min-h-[100svh] bg-[radial-gradient(circle_at_top,_#dcfce7,_#f8fafc_48%,_#e2e8f0)] px-3 py-4 sm:px-4 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100svh-2rem)] max-w-5xl items-center justify-center sm:min-h-[calc(100vh-4rem)]">
        <div className="grid w-full overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/90 shadow-xl backdrop-blur sm:rounded-[2rem] sm:shadow-2xl lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden bg-emerald-700 px-8 py-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.25em]">
                Nha Tro Unified
              </div>
              <h1 className="mt-6 text-4xl font-black leading-tight">Quản lý nhà trọ với một tài khoản riêng.</h1>
              <p className="mt-4 max-w-md text-sm text-emerald-50/90">
                Đăng nhập bằng email hoặc số điện thoại để vào khu quản lý phòng, điện nước, thu tiền và cài đặt.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-emerald-50/90">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4">Email hoặc số điện thoại làm định danh đăng nhập.</div>
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4">Mỗi tài khoản có phiên đăng nhập riêng trên trình duyệt hiện tại.</div>
            </div>
          </section>

          <section className="px-4 py-5 sm:px-8 sm:py-8">
            <div className="mx-auto max-w-md">
              <div className="mb-5 lg:hidden">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Nha Tro Unified</div>
                <h1 className="mt-2 text-xl font-bold leading-tight text-slate-900 sm:text-2xl">Đăng nhập hoặc tạo tài khoản</h1>
              </div>

              <div className="mb-5 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setLocalError(''); }}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Đăng nhập
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('register'); setLocalError(''); }}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Đăng ký
                </button>
              </div>

              {message ? (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {message}
                </div>
              ) : null}

              {mode === 'login' ? (
                <form className="space-y-3.5" onSubmit={submitLogin}>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Email hoặc số điện thoại</label>
                    <input
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base"
                      value={loginForm.identifier}
                      onChange={(e) => setLoginForm((prev) => ({ ...prev, identifier: e.target.value }))}
                      placeholder="email@domain.com hoặc 09xxxxxxxx"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Mật khẩu</label>
                    <input
                      type="password"
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder="Nhập mật khẩu"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-12 w-full rounded-2xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-60"
                  >
                    {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
                  </button>
                </form>
              ) : (
                <form className="space-y-3.5" onSubmit={submitRegister}>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Họ tên</label>
                    <input
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base"
                      value={registerForm.name}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Tên chủ tài khoản"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                    <input
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base"
                      value={registerForm.email}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder="Có thể bỏ trống nếu dùng số điện thoại"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Số điện thoại</label>
                    <input
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base"
                      value={registerForm.phone}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="Có thể bỏ trống nếu dùng email"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Mật khẩu</label>
                    <input
                      type="password"
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base"
                      value={registerForm.password}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder="Tối thiểu 6 ký tự"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Xác nhận mật khẩu</label>
                    <input
                      type="password"
                      className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-base"
                      value={registerForm.confirmPassword}
                      onChange={(e) => setRegisterForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                      placeholder="Nhập lại mật khẩu"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-12 w-full rounded-2xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-60"
                  >
                    {busy ? 'Đang tạo tài khoản...' : 'Đăng ký'}
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
