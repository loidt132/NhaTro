
import React from 'react';

export default function MonthYearPicker({ value, mode = 'month', onChange }) {
  const now = new Date();
  const years = Array.from({ length: 8 }, (_, i) => String(now.getFullYear() - i));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const handleMonth = (m) => onChange && onChange({ ...value, month: `${value?.year || String(now.getFullYear())}-${m}` });
  const handleYear = (y) => onChange && onChange({ ...value, year: y, month: `${y}-${(value?.month?.split('-')[1]) || String(now.getMonth()+1).padStart(2,'0')}` });
  return (
    <div className="flex items-center gap-2">
      <select className="border rounded px-2 py-1" value={value?.year || String(now.getFullYear())} onChange={e=>handleYear(e.target.value)}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      {mode === 'month' && (
        <select className="border rounded px-2 py-1" value={value?.month?.split('-')[1] || String(now.getMonth()+1).padStart(2,'0')} onChange={e=>handleMonth(e.target.value)}>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      )}
    </div>
  );
}
