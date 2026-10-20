import { useEffect, useState } from "react";
import { catalogApi, formatVnd } from "../api.js";
import { badgeBase, btn, btnDanger, btnPrimary, card, input, label, table, tableWrap, td, th } from "../ui.js";
import { useAuth } from "../AuthContext.js";
import { useHomestay } from "../HomestayContext.js";

export default function ServiceCatalogAdmin() {
  const { user } = useAuth();
  const { currentHomestayId } = useHomestay();
  const isAdmin = user?.role === "admin";
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [itemModal, setItemModal] = useState(null); // { mode: "create" | "edit", item? }
  const [categoryModal, setCategoryModal] = useState(null); // { mode: "create" | "edit", category? }
  const [error, setError] = useState("");

  async function refresh() {
    if (!currentHomestayId) return;
    try {
      const [cats, itemsData] = await Promise.all([catalogApi.getCategories(), catalogApi.getItems()]);
      setCategories(cats);
      setItems(itemsData);
      setError("");
    } catch (err) {
      // Load failures (timeout, service down) go to the console only; the
      // banner is reserved for errors from the user's own actions.
      console.error("[catalog]", err);
    }
  }

  useEffect(() => {
    refresh();
  }, [currentHomestayId]);

  function categoryName(id) {
    return categories.find((c) => c.id === id)?.name || id;
  }

  async function removeItem(id) {
    await catalogApi.deleteItem(id);
    refresh();
  }

  const serviceItems = items.filter((i) => (i.kind || "service") === "service");
  const surchargeItems = items.filter((i) => i.kind === "surcharge");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bảng giá dịch vụ &amp; phụ thu</h1>
        </div>
        {isAdmin && (
          <button className={btnPrimary} onClick={() => setItemModal({ mode: "create" })}>+ Thêm mới</button>
        )}
      </div>
      {!currentHomestayId && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Chưa chọn homestay — vui lòng chọn homestay trước khi xem bảng giá.
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Danh mục dịch vụ</h2>
          {isAdmin && (
            <button className={`${btn} !py-1.5 !text-xs`} onClick={() => setCategoryModal({ mode: "create" })}>+ Thêm danh mục</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) =>
            isAdmin ? (
              <button
                key={c.id}
                onClick={() => setCategoryModal({ mode: "edit", category: c })}
                className={`${badgeBase} bg-emerald-100 text-emerald-700 hover:bg-emerald-200`}
              >
                {c.name}
              </button>
            ) : (
              <span key={c.id} className={`${badgeBase} bg-emerald-100 text-emerald-700`}>{c.name}</span>
            )
          )}
        </div>
        {isAdmin && <p className="mt-2 text-xs text-slate-500">Bấm vào 1 danh mục để sửa tên hoặc xoá.</p>}
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold text-slate-900">Dịch vụ / hàng hoá</h2>
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Tên</th><th className={th}>Danh mục</th><th className={th}>Đơn vị</th><th className={`${th} text-right`}>Đơn giá</th>
                {isAdmin && <th className={th}></th>}
              </tr>
            </thead>
            <tbody>
              {serviceItems.map((item) => (
                <tr key={item.id}>
                  <td className={td}>{item.name}</td>
                  <td className={td}>{categoryName(item.categoryId)}</td>
                  <td className={td}>{item.unit}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatVnd(item.price)}</td>
                  {isAdmin && (
                    <td className={td}>
                      <div className="flex justify-end gap-2">
                        <button className={`${btn} !py-1.5 !text-xs`} onClick={() => setItemModal({ mode: "edit", item })}>Sửa</button>
                        <button className={btnDanger} onClick={() => removeItem(item.id)}>Xoá</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold text-slate-900">Phụ thu</h2>
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Tên phụ thu</th><th className={th}>Đơn vị</th><th className={`${th} text-right`}>Số tiền</th>
                {isAdmin && <th className={th}></th>}
              </tr>
            </thead>
            <tbody>
              {surchargeItems.map((item) => (
                <tr key={item.id}>
                  <td className={td}>{item.name}</td>
                  <td className={td}>{item.unit}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatVnd(item.price)}</td>
                  {isAdmin && (
                    <td className={td}>
                      <div className="flex justify-end gap-2">
                        <button className={`${btn} !py-1.5 !text-xs`} onClick={() => setItemModal({ mode: "edit", item })}>Sửa</button>
                        <button className={btnDanger} onClick={() => removeItem(item.id)}>Xoá</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {itemModal && (
        <ItemModal
          mode={itemModal.mode}
          item={itemModal.item}
          categories={categories}
          onClose={() => setItemModal(null)}
          onSaved={() => {
            setItemModal(null);
            refresh();
          }}
        />
      )}

      {categoryModal && (
        <CategoryModal
          mode={categoryModal.mode}
          category={categoryModal.category}
          onClose={() => setCategoryModal(null)}
          onSaved={() => {
            setCategoryModal(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CategoryModal({ mode, category, onClose, onSaved }) {
  const [name, setName] = useState(category?.name || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Vui lòng nhập tên danh mục");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (mode === "edit") {
        await catalogApi.updateCategory(category.id, name.trim());
      } else {
        await catalogApi.addCategory(name.trim());
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    setSubmitting(true);
    setError("");
    try {
      await catalogApi.deleteCategory(category.id);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold text-slate-900">{mode === "edit" ? "Sửa danh mục" : "Thêm danh mục"}</div>
        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className={label}>Tên danh mục</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            {mode === "edit" ? (
              <button type="button" disabled={submitting} onClick={remove} className={btnDanger}>Xoá</button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={btn}>Huỷ</button>
              <button disabled={submitting} className={btnPrimary}>
                {submitting ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ItemModal({ mode, item, categories, onClose, onSaved }) {
  const [kind, setKind] = useState(item?.kind || "service");
  const [categoryId, setCategoryId] = useState(item?.categoryId || categories[0]?.id || "");
  const [name, setName] = useState(item?.name || "");
  const [unit, setUnit] = useState(item?.unit || "");
  const [price, setPrice] = useState(item?.price ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || price === "") {
      setError("Vui lòng nhập tên và đơn giá");
      return;
    }
    if (kind === "service" && !categoryId) {
      setError("Vui lòng chọn danh mục");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const body = { kind, name, unit, price, categoryId: kind === "service" ? categoryId : null };
      if (mode === "edit") {
        await catalogApi.updateItem(item.id, body);
      } else {
        await catalogApi.addItem(body);
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
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold text-slate-900">
          {mode === "edit" ? "Cập nhật" : "Thêm mới"} {kind === "surcharge" ? "phụ thu" : "dịch vụ"}
        </div>
        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className={label}>Loại</label>
            <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="service">Dịch vụ</option>
              <option value="surcharge">Phụ thu</option>
            </select>
          </div>
          {kind === "service" && (
            <div className="space-y-1">
              <label className={label}>Danh mục</label>
              <select className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className={label}>Tên</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className={label}>Đơn vị</label>
            <input className={input} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="lượt, chai..." />
          </div>
          <div className="space-y-1">
            <label className={label}>Đơn giá</label>
            <input type="number" className={input} value={price} onChange={(e) => setPrice(e.target.value)} />
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
