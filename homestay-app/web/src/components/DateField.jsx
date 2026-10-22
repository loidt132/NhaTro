import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { label } from "../ui.js";

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

// Compact custom calendar: the native iOS/Android date popup is huge and
// can't be resized, so reports use this small dropdown instead.
export default function DateField({ label: text, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => dayjs(value || undefined).startOf("month"));
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function toggle() {
    if (!open) setMonth(dayjs(value || undefined).startOf("month"));
    setOpen(!open);
  }

  const offset = (month.day() + 6) % 7; // Monday first
  const cells = [...Array(offset).fill(null), ...Array.from({ length: month.daysInMonth() }, (_, i) => month.date(i + 1))];
  const today = dayjs().format("YYYY-MM-DD");

  return (
    <div className="relative min-w-0 space-y-1" ref={ref}>
      <label className={`${label} block`}>{text}</label>
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-full items-center rounded-xl border border-slate-200 bg-white px-3 text-left text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 sm:w-44"
      >
        {value ? dayjs(value).format("DD/MM/YYYY") : "—"}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between text-sm">
            <button type="button" className="rounded-lg px-2.5 py-1 hover:bg-slate-100" onClick={() => setMonth(month.subtract(1, "month"))}>‹</button>
            <span className="font-semibold text-slate-900">Tháng {month.format("M/YYYY")}</span>
            <button type="button" className="rounded-lg px-2.5 py-1 hover:bg-slate-100" onClick={() => setMonth(month.add(1, "month"))}>›</button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] text-slate-400">
            {WEEKDAYS.map((d) => <div key={d} className="py-0.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 text-center text-sm">
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const key = d.format("YYYY-MM-DD");
              const selected = key === value;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  className={`m-0.5 h-8 rounded-lg ${
                    selected ? "bg-emerald-600 font-semibold text-white" : key === today ? "font-semibold text-emerald-700 hover:bg-slate-100" : "hover:bg-slate-100"
                  }`}
                >
                  {d.date()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
