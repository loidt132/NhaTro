import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { homestayApi, formatVnd } from "../api.js";
import { card, input, label } from "../ui.js";
import { useHomestay } from "../HomestayContext.js";

const PRICING_LABEL = { hourly: "Theo giờ", overnight: "Qua đêm", fullday: "Cả ngày" };

export default function StayHistory() {
  const { currentHomestayId } = useHomestay();
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    homestayApi.getRooms().then(setRooms).catch((err) => setError(err.message));
  }, [currentHomestayId]);

  useEffect(() => {
    setRows(null);
    homestayApi
      .getStayHistory(roomId)
      .then(setRows)
      .catch((err) => setError(err.message));
  }, [roomId, currentHomestayId]);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Lịch sử &amp; hoá đơn</h1>
      <div className="max-w-xs space-y-1">
        <label className={label}>Phòng</label>
        <select className={input} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Tất cả phòng</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      <div className={`${card} !p-3 sm:!p-4`}>
        {rows === null ? (
          <p className="text-sm text-slate-500">Đang tải...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có lượt trả phòng nào.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((r) => (
              <Link key={r.stayId} to={`/stays/${r.stayId}`} className="block py-2.5 text-sm hover:bg-slate-50">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">Phòng {r.roomName} · {r.guestName}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-emerald-700">{formatVnd(r.total)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {dayjs(r.checkInAt).format("DD/MM HH:mm")} → {dayjs(r.checkOutAt).format("DD/MM HH:mm")} · {PRICING_LABEL[r.pricingType]}
                  </span>
                  <span className="shrink-0 text-emerald-700">Xem hoá đơn / QR ›</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
