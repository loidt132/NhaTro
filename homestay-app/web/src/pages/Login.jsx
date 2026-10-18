import { useState } from "react";
import { authApi } from "../api.js";
import { btnPrimary, input, label } from "../ui.js";

export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Vui lòng nhập tên đăng nhập và mật khẩu");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await authApi.login(username.trim(), password);
      onLoggedIn(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-2xl bg-emerald-600" aria-hidden />
          <div>
            <div className="text-lg font-bold text-slate-900">Quản lý Homestay</div>
            <div className="text-xs text-slate-500">Đăng nhập để tiếp tục</div>
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className={label}>Tên đăng nhập</label>
            <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <label className={label}>Mật khẩu</label>
            <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button disabled={submitting} className={`${btnPrimary} w-full`}>
            {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Để dùng thử, vui lòng liên hệ quản trị viên: 0904697882
        </p>
      </div>
    </div>
  );
}
