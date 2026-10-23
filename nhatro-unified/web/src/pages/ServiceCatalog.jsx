// src/pages/ServiceCatalog.jsx
// Quản lý danh mục + bảng giá dịch vụ/phụ thu (catalog-service). Tách riêng khỏi
// màn "Đơn dịch vụ" (ServiceOrders.jsx) để nhân viên tạo đơn không cần đi qua
// màn cấu hình giá, và ngược lại.
import React, { useEffect, useState } from 'react';
import { currency } from '../utils/state';
import * as catalog from '../utils/catalog';
import Page from '../components/Page';
import PaginationControls from '../components/PaginationControls';
import { badgeBase, btn, btnDanger, btnPrimary, card, input, label, table, tableWrap, td, th } from '../ui';

export default function ServiceCatalog() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [categoryModal, setCategoryModal] = useState(null); // { mode, category? }
  const [itemModal, setItemModal] = useState(null); // { mode, item? }

  const [servicePage, setServicePage] = useState(1);
  const [servicePerPage, setServicePerPage] = useState(10);
  const [surchargePage, setSurchargePage] = useState(1);
  const [surchargePerPage, setSurchargePerPage] = useState(10);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [cats, its] = await Promise.all([catalog.listCategories(), catalog.listItems()]);
      setCategories(cats || []);
      setItems(its || []);
    } catch (err) {
      setError(err.message || 'Không tải được danh mục dịch vụ.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function categoryName(id) {
    return categories.find((c) => c.id === id)?.name || '—';
  }

  async function removeCategory(id) {
    if (!confirm('Xóa danh mục này?')) return;
    try {
      await catalog.deleteCategory(id);
      await refresh();
    } catch (err) {
      alert(err.message || 'Không xóa được danh mục.');
    }
  }

  async function removeItem(id) {
    if (!confirm('Xóa dịch vụ/phụ thu này?')) return;
    try {
      await catalog.deleteItem(id);
      await refresh();
    } catch (err) {
      alert(err.message || 'Không xóa được.');
    }
  }

  const serviceItems = items.filter((i) => (i.kind || 'service') === 'service');
  const surchargeItems = items.filter((i) => i.kind === 'surcharge');

  const serviceTotalPages = Math.max(1, Math.ceil(serviceItems.length / servicePerPage));
  const serviceCurrentPage = Math.min(servicePage, serviceTotalPages);
  const pagedServiceItems = serviceItems.slice((serviceCurrentPage - 1) * servicePerPage, serviceCurrentPage * servicePerPage);

  const surchargeTotalPages = Math.max(1, Math.ceil(surchargeItems.length / surchargePerPage));
  const surchargeCurrentPage = Math.min(surchargePage, surchargeTotalPages);
  const pagedSurchargeItems = surchargeItems.slice((surchargeCurrentPage - 1) * surchargePerPage, surchargeCurrentPage * surchargePerPage);

  return (
    <Page className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Bảng giá dịch vụ &amp; phụ thu</h2>
        <button type="button" className={btnPrimary} onClick={() => setItemModal({ mode: 'create' })}>+ Thêm mới</button>
      </div>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-500">Đang tải...</div> : null}

      <div className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">Danh mục dịch vụ</h3>
          <button type="button" className={`${btn} !py-1.5 !text-xs`} onClick={() => setCategoryModal({ mode: 'create' })}>+ Thêm danh mục</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <span key={cat.id} className={`${badgeBase} inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-700`}>
              <button type="button" onClick={() => setCategoryModal({ mode: 'edit', category: cat })} className="hover:underline">
                {cat.name}
              </button>
              <button
                type="button"
                className="text-emerald-700/70 hover:text-rose-600"
                onClick={() => removeCategory(cat.id)}
                aria-label={`Xóa danh mục ${cat.name}`}
              >
                ✕
              </button>
            </span>
          ))}
          {!categories.length && !loading ? <span className="text-sm text-slate-500">Chưa có danh mục nào.</span> : null}
        </div>
        <p className="mt-2 text-xs text-slate-500">Bấm vào tên danh mục để sửa, bấm ✕ để xoá.</p>
      </div>

      <div className={card}>
        <h3 className="mb-2 font-semibold text-slate-900">Dịch vụ / hàng hoá ({serviceItems.length})</h3>
        {serviceItems.length ? (
          <div className="mb-3">
            <PaginationControls
              totalItems={serviceItems.length}
              page={serviceCurrentPage}
              perPage={servicePerPage}
              onPageChange={setServicePage}
              onPerPageChange={(n) => { setServicePerPage(n); setServicePage(1); }}
            />
          </div>
        ) : null}
        <div className="divide-y divide-slate-100 sm:hidden">
          {pagedServiceItems.map((item) => (
            <ItemRow
              key={item.id}
              name={item.name}
              sub={`${categoryName(item.categoryId)} · ${item.unit}`}
              price={item.price}
              onEdit={() => setItemModal({ mode: 'edit', item })}
              onDelete={() => removeItem(item.id)}
            />
          ))}
          {!serviceItems.length ? <div className="py-3 text-sm text-slate-500">Chưa có dịch vụ nào.</div> : null}
        </div>
        <div className={`${tableWrap} hidden sm:block`}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Tên</th>
                <th className={th}>Danh mục</th>
                <th className={th}>Đơn vị</th>
                <th className={`${th} text-right`}>Đơn giá</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {pagedServiceItems.map((item) => (
                <tr key={item.id}>
                  <td className={td}>{item.name}</td>
                  <td className={td}>{categoryName(item.categoryId)}</td>
                  <td className={td}>{item.unit}</td>
                  <td className={`${td} text-right tabular-nums`}>{currency(item.price)} đ</td>
                  <td className={td}>
                    <div className="flex justify-end gap-2">
                      <button type="button" className={`${btn} !py-1.5 !text-xs`} onClick={() => setItemModal({ mode: 'edit', item })}>Sửa</button>
                      <button type="button" className={btnDanger} onClick={() => removeItem(item.id)}>Xoá</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!serviceItems.length ? (
                <tr><td colSpan={5} className={`${td} text-center text-slate-500`}>Chưa có dịch vụ nào.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-2 font-semibold text-slate-900">Phụ thu ({surchargeItems.length})</h3>
        {surchargeItems.length ? (
          <div className="mb-3">
            <PaginationControls
              totalItems={surchargeItems.length}
              page={surchargeCurrentPage}
              perPage={surchargePerPage}
              onPageChange={setSurchargePage}
              onPerPageChange={(n) => { setSurchargePerPage(n); setSurchargePage(1); }}
            />
          </div>
        ) : null}
        <div className="divide-y divide-slate-100 sm:hidden">
          {pagedSurchargeItems.map((item) => (
            <ItemRow
              key={item.id}
              name={item.name}
              sub={item.unit}
              price={item.price}
              onEdit={() => setItemModal({ mode: 'edit', item })}
              onDelete={() => removeItem(item.id)}
            />
          ))}
          {!surchargeItems.length ? <div className="py-3 text-sm text-slate-500">Chưa có phụ thu nào.</div> : null}
        </div>
        <div className={`${tableWrap} hidden sm:block`}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Tên phụ thu</th>
                <th className={th}>Đơn vị</th>
                <th className={`${th} text-right`}>Số tiền</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {pagedSurchargeItems.map((item) => (
                <tr key={item.id}>
                  <td className={td}>{item.name}</td>
                  <td className={td}>{item.unit}</td>
                  <td className={`${td} text-right tabular-nums`}>{currency(item.price)} đ</td>
                  <td className={td}>
                    <div className="flex justify-end gap-2">
                      <button type="button" className={`${btn} !py-1.5 !text-xs`} onClick={() => setItemModal({ mode: 'edit', item })}>Sửa</button>
                      <button type="button" className={btnDanger} onClick={() => removeItem(item.id)}>Xoá</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!surchargeItems.length ? (
                <tr><td colSpan={4} className={`${td} text-center text-slate-500`}>Chưa có phụ thu nào.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {categoryModal ? (
        <CategoryModal
          mode={categoryModal.mode}
          category={categoryModal.category}
          onClose={() => setCategoryModal(null)}
          onSaved={() => { setCategoryModal(null); refresh(); }}
        />
      ) : null}

      {itemModal ? (
        <ItemModal
          mode={itemModal.mode}
          item={itemModal.item}
          categories={categories}
          onClose={() => setItemModal(null)}
          onSaved={() => { setItemModal(null); refresh(); }}
        />
      ) : null}
    </Page>
  );
}

function ItemRow({ name, sub, price, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-900">{name}</div>
        <div className="truncate text-xs text-slate-500">{sub}</div>
        <div className="mt-0.5 font-semibold tabular-nums text-emerald-700">{currency(price)} đ</div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button type="button" className={`${btn} !px-2.5 !py-1 !text-xs`} onClick={onEdit}>Sửa</button>
        <button type="button" className={`${btnDanger} !px-2.5 !py-1`} onClick={onDelete}>Xoá</button>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold text-slate-900">{title}</div>
        {children}
      </div>
    </div>
  );
}

function CategoryModal({ mode, category, onClose, onSaved }) {
  const [name, setName] = useState(category?.name || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Vui lòng nhập tên danh mục'); return; }
    setSubmitting(true);
    setError('');
    try {
      if (mode === 'edit') await catalog.updateCategory(category.id, { name: name.trim() });
      else await catalog.createCategory({ name: name.trim() });
      onSaved();
    } catch (err) {
      setError(err.message || 'Không lưu được danh mục.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={mode === 'edit' ? 'Sửa danh mục' : 'Thêm danh mục'} onClose={onClose}>
      {error ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1">
          <label className={label}>Tên danh mục</label>
          <input autoFocus className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btn}>Hủy</button>
          <button disabled={submitting} className={btnPrimary}>{submitting ? 'Đang lưu...' : 'Lưu'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ItemModal({ mode, item, categories, onClose, onSaved }) {
  const [kind, setKind] = useState(item?.kind || 'service');
  const [categoryId, setCategoryId] = useState(item?.categoryId || categories[0]?.id || '');
  const [name, setName] = useState(item?.name || '');
  const [unit, setUnit] = useState(item?.unit || '');
  const [price, setPrice] = useState(item?.price ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || price === '') { setError('Vui lòng nhập tên và đơn giá'); return; }
    setSubmitting(true);
    setError('');
    try {
      const body = { kind, name: name.trim(), unit: unit.trim(), price: Number(price), categoryId: kind === 'service' ? (categoryId || null) : null };
      if (mode === 'edit') await catalog.updateItem(item.id, body);
      else await catalog.createItem(body);
      onSaved();
    } catch (err) {
      setError(err.message || 'Không lưu được dịch vụ.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`${mode === 'edit' ? 'Sửa' : 'Thêm'} ${kind === 'surcharge' ? 'phụ thu' : 'dịch vụ'}`} onClose={onClose}>
      {error ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1">
          <label className={label}>Loại</label>
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="service">Dịch vụ</option>
            <option value="surcharge">Phụ thu</option>
          </select>
        </div>
        {kind === 'service' ? (
          <div className="space-y-1">
            <label className={label}>Danh mục</label>
            <select className={input} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Không chọn —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ) : null}
        <div className="space-y-1">
          <label className={label}>Tên</label>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className={label}>Đơn vị</label>
          <input className={input} placeholder="kg, lần..." value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className={label}>Đơn giá</label>
          <input type="number" className={input} value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btn}>Hủy</button>
          <button disabled={submitting} className={btnPrimary}>{submitting ? 'Đang lưu...' : 'Lưu'}</button>
        </div>
      </form>
    </Modal>
  );
}
