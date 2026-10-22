import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { homestayApi, formatVnd } from "../api.js";
import { badgeBase, card, input, label, table, tableWrap, td, th } from "../ui.js";
import { useHomestay } from "../HomestayContext.js";

const PRICING_LABEL = { hourly: "Theo giờ", overnight: "Qua đêm", fullday: "Cả ngày" };

export default function ReportsHub() {
  const [tab, setTab] = useState("revenue");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Báo cáo</h1>
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-0">
        <TabButton active={tab === "revenue"} onClick={() => setTab("revenue")}>Doanh thu</TabButton>
        <TabButton active={tab === "occupancy"} onClick={() => setTab("occupancy")}>Khách ở</TabButton>
      </div>
      {tab === "revenue" ? <RevenueReport /> : <OccupancyReport />}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active ? "border-emerald-600 text-emerald-600" : "border-transparent text-slate-600 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function DateRangePicker({ from, to, setFrom, setTo }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
      <div className="min-w-0 space-y-1">
        <label className={label}>Từ ngày</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} block w-full min-w-0 max-w-full !px-2 !py-1.5 !text-[13px] sm:w-44 sm:!px-3 sm:!py-2 sm:!text-sm`} />
      </div>
      <div className="min-w-0 space-y-1">
        <label className={label}>Đến ngày</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} block w-full min-w-0 max-w-full !px-2 !py-1.5 !text-[13px] sm:w-44 sm:!px-3 sm:!py-2 sm:!text-sm`} />
      </div>
    </div>
  );
}

function RevenueReport() {
  const { currentHomestayId } = useHomestay();
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().format("YYYY-MM-DD"));
  const [data, setData] = useState({ rows: [], grandTotal: { roomRevenue: 0, serviceRevenue: 0, total: 0, stayCount: 0 } });
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setData(await homestayApi.getRevenueReport(from, to));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, currentHomestayId]);

  return (
    <div className="space-y-4">
      <div className={card}>
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard label="Lượt trả phòng" value={data.grandTotal.stayCount} />
        <StatCard label="Doanh thu phòng" value={formatVnd(data.grandTotal.roomRevenue)} />
        <StatCard label="Doanh thu dịch vụ/phụ thu" value={formatVnd(data.grandTotal.serviceRevenue)} />
        <StatCard label="Tổng doanh thu" value={formatVnd(data.grandTotal.total)} highlight />
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold text-slate-900">Doanh thu theo ngày</h2>
        <p className="mb-2 text-xs text-slate-500">Tính theo ngày trả phòng (checkout) của các lượt lưu trú đã hoàn tất.</p>
        {data.rows.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có dữ liệu trong khoảng ngày đã chọn.</p>
        ) : (
          <>
          <div className="divide-y divide-slate-100 sm:hidden">
            {data.rows.map((r) => (
              <div key={r.date} className="space-y-1 py-2.5 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-slate-900">{dayjs(r.date).format("DD/MM/YYYY")}</span>
                  <span className="font-semibold tabular-nums text-emerald-700">{formatVnd(r.total)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{r.stayCount} lượt trả</span>
                  <span className="tabular-nums">Phòng {formatVnd(r.roomRevenue)} · DV {formatVnd(r.serviceRevenue)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className={`${tableWrap} hidden sm:block`}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Ngày</th>
                  <th className={th}>Lượt trả phòng</th>
                  <th className={`${th} text-right`}>Doanh thu phòng</th>
                  <th className={`${th} text-right`}>Dịch vụ/phụ thu</th>
                  <th className={`${th} text-right`}>Tổng</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.date}>
                    <td className={td}>{dayjs(r.date).format("DD/MM/YYYY")}</td>
                    <td className={td}>{r.stayCount}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatVnd(r.roomRevenue)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatVnd(r.serviceRevenue)}</td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{formatVnd(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function OccupancyReport() {
  const { currentHomestayId } = useHomestay();
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().format("YYYY-MM-DD"));
  const [data, setData] = useState({ totalRooms: 0, currentOccupied: 0, currentCleaning: 0, currentEmpty: 0, occupancyRate: 0, stays: [] });
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setData(await homestayApi.getOccupancyReport(from, to));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, currentHomestayId]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard label="Tổng số phòng" value={data.totalRooms} />
        <StatCard label="Đang ở" value={data.currentOccupied} />
        <StatCard label="Tỷ lệ lấp đầy hiện tại" value={`${data.occupancyRate}%`} highlight />
        <StatCard label="Trống / Cần dọn" value={`${data.currentEmpty} / ${data.currentCleaning}`} />
      </div>

      <div className={card}>
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className={card}>
        <h2 className="mb-2 font-semibold text-slate-900">Danh sách khách lưu trú</h2>
        <p className="mb-2 text-xs text-slate-500">Lọc theo ngày nhận phòng.</p>
        {data.stays.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có dữ liệu trong khoảng ngày đã chọn.</p>
        ) : (
          <>
          <div className="divide-y divide-slate-100 sm:hidden">
            {data.stays.map((s) => (
              <div key={s.stayId} className="space-y-1 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{s.roomName} · {s.guestName}</span>
                  <span className={`${badgeBase} shrink-0 ${s.status === "active" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {s.status === "active" ? "Đang ở" : "Đã trả"}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {dayjs(s.checkInAt).format("DD/MM HH:mm")} → {s.checkOutAt ? dayjs(s.checkOutAt).format("DD/MM HH:mm") : "—"} · {s.durationHours}h
                </div>
                <div className="text-xs text-slate-500">
                  {PRICING_LABEL[s.pricingType]} · {s.guestCount} khách
                </div>
              </div>
            ))}
          </div>
          <div className={`${tableWrap} hidden sm:block`}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Phòng</th>
                  <th className={th}>Khách chính</th>
                  <th className={th}>Số khách</th>
                  <th className={th}>Loại giá</th>
                  <th className={th}>Nhận phòng</th>
                  <th className={th}>Trả phòng</th>
                  <th className={th}>Số giờ</th>
                  <th className={th}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {data.stays.map((s) => (
                  <tr key={s.stayId}>
                    <td className={td}>{s.roomName}</td>
                    <td className={td}>{s.guestName}</td>
                    <td className={td}>{s.guestCount}</td>
                    <td className={td}>{PRICING_LABEL[s.pricingType]}</td>
                    <td className={td}>{dayjs(s.checkInAt).format("DD/MM HH:mm")}</td>
                    <td className={td}>{s.checkOutAt ? dayjs(s.checkOutAt).format("DD/MM HH:mm") : "—"}</td>
                    <td className={td}>{s.durationHours}h</td>
                    <td className={td}>
                      <span className={`${badgeBase} ${s.status === "active" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {s.status === "active" ? "Đang ở" : "Đã trả phòng"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label: statLabel, value, highlight }) {
  return (
    <div className={`${card} !rounded-xl !p-2.5 sm:!rounded-2xl sm:!p-4 ${highlight ? "border-emerald-300 bg-emerald-50/60" : ""}`}>
      <div className="text-[10px] leading-tight text-slate-500 sm:text-xs">{statLabel}</div>
      <div className={`mt-0.5 text-sm font-bold sm:mt-1 sm:text-xl ${highlight ? "text-emerald-700" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
