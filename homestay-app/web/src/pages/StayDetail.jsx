import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { homestayApi, catalogApi, formatVnd } from "../api.js";
import { badgeBase, btn, btnDanger, btnPrimary, card, input, label, table, tableWrap, td, th } from "../ui.js";
import { fetchVietQrPngDataUrl, fillAddInfoTemplate } from "../utils/vietqr.js";

const PRICING_LABEL = {
  hourly: "Theo giờ",
  overnight: "Qua đêm",
  fullday: "Cả ngày",
};

export default function StayDetail() {
  const { stayId } = useParams();
  const navigate = useNavigate();
  const [stay, setStay] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [surchargeRules, setSurchargeRules] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invoice, setInvoice] = useState(null);

  function showNotice(message) {
    setNotice(message);
    setTimeout(() => setNotice(""), 4000);
  }
  const [settings, setSettings] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState("");

  // The catalog is a secondary service: if it times out or is down, log it to
  // the console and keep showing the last-loaded catalog instead of an error.
  const quietCatalog = (promise) =>
    promise.catch((err) => {
      console.error("[catalog]", err);
      return null;
    });

  async function refresh() {
    try {
      const [stayData, roomsData, items, rules, settingsData] = await Promise.all([
        homestayApi.getStay(stayId),
        homestayApi.getRooms(),
        quietCatalog(catalogApi.getItems("service")),
        quietCatalog(catalogApi.getItems("surcharge")),
        homestayApi.getSettings(),
      ]);
      setStay(stayData);
      setRooms(roomsData);
      if (items) setCatalogItems(items);
      if (rules) setSurchargeRules(rules);
      setSettings(settingsData);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayId]);

  if (!stay) {
    return <div className="text-sm text-slate-500">{error || "Đang tải..."}</div>;
  }

  // Items carry their category (categoryId + categoryName), so group them
  // here instead of fetching /categories separately. Groups keep the order in
  // which each category first appears in the item list.
  const catalogGroups = [];
  for (const item of catalogItems) {
    if (!item.categoryId) continue;
    let group = catalogGroups.find((g) => g.id === item.categoryId);
    if (!group) {
      group = { id: item.categoryId, name: item.categoryName || item.categoryId, items: [] };
      catalogGroups.push(group);
    }
    group.items.push(item);
  }

  const emptyRooms = rooms.filter((r) => r.status === "empty");
  const room = rooms.find((r) => r.id === stay.roomId);

  async function addService(itemId, qty) {
    setError("");
    try {
      await homestayApi.addService(stayId, { itemId, qty });
      await refresh();
      showNotice("Đã thêm dịch vụ — tạm tính đã cập nhật.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function addSurcharge(ruleId) {
    setError("");
    try {
      await homestayApi.addSurcharge(stayId, { surchargeRuleId: ruleId, qty: 1 });
      await refresh();
      showNotice("Đã thêm phụ thu — tạm tính đã cập nhật.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeCharge(chargeId) {
    setError("");
    try {
      await homestayApi.removeCharge(stayId, chargeId);
      await refresh();
      showNotice("Đã xoá mục — tạm tính đã cập nhật.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function transfer(toRoomId) {
    setError("");
    try {
      await homestayApi.transferRoom(stayId, { toRoomId, reason: "Đổi phòng theo yêu cầu" });
      await refresh();
      showNotice("Đã đổi phòng thành công.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function simulateSwipe(type) {
    setError("");
    try {
      await homestayApi.simulateSwipe(stayId, { type });
      await refresh();
      showNotice(
        type === "checkin-swipe"
          ? "Đã ghi nhận khách quẹt thẻ vào."
          : "Đã ghi nhận khách quẹt thẻ ra."
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function doCheckout() {
    setError("");
    try {
      const result = await homestayApi.checkout(stayId);
      setInvoice(result);
      await refresh();
      showNotice("Trả phòng thành công — hoá đơn đã xuất ở dưới.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function genQr() {
    if (!settings?.bankCode || !settings?.accountNo) {
      setQrError("Chưa cấu hình ngân hàng — vào Cài đặt > Cài đặt thanh toán để thêm.");
      return;
    }
    setQrLoading(true);
    setQrError("");
    try {
      const addInfo = fillAddInfoTemplate(settings.qrNoteTemplate || "Thanh toan phong {room}", { room: room?.name });
      const dataUrl = await fetchVietQrPngDataUrl(
        settings.bankCode,
        settings.accountNo,
        Math.round(stay.breakdown.total),
        addInfo,
        settings.accountName
      );
      setQrDataUrl(dataUrl);
    } catch (err) {
      setQrError(err.message);
    } finally {
      setQrLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-block text-sm font-medium text-emerald-700 hover:underline">
        &larr; Quay lại sơ đồ phòng
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-slate-900">
          Phòng {room?.name} — {PRICING_LABEL[stay.pricingType]}
        </h1>
        <span className={`${badgeBase} ${stay.status === "active" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
          {stay.status === "active" ? "Đang lưu trú" : "Đã trả phòng"}
        </span>
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      <div className={card}>
        <h2 className="mb-2 font-semibold text-slate-900">Khách lưu trú</h2>
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Họ tên</th><th className={th}>CCCD</th><th className={th}>Điện thoại</th><th className={th}>Vai trò</th>
              </tr>
            </thead>
            <tbody>
              {stay.guests.map((g) => (
                <tr key={g.id}>
                  <td className={td}>{g.name}</td>
                  <td className={td}>{g.idNumber}</td>
                  <td className={td}>{g.phone}</td>
                  <td className={td}>{g.isMain ? "Khách chính" : "Khách đi cùng"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddGuestForm stayId={stayId} onAdded={refresh} />
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold text-slate-900">Tạm tính hiện tại</h2>
        <BreakdownTable
          breakdown={stay.breakdown}
          onRemoveCharge={stay.status === "active" ? removeCharge : null}
        />
      </div>

      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Mã QR thanh toán</h2>
          <button className={`${btn} !py-1.5 !text-xs`} onClick={genQr} disabled={qrLoading}>
            {qrLoading ? "Đang tạo..." : qrDataUrl ? "Tạo lại mã QR" : "Tạo mã QR"}
          </button>
        </div>
        {qrError && (
          <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{qrError}</div>
        )}
        {qrDataUrl ? (
          <div className="flex items-center gap-4">
            <img
              src={qrDataUrl}
              alt="Mã QR thanh toán"
              className="h-40 w-40 rounded-lg border border-slate-200"
              onError={() => {
                setQrDataUrl(null);
                setQrError("Không tải được ảnh QR từ img.vietqr.io — kiểm tra kết nối mạng/tiện ích chặn quảng cáo, hoặc Mã NH và số tài khoản trong Cài đặt.");
              }}
            />
            <div className="text-sm text-slate-600">
              <p>Số tiền: <strong className="text-slate-900">{formatVnd(stay.breakdown.total)}</strong></p>
              <p className="text-xs text-slate-500">Mã QR dựa trên tổng tiền hiện tại — bấm "Tạo lại mã QR" nếu phát sinh thêm dịch vụ/phụ thu sau khi đã trả phòng.</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Bấm "Tạo mã QR" để tạo mã chuyển khoản theo cấu hình ngân hàng ở trang Cài đặt.</p>
        )}
      </div>

      {stay.transfers.length > 0 && (
        <div className={card}>
          <h2 className="mb-1 font-semibold text-slate-900">Lịch sử đổi phòng (audit trail)</h2>
          <p className="mb-2 text-xs text-slate-500">Chỉ để đối soát/theo dõi — không ảnh hưởng tới cách tính tiền phòng ở trên.</p>
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Thời điểm</th><th className={th}>Từ phòng</th><th className={th}>Sang phòng</th><th className={th}>Lý do</th>
                </tr>
              </thead>
              <tbody>
                {stay.transfers.map((t) => (
                  <tr key={t.id}>
                    <td className={td}>{new Date(t.transferredAt).toLocaleString("vi-VN")}</td>
                    <td className={td}>{t.fromRoomName}</td>
                    <td className={td}>{t.toRoomName}</td>
                    <td className={td}>{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stay.status === "active" && (
        <>
          <div className={card}>
            <h2 className="mb-3 font-semibold text-slate-900">Thêm dịch vụ</h2>
            {catalogGroups.map((category) => {
              const items = category.items;
              return (
                <div key={category.id} className="mb-4 last:mb-0">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{category.name}</h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {items.map((item) => (
                      <div key={item.id} className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                        <strong className="text-sm text-slate-900">{item.name}</strong>
                        <span className="text-xs text-slate-500">{formatVnd(item.price)} / {item.unit}</span>
                        <button className={`${btn} mt-1 !py-1.5 !text-xs`} onClick={() => addService(item.id, 1)}>+ Thêm 1</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-slate-500">Danh mục &amp; giá dịch vụ được quản lý chung ở trang "Dịch vụ &amp; phụ thu".</p>
          </div>

          <div className={card}>
            <h2 className="mb-2 font-semibold text-slate-900">Phụ thu</h2>
            <div className="flex flex-wrap gap-2">
              {surchargeRules.map((rule) => (
                <button key={rule.id} className={`${btn} !py-1.5 !text-xs`} onClick={() => addSurcharge(rule.id)}>
                  + {rule.name} ({formatVnd(rule.price)})
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Danh mục &amp; giá dịch vụ/phụ thu được quản lý chung ở trang "Dịch vụ &amp; phụ thu".</p>
          </div>

          <div className={card}>
            <h2 className="mb-1 font-semibold text-slate-900">Đổi phòng</h2>
            <p className="mb-3 text-xs text-slate-500">
              Đổi phòng không tính lại giá — tiền phòng vẫn tính theo thời lượng lưu trú liên tục từ lúc nhận phòng, chỉ đổi khoá/vị trí vật lý.
            </p>
            {emptyRooms.length === 0 ? (
              <p className="text-sm text-slate-500">Không có phòng trống để chuyển.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {emptyRooms.map((r) => (
                  <button key={r.id} className={`${btn} !py-1.5 !text-xs`} onClick={() => transfer(r.id)}>
                    Chuyển sang {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={card}>
            <h2 className="mb-2 font-semibold text-slate-900">TTLock (mock)</h2>
            <p className="mb-2 text-xs text-slate-500">Mã thẻ hiện tại: {stay.lockCardId}</p>
            <div className="flex flex-wrap gap-2">
              <button className={`${btn} !py-1.5 !text-xs`} onClick={() => simulateSwipe("checkin-swipe")}>Giả lập khách quẹt thẻ vào</button>
              <button className={`${btn} !py-1.5 !text-xs`} onClick={() => simulateSwipe("checkout-swipe")}>Giả lập khách quẹt thẻ ra</button>
            </div>
          </div>

          <div className="flex justify-end">
            <button className={btnPrimary} onClick={doCheckout}>Trả phòng &amp; xuất hoá đơn</button>
          </div>
        </>
      )}

      {invoice && (
        <div className={card}>
          <h2 className="mb-2 font-semibold text-slate-900">Hoá đơn trả phòng</h2>
          <BreakdownTable breakdown={invoice.breakdown} />
        </div>
      )}
    </div>
  );
}

function BreakdownTable({ breakdown, onRemoveCharge }) {
  return (
    <div className={tableWrap}>
      <table className={table}>
        <thead>
          <tr>
            <th className={th}>Mục</th>
            <th className={`${th} text-right`}>Thành tiền</th>
            {onRemoveCharge && <th className={th}></th>}
          </tr>
        </thead>
        <tbody>
          {breakdown.roomLines.map((l, i) => (
            <tr key={`room-${i}`}>
              <td className={td}>{l.label}</td>
              <td className={`${td} text-right tabular-nums`}>{formatVnd(l.amount)}</td>
              {onRemoveCharge && <td className={td}></td>}
            </tr>
          ))}
          {breakdown.serviceLines.map((l, i) => (
            <tr key={l.id || `svc-${i}`}>
              <td className={td}>{l.label}</td>
              <td className={`${td} text-right tabular-nums`}>{formatVnd(l.amount)}</td>
              {onRemoveCharge && (
                <td className={td}>
                  <button className={btnDanger} onClick={() => onRemoveCharge(l.id)}>Xoá</button>
                </td>
              )}
            </tr>
          ))}
          <tr>
            <td className="px-2 py-2 pt-3 font-bold text-slate-900 border-t-2 border-slate-200">Tổng cộng</td>
            <td className="px-2 py-2 pt-3 text-right font-bold tabular-nums text-slate-900 border-t-2 border-slate-200">{formatVnd(breakdown.total)}</td>
            {onRemoveCharge && <td className="border-t-2 border-slate-200"></td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AddGuestForm({ stayId, onAdded }) {
  const [name, setName] = useState("");
  const [idNumber, setIdNumber] = useState("");

  async function submit() {
    if (!name.trim()) return;
    await homestayApi.addGuest(stayId, { name, idNumber });
    setName("");
    setIdNumber("");
    onAdded();
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
      <div className="space-y-1">
        <label className={label}>Thêm khách đi cùng</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Họ tên" className={`${input} w-40`} />
      </div>
      <div className="space-y-1">
        <label className={label}>CCCD</label>
        <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="CCCD" className={`${input} w-40`} />
      </div>
      <button className={`${btn} !py-2`} onClick={submit}>Thêm</button>
    </div>
  );
}
