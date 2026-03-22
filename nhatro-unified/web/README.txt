
NHÀ TRỌ – GÓI HỢP NHẤT (WEB)

Chức năng:
- 4 trang chính: Phòng trọ / Ghi điện nước / Thu tiền / Cài đặt
- Báo cáo: Tổng số phòng, Tổng số khách, Tiền đã đóng (tháng/năm), Công nợ (tháng/năm)
- In hóa đơn PDF (Print → Save as PDF)
- QR thanh toán VietQR (ảnh từ img.vietqr.io)
- Lưu dữ liệu localStorage (key: boarding_state_v1)
# NhaTro – Xuất hóa đơn PDF bằng jsPDF (có VietQR)

Gói mã nguồn này chứa các hàm tiện ích để xuất **Hóa đơn PDF** (tiếng Việt đầy đủ dấu) và chèn **VietQR** từ màn Thu tiền.

## Cài đặt thư viện

```bash
npm i jspdf jspdf-autotable
```

## Thêm font Unicode (bắt buộc)
1) Tải TTF và đặt vào `public/fonts/`:
   - `NotoSans-Regular.ttf`
   - `NotoSans-Bold.ttf`
2) Bạn có thể dùng Noto Sans từ Google Fonts.

## File chính
- `src/utils/pdf/fontLoader.ts` – Nạp font TTF vào jsPDF (Unicode Tiếng Việt)
- `src/utils/pdf/vietqr.ts` – Tạo dataURL ảnh VietQR từ `img.vietqr.io` + helpers
- `src/utils/pdf/exportInvoiceJspdf.ts` – Hàm `exportInvoicePdfByJsPDF(...)`

## Cách dùng (ví dụ)
Xem `src/pages/payments/exportInvoiceExample.ts`.

## Ghi chú
- Nếu QR không tải được (mạng/CORS), file PDF vẫn sinh ra và có link fallback.
- Bạn có thể thay `NotoSans` bằng bất kỳ font TTF có hỗ trợ tiếng Việt.

Chạy:
1) cd web
2) npm install
npm i jspdf jspdf-autotable
3) npm run dev

---

npm run clean
npm run build
npm run preview


Yêu cầu:
- Node >= 18
- Tailwind v4 (@import "tailwindcss")
- postcss.config.js sử dụng @tailwindcss/postcss
--- Build web ----

npm install       # nếu chưa cài
npm run build
npx serve dist
Copy toàn bộ nội dung dist vào: thư mục IIS

--- Build exe---npm start
Build .exe
mkdir electron
cd electron
npm init -y
npm install electron electron-builder --save-dev

------ Tạo file main.js
const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Load React build
  win.loadFile(path.join(__dirname, "../web/dist/index.html"));

  // ❌ Không mở DevTools cho production
  // win.webContents.openDevTools()
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});


--- electron/package.json


--- commit code ----
git add .
git commit -m "add report"
git push
