
import React from 'react';
export default function ViewSwitch({ value='table', onChange }){
  return (
    <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {['table','cards'].map(v => (
        <button
          key={v}
          type="button"
          onClick={() => onChange && onChange(v)}
          className={
            (value === v ? 'bg-emerald-600 text-white' : 'text-slate-700 active:bg-slate-50') +
            ' min-h-[44px] min-w-[4.5rem] px-4 py-2 text-sm font-medium sm:min-h-0 sm:min-w-0 sm:px-3 sm:py-1.5'
          }
        >
          {v === 'table' ? 'Bảng' : 'Thẻ'}
        </button>
      ))}
    </div>
  );
}
