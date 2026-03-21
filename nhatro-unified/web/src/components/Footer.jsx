
// src/components/Footer.jsx
import React from 'react';

export default function Footer() {
  return (
    <footer className="mt-6 border-t bg-white">
      <div className="container mx-auto max-w-5xl px-4 py-3 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <div>© {new Date().getFullYear()} Quản lý trọ — Phòng • Điện/Nước • Thu tiền</div>
        <div>
          <span className="mr-3">Mẹo: Gõ để lọc phòng/khách • Chọn tháng để đổi kỳ</span>
        </div>
      </div>
       <div className="rounded-xl border bg-white p-4 text-xs text-slate-500">
              <div className="mb-2 font-semibold">Gợi ý</div>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Tab <b>THU TIỀN</b>: xem card từng phòng, tạo hóa đơn, mở VietQR, đánh dấu thanh toán.</li>
                <li>Tab <b>PHÒNG TRỌ</b>: thêm/sửa/xóa phòng; thêm/sửa/xóa khách; xem <i>danh sách khách của một phòng</i> và <i>danh sách khách tổng</i>.</li>
                <li>Tab <b>GHI ĐIỆN, NƯỚC</b>: nhập chỉ số theo tháng, sau đó quay lại tab THU TIỀN để tạo hóa đơn.</li>
              </ol>
            </div>
    </footer>
  );
}
