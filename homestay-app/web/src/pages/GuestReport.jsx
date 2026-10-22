import { useState } from "react";
import dayjs from "dayjs";
import { homestayApi } from "../api.js";
import DateField from "../components/DateField.jsx";
import { exportExcel } from "../utils/exportExcel.js";
import { btn, btnPrimary, card } from "../ui.js";

export default function GuestReport() {
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [error, setError] = useState("");

  async function downloadExcel() {
    setError("");
    try {
      const data = await homestayApi.getGuestReport(date);
      const fmt = (v) => (v ? dayjs(v).format("DD/MM/YYYY HH:mm") : "");
      await exportExcel(
        `bao-cao-luu-tru-${date}.xlsx`,
        "Lưu trú",
        [
          ["Phòng", "Họ tên", "CCCD", "Ngày sinh", "Điện thoại", "Nhận phòng", "Trả phòng"],
          ...data.map((r) => [r.room, r.name, r.idNumber, r.dob, r.phone, fmt(r.checkInAt), fmt(r.checkOutAt)]),
        ],
        [10, 26, 16, 12, 14, 18, 18]
      );
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Báo cáo lưu trú (xuất thủ công)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Giai đoạn 1: chưa gọi API cổng dịch vụ công / công an. Xuất file CSV theo ngày nhận phòng để nhân viên tự
          nhập vào hệ thống đăng ký lưu trú.
        </p>
      </div>
      <div className={card}>
        <div className="flex flex-wrap items-end gap-3">
          <DateField label="Ngày nhận phòng" value={date} onChange={setDate} />
          <a className={btnPrimary} href={homestayApi.guestReportUrl(date)}>Tải CSV</a>
          <button className={btn} onClick={downloadExcel}>Tải Excel</button>
        </div>
        {error && <div className="mt-3 text-sm text-rose-700">{error}</div>}
      </div>
    </div>
  );
}
