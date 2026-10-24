import { useEffect, useState } from "react";
import { homestayApi, userAdminApi } from "../api.js";
import { btn, btnDanger, btnPrimary, card, input, label, table, tableWrap, td, th } from "../ui.js";
import { useAuth } from "../AuthContext.js";
import { useHomestay } from "../HomestayContext.js";

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const [tab, setTab] = useState("general");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Cài đặt</h1>

      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-0">
        <TabButton active={tab === "general"} onClick={() => setTab("general")}>Cài đặt chung</TabButton>
        {isAdmin && (
          <TabButton active={tab === "users"} onClick={() => setTab("users")}>Quản lý người dùng</TabButton>
        )}
      </div>

      {tab === "general" ? <GeneralSettings isAdmin={isAdmin} /> : <UserManagement currentUserId={user.id} />}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active ? "border-emerald-600 text-emerald-600" : "border-transparent text-slate-600 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function GeneralSettings({ isAdmin }) {
  const { currentHomestayId } = useHomestay();
  const [s, setS] = useState({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setS(await homestayApi.getSettings({ fresh: true }));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [currentHomestayId]);

  async function save() {
    const normalized = {
      ...s,
      bankCode: (s.bankCode || "").toUpperCase(),
      accountName: (s.accountName || "").toUpperCase(),
      qrNoteTemplate: (s.qrNoteTemplate || "Thanh toan phong {room}").trim(),
    };
    await homestayApi.updateSettings(normalized);
    setS(normalized);
    window.dispatchEvent(new Event("homestay-settings-saved"));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {!isAdmin && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Chỉ admin mới được sửa cài đặt — bạn đang xem ở chế độ chỉ đọc.
        </div>
      )}

      <fieldset disabled={!isAdmin} className="space-y-4">
      <div className={card}>
        <h2 className="mb-3 font-semibold text-slate-900">Cài đặt thanh toán</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className={label}>Mã NH (VietQR)</label>
            <input
              className={input}
              value={s.bankCode || ""}
              onChange={(e) => setS({ ...s, bankCode: e.target.value.toUpperCase() })}
              placeholder="VD: MB, VCB, TCB..."
            />
          </div>
          <div className="space-y-1">
            <label className={label}>Số tài khoản</label>
            <input className={input} value={s.accountNo || ""} onChange={(e) => setS({ ...s, accountNo: e.target.value })} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className={label}>Chủ tài khoản</label>
            <input
              className={input}
              value={s.accountName || ""}
              onChange={(e) => setS({ ...s, accountName: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className={label}>Mẫu nội dung chuyển khoản</label>
            <input
              className={input}
              value={s.qrNoteTemplate || ""}
              onChange={(e) => setS({ ...s, qrNoteTemplate: e.target.value })}
            />
            <div className="text-xs text-slate-500">
              Dùng <code className="rounded bg-slate-100 px-1">{"{room}"}</code>, ví dụ: Thanh toan phong {"{room}"}
            </div>
          </div>
        </div>
      </div>

      <div className={card}>
        <h2 className="mb-3 font-semibold text-slate-900">Thông tin chủ homestay</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className={label}>Tên chủ homestay</label>
            <input className={input} value={s.ownerName || ""} onChange={(e) => setS({ ...s, ownerName: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className={label}>Số điện thoại</label>
            <input className={input} value={s.ownerPhone || ""} onChange={(e) => setS({ ...s, ownerPhone: e.target.value })} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className={label}>Địa chỉ</label>
            <input className={input} value={s.ownerAddress || ""} onChange={(e) => setS({ ...s, ownerAddress: e.target.value })} />
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-xs font-medium text-emerald-600">Đã lưu</span>}
          <button className={btnPrimary} onClick={save}>Lưu cấu hình</button>
        </div>
      )}
      </fieldset>
    </div>
  );
}

function UserManagement({ currentUserId }) {
  const { currentHomestayId, homestays, setCurrentHomestayId } = useHomestay();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [users, setUsers] = useState([]);
  const [userModal, setUserModal] = useState(null); // { mode: "create" | "edit", userRow? }
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setUsers(await userAdminApi.list());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [currentHomestayId]);

  async function removeUser(id) {
    try {
      await userAdminApi.remove(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className={card}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Quản lý người dùng</h2>
        <button className={`${btn} !py-1.5 !text-xs`} disabled={!currentHomestayId} onClick={() => setUserModal({ mode: "create" })}>+ Thêm người dùng</button>
      </div>
      {isOwner && (
        <div className="mb-3 space-y-1">
          <label className={label}>Homestay</label>
          <select
            className={input}
            value={currentHomestayId || ""}
            onChange={(e) => setCurrentHomestayId(e.target.value)}
          >
            {homestays.length === 0 && <option value="">Chưa có homestay</option>}
            {homestays.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          <div className="text-xs text-slate-500">Người dùng bên dưới và người dùng mới sẽ thuộc homestay này.</div>
        </div>
      )}
      {error && (
        <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}
      <div className={tableWrap}>
        <table className={table}>
          <thead>
            <tr>
              <th className={th}>Tên đăng nhập</th><th className={th}>Họ tên</th><th className={th}>Vai trò</th><th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={td}>{u.username}</td>
                <td className={td}>{u.name}</td>
                <td className={td}>{u.role === "admin" ? "Quản trị" : "Nhân viên"}</td>
                <td className={td}>
                  <div className="flex justify-end gap-2">
                    <button className={`${btn} !py-1.5 !text-xs`} onClick={() => setUserModal({ mode: "edit", userRow: u })}>Sửa</button>
                    {u.id !== currentUserId && (
                      <button className={btnDanger} onClick={() => removeUser(u.id)}>Xoá</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {userModal && (
        <UserModal
          mode={userModal.mode}
          userRow={userModal.userRow}
          onClose={() => setUserModal(null)}
          onSaved={() => {
            setUserModal(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function UserModal({ mode, userRow, onClose, onSaved }) {
  const [username, setUsername] = useState(userRow?.username || "");
  const [name, setName] = useState(userRow?.name || "");
  const [role, setRole] = useState(userRow?.role || "staff");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (mode === "create" && (!username.trim() || !password)) {
      setError("Vui lòng nhập tên đăng nhập và mật khẩu");
      return;
    }
    if (!name.trim()) {
      setError("Vui lòng nhập họ tên");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (mode === "edit") {
        const body = { name, role };
        if (password) body.password = password;
        await userAdminApi.update(userRow.id, body);
      } else {
        await userAdminApi.create({ username: username.trim(), password, name, role });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="modal-panel w-full max-w-md rounded-2xl bg-white p-4 shadow" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold text-slate-900">
          {mode === "edit" ? "Cập nhật người dùng" : "Thêm người dùng"}
        </div>
        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className={label}>Tên đăng nhập</label>
            <input
              className={input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={mode === "edit"}
            />
          </div>
          <div className="space-y-1">
            <label className={label}>Họ tên</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className={label}>Vai trò</label>
            <select className={input} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="staff">Nhân viên</option>
              <option value="admin">Quản trị</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={label}>{mode === "edit" ? "Đặt lại mật khẩu" : "Mật khẩu"}</label>
            <input
              type="password"
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "edit" ? "Để trống nếu không đổi mật khẩu" : ""}
            />
            {mode === "edit" && (
              <p className="text-xs text-slate-500">
                Mật khẩu được mã hoá một chiều — kể cả admin cũng không xem lại được mật khẩu cũ, chỉ có thể đặt mật khẩu mới.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={btn}>Huỷ</button>
            <button disabled={submitting} className={btnPrimary}>
              {submitting ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
