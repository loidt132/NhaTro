
// src/components/Footer.jsx
import React from 'react';

export default function Footer() {
  return (
    <footer className="mt-6 border-t border-slate-200 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="container mx-auto flex max-w-5xl flex-col gap-2 px-3 py-3 text-xs text-slate-500 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
        <div className="min-w-0 leading-snug">© {new Date().getFullYear()} Quản lý trọ</div>
        <div className="hidden text-slate-500 sm:block">
          <span>Mẹo: Gõ để lọc • Chọn tháng để đổi kỳ</span>
        </div>
      </div>
      <div className="mx-auto max-w-5xl rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-3 text-xs leading-relaxed text-slate-500 sm:px-4 sm:py-4">
        <div className="mb-2 font-semibold text-slate-600">Gợi ý</div>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Tab <b>THU TIỀN</b>: xem card từng phòng, tạo hóa đơn, mở VietQR, đánh dấu thanh toán.</li>
          <li>Tab <b>PHÒNG TRỌ</b>: thêm/sửa/xóa phòng; thêm/sửa/xóa khách; xem <i>danh sách khách của một phòng</i> và <i>danh sách khách tổng</i>.</li>
          <li>Tab <b>GHI ĐIỆN, NƯỚC</b>: nhập chỉ số theo tháng, sau đó quay lại tab THU TIỀN để tạo hóa đơn.</li>
        </ol>
      </div>
    </footer>
  );
}
