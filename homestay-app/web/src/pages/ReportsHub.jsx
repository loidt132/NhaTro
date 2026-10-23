import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { homestayApi, formatVnd } from "../api.js";
import { exportStyledExcel } from "../utils/exportExcel.js";
import { badgeBase, btn, btnPrimary, card, table, tableWrap, td, th } from "../ui.js";
import DateField from "../components/DateField.jsx";
import { useHomestay } from "../HomestayContext.js";

const PRICING_LABEL = { hourly: "Theo giờ", overnight: "Qua đêm", fullday: "Cả ngày" };

export default function ReportsHub() {
  const [tab, setTab] = useState("revenue");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Báo cáo</h1>
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-0">
        <TabButton active={tab === "revenue"} onClick={() => setTab("revenue")}>Doanh thu</TabButton>
        <TabButton active={tab === "services"} onClick={() => setTab("services")}>Dịch vụ</TabButton>
        <TabButton active={tab === "occupancy"} onClick={() => setTab("occupancy")}>Khách ở</TabButton>
      </div>
      {tab === "revenue" && <RevenueReport />}
      {tab === "services" && <ServiceRevenueReport />}
      {tab === "occupancy" && <OccupancyReport />}
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
    <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3 sm:flex-wrap sm:items-end">
      <DateField label="Từ ngày" value={from} onChange={setFrom} />
      <DateField label="Đến ngày" value={to} onChange={setTo} />
    </div>
  );
}

// PDF = the browser's print dialog ("Save as PDF") on just the report area
// (.invoice-print), so Vietnamese text needs no embedded font.
function ExportButtons({ onExcel, disabled }) {
  return (
    <div className="no-print flex gap-2">
      <button className={btnPrimary} onClick={onExcel} disabled={disabled}>Xuất Excel</button>
      <button className={btn} onClick={() => window.print()} disabled={disabled}>Xuất PDF</button>
    </div>
  );
}

