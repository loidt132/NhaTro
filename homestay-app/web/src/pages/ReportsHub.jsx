import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { homestayApi, formatVnd } from "../api.js";
import { badgeBase, card, input, label, table, tableWrap, td, th } from "../ui.js";

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
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label className={label}>Từ ngày</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} w-44`} />
      </div>
      <div className="space-y-1">
        <label className={label}>Đến ngày</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} w-44`} />
      </div>
    </div>
  );
}

function RevenueReport() {
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
  }, [from, to]);

  return (
    <div className="space-y-4">
      <div className={card}>
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <div className={tableWrap}>
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
        )}
      </div>
    </div>
  );
}

function OccupancyReport() {
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
  }, [from, to]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <div className={tableWrap}>
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
        )}
      </div>
    </div>
  );
}

function StatCard({ label: statLabel, value, highlight }) {
  return (
    <div className={`${card} ${highlight ? "border-emerald-300 bg-emerald-50/60" : ""}`}>
      <div className="text-xs text-slate-500">{statLabel}</div>
      <div className={`mt-1 text-xl font-bold ${highlight ? "text-emerald-700" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
