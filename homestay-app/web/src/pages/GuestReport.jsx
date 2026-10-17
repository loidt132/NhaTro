import { useState } from "react";
import dayjs from "dayjs";
import { homestayApi } from "../api.js";
import { btnPrimary, card, input, label } from "../ui.js";

export default function GuestReport() {
  const [date, setDate] = useState(dayjs().format("YYYY-MM-DD"));

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
          <div className="space-y-1">
            <label className={label}>Ngày nhận phòng</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${input} w-44`} />
          </div>
          <a className={btnPrimary} href={homestayApi.guestReportUrl(date)}>Tải CSV</a>
        </div>
      </div>
    </div>
  );
}