function RevenueReport() {
  const { currentHomestayId } = useHomestay();
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().format("YYYY-MM-DD"));
  const [data, setData] = useState({ rows: [], grandTotal: { roomRevenue: 0, serviceRevenue: 0, total: 0, stayCount: 0 }, serviceBreakdown: [] });
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

  function download() {
    exportStyledExcel({
      filename: `doanh-thu-${from}-${to}.xlsx`,
      sheetName: "Doanh thu",
      title: "Báo cáo doanh thu",
      subtitle: `${dayjs(from).format("DD/MM/YYYY")} – ${dayjs(to).format("DD/MM/YYYY")}`,
      columns: [
        { header: "Ngày", key: "date", width: 14 },
        { header: "Lượt trả phòng", key: "stayCount", width: 16 },
        { header: "Doanh thu phòng", key: "roomRevenue", width: 18, money: true },
        { header: "Dịch vụ/phụ thu", key: "serviceRevenue", width: 18, money: true },
        { header: "Tổng", key: "total", width: 16, money: true },
      ],
      rows: data.rows.map((r) => ({
        date: dayjs(r.date).format("DD/MM/YYYY"),
        stayCount: r.stayCount,
        roomRevenue: r.roomRevenue,
        serviceRevenue: r.serviceRevenue,
        total: r.total,
      })),
      totals: { date: "Tổng cộng", stayCount: data.grandTotal.stayCount, roomRevenue: data.grandTotal.roomRevenue, serviceRevenue: data.grandTotal.serviceRevenue, total: data.grandTotal.total },
    });
  }

  return (
    <div className="invoice-print space-y-4">
      <h2 className="hidden text-lg font-bold print:block">Báo cáo doanh thu {dayjs(from).format("DD/MM/YYYY")} – {dayjs(to).format("DD/MM/YYYY")}</h2>
      <div className="no-print space-y-3 sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:p-4 sm:shadow-sm">
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
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Doanh thu theo ngày</h2>
          <ExportButtons onExcel={download} disabled={data.rows.length === 0} />
        </div>
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

  function download() {
    const fmt = (v) => (v ? dayjs(v).format("DD/MM/YYYY HH:mm") : "");
    exportStyledExcel({
      filename: `khach-luu-tru-${from}-${to}.xlsx`,
      sheetName: "Khách lưu trú",
      title: "Báo cáo khách lưu trú",
      subtitle: `${dayjs(from).format("DD/MM/YYYY")} – ${dayjs(to).format("DD/MM/YYYY")}`,
      columns: [
        { header: "Phòng", key: "roomName", width: 10 },
        { header: "Khách", key: "guestName", width: 36 },
        { header: "Số khách", key: "guestCount", width: 10 },
        { header: "Loại giá", key: "pricingType", width: 12 },
        { header: "Nhận phòng", key: "checkInAt", width: 18 },
        { header: "Trả phòng", key: "checkOutAt", width: 18 },
        { header: "Số giờ", key: "durationHours", width: 8 },
        { header: "Trạng thái", key: "status", width: 14 },
      ],
      rows: data.stays.map((s) => ({
        roomName: s.roomName,
        guestName: (s.guestNames?.length ? s.guestNames : [s.guestName]).join(", "),
        guestCount: s.guestCount,
        pricingType: PRICING_LABEL[s.pricingType] || s.pricingType,
        checkInAt: fmt(s.checkInAt),
        checkOutAt: fmt(s.checkOutAt),
        durationHours: s.durationHours,
        status: s.status === "active" ? "Đang ở" : "Đã trả phòng",
      })),
    });
  }

  return (
    <div className="invoice-print space-y-4">
      <h2 className="hidden text-lg font-bold print:block">Báo cáo khách ở {dayjs(from).format("DD/MM/YYYY")} – {dayjs(to).format("DD/MM/YYYY")}</h2>
      <div className="no-print space-y-3 sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:p-4 sm:shadow-sm">
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard label="Tổng số phòng" value={data.totalRooms} />
        <StatCard label="Đang ở" value={data.currentOccupied} />
        <StatCard label="Tỷ lệ lấp đầy hiện tại" value={`${data.occupancyRate}%`} highlight />
        <StatCard label="Trống / Cần dọn" value={`${data.currentEmpty} / ${data.currentCleaning}`} />
      </div>

      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Danh sách khách lưu trú</h2>
          <ExportButtons onExcel={download} disabled={data.stays.length === 0} />
        </div>
        <p className="mb-2 text-xs text-slate-500">Lọc theo ngày nhận phòng.</p>
        {data.stays.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có dữ liệu trong khoảng ngày đã chọn.</p>
        ) : (
          <>
          <div className="divide-y divide-slate-100 sm:hidden">
            {data.stays.map((s) => (
              <div key={s.stayId} className="space-y-1 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {s.roomName} · {(s.guestNames?.length ? s.guestNames : [s.guestName]).map((n) => <span key={n} className="block">{n}</span>)}
                  </span>
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
                  <th className={th}>Khách</th>
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
                    <td className={`${td} !whitespace-normal`}>{(s.guestNames?.length ? s.guestNames : [s.guestName]).map((n) => <div key={n}>{n}</div>)}</td>
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

const KIND_LABEL = { service: "Dịch vụ", surcharge: "Phụ thu" };

function ServiceRevenueReport() {
  const { currentHomestayId } = useHomestay();
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().format("YYYY-MM-DD"));
  const [data, setData] = useState({ serviceBreakdown: [], grandTotal: { serviceRevenue: 0 } });
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

  const rows = data.serviceBreakdown || [];
  const total = data.grandTotal?.serviceRevenue || 0;

  function download() {
    exportStyledExcel({
      filename: `doanh-thu-dich-vu-${from}-${to}.xlsx`,
      sheetName: "Doanh thu dịch vụ",
      title: "Báo cáo doanh thu theo dịch vụ",
      subtitle: `${dayjs(from).format("DD/MM/YYYY")} – ${dayjs(to).format("DD/MM/YYYY")}`,
      columns: [
        { header: "Tên dịch vụ/phụ thu", key: "name", width: 30 },
        { header: "Loại", key: "kind", width: 12 },
        { header: "Số lượt", key: "orderCount", width: 10 },
        { header: "Số lượng", key: "qty", width: 10 },
        { header: "Doanh thu", key: "amount", width: 18, money: true },
      ],
      rows: rows.map((r) => ({
        name: r.name,
        kind: KIND_LABEL[r.kind] || r.kind,
        orderCount: r.orderCount,
        qty: r.qty,
        amount: r.amount,
      })),
      totals: { name: "Tổng cộng", amount: total },
    });
  }

  return (
    <div className="invoice-print space-y-4">
      <h2 className="hidden text-lg font-bold print:block">Báo cáo doanh thu dịch vụ {dayjs(from).format("DD/MM/YYYY")} – {dayjs(to).format("DD/MM/YYYY")}</h2>
      <div className="no-print space-y-3 sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:p-4 sm:shadow-sm">
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <StatCard label="Số loại dịch vụ/phụ thu" value={rows.length} />
        <StatCard label="Tổng lượt đặt" value={rows.reduce((s, r) => s + r.orderCount, 0)} />
        <StatCard label="Tổng doanh thu dịch vụ" value={formatVnd(total)} highlight />
      </div>

      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Doanh thu theo từng loại dịch vụ</h2>
          <ExportButtons onExcel={download} disabled={rows.length === 0} />
        </div>
        <p className="mb-2 text-xs text-slate-500">Tính theo ngày trả phòng (checkout) của các lượt lưu trú đã hoàn tất, giống báo cáo doanh thu.</p>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có dữ liệu trong khoảng ngày đã chọn.</p>
        ) : (
          <>
          <div className="divide-y divide-slate-100 sm:hidden">
            {rows.map((r) => (
              <div key={`${r.kind}:${r.name}`} className="space-y-1 py-2.5 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="font-semibold tabular-nums text-emerald-700">{formatVnd(r.amount)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{KIND_LABEL[r.kind] || r.kind} · {r.orderCount} lượt</span>
                  <span className="tabular-nums">SL {r.qty}</span>
                </div>
              </div>
            ))}
          </div>
          <div className={`${tableWrap} hidden sm:block`}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Tên dịch vụ/phụ thu</th>
                  <th className={th}>Loại</th>
                  <th className={`${th} text-right`}>Số lượt</th>
                  <th className={`${th} text-right`}>Số lượng</th>
                  <th className={`${th} text-right`}>Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}:${r.name}`}>
                    <td className={td}>{r.name}</td>
                    <td className={td}>
                      <span className={`${badgeBase} ${r.kind === "surcharge" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {KIND_LABEL[r.kind] || r.kind}
                      </span>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{r.orderCount}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.qty}</td>
                    <td className={`${td} text-right tabular-nums font-semibold`}>{formatVnd(r.amount)}</td>
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
