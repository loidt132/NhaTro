import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { homestayApi, formatVnd } from "../api.js";
import { card, input, label } from "../ui.js";
import { useHomestay } from "../HomestayContext.js";
import DateField from "../components/DateField.jsx";

const STATUS_TABS = [
  { key: "checked_out", label: "Đã trả phòng" },
  { key: "active", label: "Chưa trả" },
  { key: "cancelled", label: "Đã huỷ" },
];

const PRICING_LABEL = { hourly: "Theo giờ", overnight: "Qua đêm", fullday: "Cả ngày" };

export default function StayHistory() {
  const { currentHomestayId } = useHomestay();
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [status, setStatus] = useState("checked_out");
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().endOf("month").format("YYYY-MM-DD"));
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    homestayApi.getRooms().then(setRooms).catch((err) => setError(err.message));
  }, [currentHomestayId]);

  useEffect(() => {
    setRows(null);
    homestayApi
      .getStayHistory(roomId, status, from, to)
      .then(setRows)
      .catch((err) => setError(err.message));
  }, [roomId, status, from, to, currentHomestayId]);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Lịch sử &amp; hoá đơn</h1>
      <div className="flex gap-1.5 overflow-x-auto">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium ${
              status === t.key ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <div className="col-span-2 space-y-1 sm:w-44">
          <label className={label}>Phòng</label>
          <select className={input} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Tất cả phòng</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <DateField label="Từ ngày" value={from} onChange={setFrom} />
        <DateField label="Đến ngày" value={to} onChange={setTo} />
        {(from || to) && (
          <button
            type="button"
            className="col-span-2 h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 sm:col-span-1"
            onClick={() => { setFrom(""); setTo(""); }}
          >
            Xoá lọc ngày
          </button>
        )}
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      <div className={`${card} !p-3 sm:!p-4`}>
        {rows === null ? (
          <p className="text-sm text-slate-500">Đang tải...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">Không có lượt nào.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((r) => (
              <Link key={r.stayId} to={`/stays/${r.stayId}`} className="block py-2.5 text-sm hover:bg-slate-50">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">Phòng {r.roomName} · {(r.guestNames?.length ? r.guestNames : [r.guestName]).join(", ")}</span>
                  {r.status === "cancelled" ? (
                    <span className="shrink-0 text-xs font-medium text-slate-500">Đã huỷ</span>
                  ) : (
                    <span className="shrink-0 font-semibold tabular-nums text-emerald-700">
                      {formatVnd(r.total)}{r.status === "active" ? " (tạm tính)" : ""}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {dayjs(r.checkInAt).format("DD/MM HH:mm")} → {r.checkOutAt ? dayjs(r.checkOutAt).format("DD/MM HH:mm") : "đang ở"} · {PRICING_LABEL[r.pricingType]}
                  </span>
                  <span className="shrink-0 text-emerald-700">{r.status === "checked_out" ? "Xem hoá đơn / QR ›" : "Xem ›"}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
