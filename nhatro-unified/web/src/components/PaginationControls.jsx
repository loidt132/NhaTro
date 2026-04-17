import React from 'react';

const PAGE_SIZES = [5, 10, 20];

export default function PaginationControls({
  totalItems = 0,
  page = 1,
  perPage = 10,
  onPageChange,
  onPerPageChange,
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = totalItems === 0 ? 0 : (currentPage - 1) * perPage + 1;
  const end = Math.min(totalItems, currentPage * perPage);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-slate-600">
        Hiển thị {start}-{end} / {totalItems}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="per-page-select">
          Mỗi trang
        </label>
        <select
          id="per-page-select"
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-1 text-sm disabled:opacity-50"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Trước
        </button>
        <span className="text-sm text-slate-600">
          {currentPage}/{totalPages}
        </span>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-1 text-sm disabled:opacity-50"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Sau
        </button>
      </div>
    </div>
  );
}
