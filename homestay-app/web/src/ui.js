// Shared Tailwind class strings, kept in sync with nhatro-unified's palette
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

const ROOM_STATUS = {
  empty: { label: "Trống", badge: "bg-emerald-100 text-emerald-700", border: "border-l-4 border-l-emerald-500" },
  occupied: { label: "Đang ở", badge: "bg-sky-100 text-sky-700", border: "border-l-4 border-l-sky-500 bg-sky-50/50" },
  cleaning: { label: "Cần dọn", badge: "bg-amber-100 text-amber-700", border: "border-l-4 border-l-amber-500 bg-amber-50/50" },
  inactive: { label: "Ngừng sử dụng", badge: "bg-slate-200 text-slate-600", border: "border-l-4 border-l-slate-300 bg-slate-50 opacity-70" },
};

// A deactivated room (active: false) shows as "inactive" — unless a guest
// is still in it (status "occupied"), since that stay must stay visible
// and reachable for checkout regardless of the room's active flag.
export function roomStatus(room) {
  if (typeof room === "string") return ROOM_STATUS[room] || ROOM_STATUS.empty;
  if (room && room.active === false && room.status !== "occupied") return ROOM_STATUS.inactive;
  return ROOM_STATUS[room?.status] || ROOM_STATUS.empty;
}

export const badgeBase = "inline-block w-fit rounded-full px-2 py-1 text-xs font-medium";
