import React, { useEffect, useMemo, useState } from 'react';
import { currency, monthKey } from '../../utils/state';
import * as catalog from '../../utils/catalog';
import { exportStyledExcel } from '../../utils/exportExcel';
import { exportReportPdf } from '../../utils/pdf/exportInvoiceJspdf';
import { btn, btnPrimary, card, input, table, tableWrap, td, th } from '../../ui';

const monthsBetween = (fromYm, toYm) => {
  const [fy, fm] = String(fromYm).split('-').map(Number);
  const [ty, tm] = String(toYm).split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm)) + 1;
};
const addMonths = (ym, count) => {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(y, m - 1 + count, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function ServiceRevenueReport() {
  const now = monthKey();
  const [from, setFrom] = useState(now);
  const [to, setTo] = useState(now);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      try {
        const [cats, its] = await Promise.all([catalog.listCategories(), catalog.listItems()]);
        if (!cancelled) {
          setCategories(cats || []);
          setItems(its || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Không tải được danh mục dịch vụ.');
      }
    }
    loadCatalog();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const count = Math.min(60, monthsBetween(from, to));
        const months = Array.from({ length: count }, (_, i) => addMonths(from, i));
        const results = await Promise.all(months.map((m) => catalog.listOrders({ month: m, status: 'done' })));
        if (!cancelled) setOrders(results.flat().filter(Boolean));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Không tải được đơn dịch vụ.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [from, to]);

  const categoryNameById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);
  const itemCategoryId = useMemo(() => Object.fromEntries(items.map((it) => [it.id, it.categoryId || null])), [items]);

  function categoryOf(order) {
    const categoryId = itemCategoryId[order.itemId];
    return (categoryId && categoryNameById[categoryId]) || 'Phụ thu / khác';
  }

  const filteredOrders = useMemo(() => {
    if (categoryFilter === 'all') return orders;
    return orders.filter((o) => (itemCategoryId[o.itemId] || '') === categoryFilter);
  }, [orders, categoryFilter, itemCategoryId]);

  const rows = useMemo(() => {
    const byItem = {};
    for (const o of filteredOrders) {
      const key = o.itemId || o.itemName;
      if (!byItem[key]) byItem[key] = { name: o.itemName, unit: o.unit, category: categoryOf(o), qty: 0, orderCount: 0, amount: 0 };
      byItem[key].qty += Number(o.quantity) || 0;
      byItem[key].orderCount += 1;
      byItem[key].amount += Number(o.amount) || 0;
    }
    return Object.values(byItem).sort((a, b) => b.amount - a.amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOrders, categoryNameById, itemCategoryId]);

  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  function downloadExcel() {
    exportStyledExcel({
      filename: `doanh-thu-dich-vu-${from}-${to}.xlsx`,
      sheetName: 'Doanh thu dịch vụ',
      title: 'Báo cáo doanh thu dịch vụ',
      subtitle: `${from} – ${to}`,
      columns: [
        { header: 'Tên dịch vụ', key: 'name', width: 28 },
        { header: 'Loại dịch vụ', key: 'category', width: 18 },
        { header: 'Đơn vị', key: 'unit', width: 10 },
        { header: 'Số đơn', key: 'orderCount', width: 10 },
        { header: 'Số lượng', key: 'qty', width: 10 },
        { header: 'Doanh thu', key: 'amount', width: 18, money: true },
      ],
      rows: rows.map((r) => ({ name: r.name, category: r.category, unit: r.unit, orderCount: r.orderCount, qty: r.qty, amount: r.amount })),
      totals: { name: 'Tổng cộng', amount: total },
    });
  }

  function downloadPdf() {
    exportReportPdf({
      title: 'BÁO CÁO DOANH THU DỊCH VỤ',
      subtitle: `${from} – ${to}`,
      columns: ['Tên dịch vụ', 'Loại dịch vụ', 'Đơn vị', 'Số đơn', 'Số lượng', 'Doanh thu'],
      rows: rows.map((r) => [r.name, r.category, r.unit, r.orderCount, r.qty, `${currency(r.amount)} đ`]),
      summary: [`Tổng doanh thu: ${currency(total)} đ`],
      fileName: `doanh-thu-dich-vu-${from}-${to}.pdf`,
    });
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">Doanh thu dịch vụ</h3>
          <div className="flex gap-2">
            <button type="button" onClick={downloadExcel} disabled={!rows.length} className={btnPrimary}>Xuất Excel</button>
            <button type="button" onClick={downloadPdf} disabled={!rows.length} className={btn}>Xuất PDF</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Từ tháng</span>
          <input type="month" className={`${input} w-auto`} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-slate-500">đến tháng</span>
          <input type="month" className={`${input} w-auto`} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          <span className="text-slate-500">Loại dịch vụ</span>
          <select className={`${input} w-auto`} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">Tất cả loại dịch vụ</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        Chỉ tính các đơn dịch vụ đã <b>hoàn thành</b> trong khoảng tháng đã chọn. Doanh thu dịch vụ: <b>{currency(total)} đ</b> trên <b>{rows.length}</b> loại dịch vụ.
      </div>
      <div className={card}>
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Tên dịch vụ</th>
                <th className={th}>Loại dịch vụ</th>
                <th className={th}>Đơn vị</th>
                <th className={`${th} text-right`}>Số đơn</th>
                <th className={`${th} text-right`}>Số lượng</th>
                <th className={`${th} text-right`}>Doanh thu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className={`${td} font-medium text-slate-900`}>{r.name}</td>
                  <td className={td}>{r.category}</td>
                  <td className={td}>{r.unit}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.orderCount}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.qty}</td>
                  <td className={`${td} text-right tabular-nums font-semibold`}>{currency(r.amount)} đ</td>
                </tr>
              ))}
              {!rows.length && !loading ? (
                <tr><td colSpan={6} className={`${td} text-center text-slate-500`}>Chưa có doanh thu dịch vụ trong khoảng tháng đã chọn.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
