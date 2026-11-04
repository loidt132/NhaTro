import React, { useEffect, useState } from 'react';

const REVEAL_MS = 60 * 1000;

// Hides all but the last `keep` characters: "012345678901" -> "••••••••8901".
export function maskValue(value, keep = 4) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= keep) return '•'.repeat(text.length);
  return '•'.repeat(text.length - keep) + text.slice(-keep);
}

// Personal data (CCCD / phone) shown masked by default. The eye button reveals
// this one value; it can't be hidden by hand and hides itself again after
// 1 minute. Data entry forms and exports are not affected.
export default function Masked({ value, keep = 4, empty = '—', className = '' }) {
  const [shown, setShown] = useState(false);
  const text = String(value ?? '').trim();
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setTimeout(() => setShown(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!text) return <span className={className}>{empty}</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span>{shown ? text : maskValue(text, keep)}</span>
      {!shown && (
        <button
          type="button"
          onClick={() => setShown(true)}
          className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label="Hiện thông tin"
          title="Hiện (tự ẩn sau 1 phút)"
        >
          👁
        </button>
      )}
    </span>
  );
}
