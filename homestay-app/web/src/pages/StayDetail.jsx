import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import dayjs from "dayjs";
import { homestayApi, catalogApi, formatVnd } from "../api.js";
import { badgeBase, btn, btnDanger, btnPrimary, card, input, label } from "../ui.js";
import { fetchVietQrPngDataUrl, fillAddInfoTemplate } from "../utils/vietqr.js";

const PRICING_LABEL = {
  hourly: "Theo giờ",
  overnight: "Qua đêm",
  fullday: "Cả ngày",
};

const smallBtn = `${btn} !px-3 !py-1.5 !text-xs`;
const cardCls = `${card} !p-3 sm:!p-4`;
const h2Cls = "mb-2 text-[15px] font-semibold text-slate-900 sm:text-base";

function fmtDateTime(v) {
  return v && dayjs(v).isValid() ? dayjs(v).format("DD/MM/YYYY HH:mm") : "—";
}

export default function StayDetail() {
  const { stayId } = useParams();
  const [stay, setStay] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [surchargeRules, setSurchargeRules] = useState([]);
  const [settings, setSettings] = useState(null);
  const [homestayName, setHomestayName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState("");
  const qrAutoTried = useRef(false);

  function showNotice(message) {
    setNotice(message);
    setTimeout(() => setNotice(""), 4000);
  }

  // Only the stay itself gates the page. Rooms, catalog, settings and the
  // homestay name load in the background so a slow secondary service (the
  // catalog in particular) never keeps the screen on "Đang tải...".
  async function refresh() {
    try {
      setStay(await homestayApi.getStay(stayId));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    qrAutoTried.current = false;
    setStay(null);
    setQrDataUrl(null);
    refresh();
    homestayApi.getSettings().then(setSettings).catch((err) => console.error("[settings]", err));
    homestayApi.getCurrentHomestay().then((h) => setHomestayName(h?.name || "")).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayId]);

  const status = stay?.status;
  useEffect(() => {
    if (status !== "active") return undefined;
    // Extra data is only needed while the stay is open (adding services,
    // surcharges, transferring rooms).
    homestayApi.getRooms().then(setRooms).catch((err) => console.error("[rooms]", err));
    catalogApi.getItems("service").then(setCatalogItems).catch((err) => console.error("[catalog]", err));
    catalogApi.getItems("surcharge").then(setSurchargeRules).catch((err) => console.error("[catalog]", err));
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayId, status]);

  // A finished stay always shows its invoice with the QR already generated.
  useEffect(() => {
    if (status === "checked_out" && settings && !qrAutoTried.current) {
      qrAutoTried.current = true;
      if (settings.bankCode && settings.accountNo) genQr();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, settings]);

  if (!stay) {
    return <div className="text-sm text-slate-500">{error || "Đang tải..."}</div>;
  }

  const roomName = stay.currentRoomName;
  const isActive = stay.status === "active";

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

  async function act(fn, okMessage) {
    setError("");
    try {
      await fn();
      await refresh();
      if (okMessage) showNotice(okMessage);
    } catch (err) {
      setError(err.message);
    }
  }

  const addService = (itemId, qty) =>
    act(() => homestayApi.addService(stayId, { itemId, qty }), "Đã thêm dịch vụ — tạm tính đã cập nhật.");
  const addSurcharge = (ruleId) =>
    act(() => homestayApi.addSurcharge(stayId, { surchargeRuleId: ruleId, qty: 1 }), "Đã thêm phụ thu — tạm tính đã cập nhật.");
  const removeCharge = (chargeId) =>
    act(() => homestayApi.removeCharge(stayId, chargeId), "Đã xoá mục — tạm tính đã cập nhật.");
  const transfer = (toRoomId) =>
    act(() => homestayApi.transferRoom(stayId, { toRoomId, reason: "Đổi phòng theo yêu cầu" }), "Đã đổi phòng thành công.");
  const simulateSwipe = (type) =>
    act(
      () => homestayApi.simulateSwipe(stayId, { type }),
      type === "checkin-swipe" ? "Đã ghi nhận khách quẹt thẻ vào." : "Đã ghi nhận khách quẹt thẻ ra."
    );
  const doCheckout = () => act(() => homestayApi.checkout(stayId), "Trả phòng thành công — hoá đơn đã sẵn sàng để in.");

  async function genQr() {
    if (!settings?.bankCode || !settings?.accountNo) {
      setQrError("Chưa cấu hình ngân hàng — vào Cài đặt > Cài đặt thanh toán để thêm.");
      return;
    }
    setQrLoading(true);
    setQrError("");
    try {
      const addInfo = fillAddInfoTemplate(settings.qrNoteTemplate || "Thanh toan phong {room}", { room: roomName });
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

  const qrBlock = (
    <>
      {qrError && (
        <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{qrError}</div>
      )}
      {qrDataUrl ? (
        <div className="flex items-center gap-3">
          <img
            src={qrDataUrl}
            alt="Mã QR thanh toán"
            className="h-32 w-32 shrink-0 rounded-lg border border-slate-200 sm:h-40 sm:w-40"
            onError={() => {
              setQrDataUrl(null);
              setQrError("Không tải được ảnh QR từ img.vietqr.io — kiểm tra kết nối mạng/tiện ích chặn quảng cáo, hoặc Mã NH và số tài khoản trong Cài đặt.");
            }}
          />
          <div className="text-sm text-slate-600">
            <p>Số tiền: <strong className="text-slate-900">{formatVnd(stay.breakdown.total)}</strong></p>
            {settings?.accountName && <p className="text-xs text-slate-500">{settings.accountName}</p>}
          </div>
        </div>
      ) : (
        !qrLoading && <p className="text-sm text-slate-500">Bấm "Tạo mã QR" để tạo mã chuyển khoản theo cấu hình ngân hàng ở trang Cài đặt.</p>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      <Link to={isActive ? "/" : "/history"} className="no-print inline-block text-sm font-medium text-emerald-700 hover:underline">
        &larr; {isActive ? "Quay lại sơ đồ phòng" : "Quay lại lịch sử"}
      </Link>

      <div className="no-print flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
          {roomName} — {PRICING_LABEL[stay.pricingType]}
        </h1>
        <span className={`${badgeBase} ${isActive ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
          {isActive ? "Đang lưu trú" : "Đã trả phòng"}
        </span>
      </div>
      {error && (
        <div className="no-print rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      {notice && (
        <div className="no-print rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      {!isActive && (
        <div className={`${cardCls} invoice-print`}>
          <div className="mb-3 text-center">
            <div className="text-base font-bold text-slate-900">{homestayName}</div>
            <div className="text-lg font-bold uppercase tracking-wide text-slate-900">Hoá đơn thanh toán</div>
          </div>
          <div className="mb-3 space-y-0.5 text-sm text-slate-700">
            <div>Phòng: <strong>{roomName}</strong> ({PRICING_LABEL[stay.pricingType]})</div>
            <div>Khách: <strong>{(stay.guests.find((g) => g.isMain) || stay.guests[0])?.name || "—"}</strong></div>
            <div>Nhận phòng: {fmtDateTime(stay.checkInAt)}</div>
            <div>Trả phòng: {fmtDateTime(stay.checkOutAt)}</div>
          </div>
          <Breakdown breakdown={stay.breakdown} />
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 text-sm font-semibold text-slate-900">Quét mã QR để thanh toán</div>
            {qrBlock}
          </div>
          <div className="no-print mt-3 flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={() => window.print()}>In / Lưu PDF</button>
            <button className={btn} onClick={genQr} disabled={qrLoading}>
              {qrLoading ? "Đang tạo..." : qrDataUrl ? "Tạo lại mã QR" : "Tạo mã QR"}
            </button>
          </div>
        </div>
      )}

      <div className={`${cardCls} no-print`}>
        <h2 className={h2Cls}>Khách lưu trú</h2>
        <div className="divide-y divide-slate-100">
          {stay.guests.map((g) => (
            <div key={g.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{g.name}</div>
                <div className="text-xs text-slate-500">
                  CCCD: {g.idNumber || "—"}{g.phone ? ` · ${g.phone}` : ""}
                </div>
              </div>
              <span className="shrink-0 text-xs text-slate-500">{g.isMain ? "Khách chính" : "Đi cùng"}</span>
            </div>
          ))}
        </div>
        {isActive && <AddGuestForm stayId={stayId} onAdded={refresh} />}
      </div>

      {isActive && (
        <>
          <div className={cardCls}>
            <h2 className={h2Cls}>Tạm tính hiện tại</h2>
            <Breakdown breakdown={stay.breakdown} onRemoveCharge={removeCharge} />
          </div>

          <div className={cardCls}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-slate-900 sm:text-base">Mã QR thanh toán</h2>
              <button className={smallBtn} onClick={genQr} disabled={qrLoading}>
                {qrLoading ? "Đang tạo..." : qrDataUrl ? "Tạo lại mã QR" : "Tạo mã QR"}
              </button>
            </div>
            {qrBlock}
          </div>
        </>
      )}

      {stay.transfers.length > 0 && (
        <div className={`${cardCls} no-print`}>
          <h2 className="mb-1 text-[15px] font-semibold text-slate-900 sm:text-base">Lịch sử đổi phòng</h2>
          <p className="mb-2 text-xs text-slate-500">Chỉ để đối soát — không ảnh hưởng tới cách tính tiền phòng.</p>
          <div className="divide-y divide-slate-100">
            {stay.transfers.map((t) => (
              <div key={t.id} className="py-2 text-sm">
                <div className="font-medium text-slate-900">{t.fromRoomName} → {t.toRoomName}</div>
                <div className="text-xs text-slate-500">{fmtDateTime(t.transferredAt)}{t.reason ? ` · ${t.reason}` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isActive && (
        <>
          <div className={cardCls}>
            <h2 className={h2Cls}>Thêm dịch vụ</h2>
            {catalogGroups.length === 0 && <p className="text-sm text-slate-500">Đang tải danh mục dịch vụ...</p>}
            {catalogGroups.map((category) => (
              <div key={category.id} className="mb-3 last:mb-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{category.name}</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {category.items.map((item) => (
                    <div key={item.id} className="flex flex-col gap-0.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2 sm:p-3">
                      <strong className="truncate text-[13px] text-slate-900 sm:text-sm">{item.name}</strong>
                      <span className="text-[11px] text-slate-500 sm:text-xs">{formatVnd(item.price)} / {item.unit}</span>
                      <button className={`${btn} mt-1 !py-1 !text-xs`} onClick={() => addService(item.id, 1)}>+ Thêm 1</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={cardCls}>
            <h2 className={h2Cls}>Phụ thu</h2>
            <div className="flex flex-wrap gap-1.5">
              {surchargeRules.map((rule) => (
                <button key={rule.id} className={`${btn} !px-2.5 !py-1 !text-xs`} onClick={() => addSurcharge(rule.id)}>
                  + {rule.name} ({formatVnd(rule.price)})
                </button>
              ))}
            </div>
          </div>

          <div className={cardCls}>
            <h2 className="mb-1 text-[15px] font-semibold text-slate-900 sm:text-base">Đổi phòng</h2>
            <p className="mb-2 text-xs text-slate-500">
              Không tính lại giá — tiền phòng vẫn tính liên tục từ lúc nhận phòng.
            </p>
            {emptyRooms.length === 0 ? (
              <p className="text-sm text-slate-500">Không có phòng trống để chuyển.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {emptyRooms.map((r) => (
                  <button key={r.id} className={`${btn} !px-2.5 !py-1 !text-xs`} onClick={() => transfer(r.id)}>
                    Chuyển sang {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!(stay.swipedIn && stay.swipedOut) && (
            <div className={cardCls}>
              <h2 className="mb-1 text-[15px] font-semibold text-slate-900 sm:text-base">TTLock (mock)</h2>
              <p className="mb-2 text-xs text-slate-500">Mã thẻ hiện tại: {stay.lockCardId}</p>
              <div className="flex flex-wrap gap-1.5">
                {!stay.swipedIn && (
                  <button className={smallBtn} onClick={() => simulateSwipe("checkin-swipe")}>Giả lập khách quẹt thẻ vào</button>
                )}
                {stay.swipedIn && !stay.swipedOut && (
                  <button className={smallBtn} onClick={() => simulateSwipe("checkout-swipe")}>Giả lập khách quẹt thẻ ra</button>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button className={btnPrimary} onClick={doCheckout}>Trả phòng &amp; xuất hoá đơn</button>
          </div>
        </>
      )}
    </div>
  );
}

function Breakdown({ breakdown, onRemoveCharge }) {
  const lines = [
    ...breakdown.roomLines.map((l, i) => ({ key: `room-${i}`, label: l.label, amount: l.amount })),
    ...breakdown.serviceLines.map((l, i) => ({ key: l.id || `svc-${i}`, id: l.id, label: l.label, amount: l.amount })),
  ];
  return (
    <div>
      <div className="divide-y divide-slate-100">
        {lines.map((l) => (
          <div key={l.key} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 text-slate-800">{l.label}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums">{formatVnd(l.amount)}</span>
              {onRemoveCharge && l.id && (
                <button className={`${btnDanger} !px-2 !py-0.5`} onClick={() => onRemoveCharge(l.id)} aria-label="Xoá">✕</button>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t-2 border-slate-200 pt-2.5 text-base font-bold text-slate-900">
        <span>Tổng cộng</span>
        <span className="tabular-nums">{formatVnd(breakdown.total)}</span>
      </div>
    </div>
  );
}

function AddGuestForm({ stayId, onAdded }) {
  const [name, setName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await homestayApi.addGuest(stayId, { name, idNumber });
      setName("");
      setIdNumber("");
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <label className={label}>Thêm khách đi cùng</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Họ tên" className={input} />
      <div className="flex gap-2">
        <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="CCCD" className={`${input} min-w-0 flex-1`} />
        <button className={`${btn} shrink-0 !py-2`} disabled={saving} onClick={submit}>Thêm</button>
      </div>
    </div>
  );
}
