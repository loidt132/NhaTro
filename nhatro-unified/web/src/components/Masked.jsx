import React, { useState } from 'react';

// Hides all but the last `keep` characters: "012345678901" -> "••••••••8901".
export function maskValue(value, keep = 4) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= keep) return '•'.repeat(text.length);
  return '•'.repeat(text.length - keep) + text.slice(-keep);
}

// Personal data (CCCD / phone) shown masked by default; the eye button reveals
// it for this one value only, and it hides again when the page re-renders anew.
// Data entry forms and exports are not affected.
export default function Masked({ value, keep = 4, empty = '—', className = '' }) {
  const [shown, setShown] = useState(false);
  const text = String(value ?? '').trim();
  if (!text) return <span className={className}>{empty}</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span>{shown ? text : maskValue(text, keep)}</span>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        aria-label={shown ? 'Ẩn thông tin' : 'Hiện thông tin'}
        title={shown ? 'Ẩn' : 'Hiện'}
      >
        {shown ? '🙈' : '👁'}
      </button>
    </span>
  );
}
