import { useState } from "react";
import { ownerApi } from "../api.js";
import { btn, btnPrimary, card, input, label, table, tableWrap, td, th } from "../ui.js";
import { useHomestay } from "../HomestayContext.js";

export default function HomesteyAdmin() {
  const { currentHomestayId, homesteys, setCurrentHomestayId, refreshHomesteys } = useHomestay();
  const [modal, setModal] = useState(null); // { mode: "create" | "edit", homestay? }
  const [error, setError] = useState("");

  async function refresh(preferId) {
    try {
      await refreshHomesteys(preferId);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Quản lý Homestay</h1>
          <p className="mt-1 text-sm text-slate-500">
            Mỗi homestay có phòng, bảng giá, dịch vụ/phụ thu và nhân sự riêng — admin/nhân viên của 1 homestay chỉ
            thấy dữ liệu của homestay đó.
          </p>
        </div>
        <button className={btnPrimary} onClick={() => setModal({ mode: "create" })}>+ Thêm homestay</button>
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className={card}>
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Tên homestay</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {homesteys.map((h) => (
                <tr key={h.id}>
                  <td className={td}>
                    {h.name}
                    {h.id === currentHomestayId && <span className="ml-2 text-xs text-emerald-600">(đang xem)</span>}
                  </td>
                  <td className={td}>
                    <div className="flex justify-end gap-2">
                      {h.id !== currentHomestayId && (
                        <button className={`${btn} !py-1.5 !text-xs`} onClick={() => setCurrentHomestayId(h.id)}>Xem</button>
                      )}
                      <button className={`${btn} !py-1.5 !text-xs`} onClick={() => setModal({ mode: "edit", homestay: h })}>Sửa tên</button>
                    </div>
                  </td>
                </tr>
              ))}
              {homesteys.length === 0 && (
                <tr>
                  <td className={td} colSpan={2}>Chưa có homestay nào.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <HomesteyModal
          mode={modal.mode}
          homestay={modal.homestay}
          onClose={() => setModal(null)}
          onSaved={(savedHomestay) => {
            setModal(null);
            refresh(savedHomestay.id);
          }}
        />
      )}
    </div>
  );
}

function HomesteyModal({ mode, homestay, onClose, onSaved }) {
  const [name, setName] = useState(homestay?.name || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Vui lòng nhập tên homestay");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const saved =
        mode === "edit"
          ? await ownerApi.renameHomestay(homestay.id, name.trim())
          : await ownerApi.addHomestay(name.trim());
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold text-slate-900">
          {mode === "edit" ? "Sửa tên homestay" : "Thêm homestay"}
        </div>
        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className={label}>Tên homestay</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Homestay Tuấn Tú" autoFocus />
          </div>
          {mode === "create" && (
            <p className="text-xs text-slate-500">
              Hệ thống sẽ tự tạo sẵn 2 loại phòng (Standard/Deluxe) và bảng giá mặc định — bạn chỉnh lại sau khi tạo.
            </p>
          )}
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
