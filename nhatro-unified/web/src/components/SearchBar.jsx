
// src/components/SearchBar.jsx
import React, { useEffect, useRef, useState } from 'react';

export default function SearchBar({
  placeholder = 'Tìm kiếm (phòng, khách)',
  month,
  onMonthChange,
  query,
  onQueryChange,
  className = '',
}) {
  const [localQuery, setLocalQuery] = useState(query ?? '');
  const timer = useRef(null);

  useEffect(() => { setLocalQuery(query ?? ''); }, [query]);

  useEffect(() => {
    if (!onQueryChange) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onQueryChange(localQuery.trim()), 300);
    return () => clearTimeout(timer.current);
  }, [localQuery, onQueryChange]);

  return (
    <div className={`rounded-2xl border bg-white p-3 flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-2 flex-1">
        <input
          type="text"
          className="w-full border rounded-lg px-3 py-2"
          placeholder={placeholder}
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
        />
        {localQuery ? (
          <button
            title="Xóa"
            className="border rounded-lg px-3 py-2"
            onClick={() => { setLocalQuery(''); onQueryChange && onQueryChange(''); }}
          >
            Xóa
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="month"
          className="border rounded-lg px-3 py-2"
          value={month}
          onChange={(e) => onMonthChange && onMonthChange(e.target.value)}
        />
      </div>
    </div>
  );
}
