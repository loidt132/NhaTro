import { useState } from "react";
import dayjs from "dayjs";
import { homestayApi } from "../api.js";
import DateField from "../components/DateField.jsx";
import { exportStyledExcel } from "../utils/exportExcel.js";
import { btn, btnPrimary, card } from "../ui.js";

export default function GuestReport() {
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [error, setError] = useState("");

  async function downloadExcel() {
    setError("");
    try {
      const data = await homestayApi.getGuestReport(date);
      const fmt = (v) => (v ? dayjs(v).format("DD/MM/YYYY HH:mm") : "");
      await exportStyledExcel({
        filename: `bao-cao-luu-tru-${date}.xlsx`,
        sheetName: "Lưu trú",
        title: "Báo cáo lưu trú",
        subtitle: `Ngày nhận phòng: ${dayjs(date).format("DD/MM/YYYY")}`,
        columns: [
          { header: "Phòng", key: "room", width: 10 },
          { header: "Họ tên", key: "name", width: 26 },
          { header: "CCCD", key: "idNumber", width: 16 },
          { header: "Ngày sinh", key: "dob", width: 12 },
          { header: "Điện thoại", key: "phone", width: 14 },
          { header: "Nhận phòng", key: "checkInAt", width: 18 },
          { header: "Trả phòng", key: "checkOutAt", width: 18 },
        ],
        rows: data.map((r) => ({
          room: r.room,
          name: r.name,
          idNumber: r.idNumber,
          dob: r.dob,
          phone: r.phone,
          checkInAt: fmt(r.checkInAt),
          checkOutAt: fmt(r.checkOutAt),
        })),
      });
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
