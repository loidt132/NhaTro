// Shared Tailwind class strings, kept in sync with homestay-app's palette
// (slate neutrals, emerald-600 brand, amber/rose/sky status accents).

export const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

export const btn = "inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50";
export const btnPrimary = "inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60";
export const btnDanger = "inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100";

export const input = "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
export const label = "text-xs font-medium text-slate-600";

// Wrap every <table> in a div with tableWrap: on narrow screens the table
// scrolls horizontally instead of squeezing/wrapping columns unreadably.
export const tableWrap = "-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0";
export const table = "w-full min-w-max text-sm sm:min-w-0";
export const th = "whitespace-nowrap border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
export const td = "whitespace-nowrap border-b border-slate-100 px-2 py-2";

export const badgeBase = "inline-block w-fit rounded-full px-2 py-1 text-xs font-medium";
