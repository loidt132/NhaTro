import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import dayjs from "dayjs";
import { homestayApi, catalogApi, formatVnd } from "../api.js";
import { badgeBase, btn, btnDanger, btnPrimary, card } from "../ui.js";
import { fetchVietQrPngDataUrl, fillAddInfoTemplate } from "../utils/vietqr.js";
import GuestFields from "../components/GuestFields.jsx";
import { validateGuest, ID_TYPES } from "../utils/guestValidation.js";

const PRICING_LABEL = {
  hourly: "Theo giờ",
  overnight: "Qua đêm",
  fullday: "Cả ngày",
};

const smallBtn = `${btn} !px-3 !py-1.5 !text-xs`;
const cardCls = `${card} !p-3 sm:!p-4`;
const h2Cls = "mb-2 text-[15px] font-semibold text-slate-900 sm:text-base";

function fmtDate(v) {
  return v && dayjs(v).isValid() ? dayjs(v).format("DD/MM/YYYY") : "—";
}

function fmtDateTime(v) {
  return v && dayjs(v).isValid() ? dayjs(v).format("DD/MM/YYYY HH:mm") : "—";
}

export default function StayDetail() {
  const { stayId } = useParams();
  const [stay, setStay] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [pricingHistoryOpen, setPricingHistoryOpen] = useState(false);
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
    // Rooms are only needed while the stay is open (transferring rooms). The
    // service catalog is fetched only when the "add" popup is opened.
    homestayApi.getRooms().then(setRooms).catch((err) => console.error("[rooms]", err));
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
  const isCancelled = stay.status === "cancelled";

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
  const changePricingType = (pricingType) =>
    act(() => homestayApi.setPricingType(stayId, pricingType), "Đã đổi hình thức thuê — tạm tính đã cập nhật.");
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
      <Link to={isActive || isCancelled ? "/" : "/history"} className="no-print inline-block text-sm font-medium text-emerald-700 hover:underline">
        &larr; {isActive || isCancelled ? "Quay lại sơ đồ phòng" : "Quay lại lịch sử"}
      </Link>

      <div className="no-print flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
          {roomName} — {PRICING_LABEL[stay.pricingType]}
        </h1>
        <span className={`${badgeBase} ${isActive ? "bg-sky-100 text-sky-700" : isCancelled ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>
          {isActive ? "Đang lưu trú" : isCancelled ? "Đã huỷ" : "Đã trả phòng"}
        </span>
      </div>
      {error && (
        <div className="no-print rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      {notice && (
        <div className="no-print rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      {isCancelled && (
        <div className="no-print rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Lượt nhận phòng này đã bị huỷ — không có hoá đơn và không tính vào doanh thu.
        </div>
      )}

      {stay.status === "checked_out" && (
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-slate-900 sm:text-base">Khách lưu trú</h2>
          {isActive && <button className={smallBtn} onClick={() => setGuestOpen(true)}>+ Thêm khách</button>}
        </div>
        <div className="divide-y divide-slate-100">
          {stay.guests.map((g) => (
            <div key={g.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{g.name}</div>
                <div className="text-xs text-slate-500">
                  {ID_TYPES.find((t) => t.value === g.idType)?.label || "CCCD"}: {g.idNumber || "—"}
                  {g.idExpiryDate ? ` · HHSD ${fmtDate(g.idExpiryDate)}` : ""}
                  {g.phone ? ` · ${g.phone}` : ""}
                </div>
                {g.address && <div className="text-xs text-slate-500">{g.address}</div>}
              </div>
              <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                {g.isMain ? "Khách chính" : "Đi cùng"}
                {isActive && !g.isMain && (
                  <button
                    className={`${btnDanger} !px-2 !py-0.5`}
                    onClick={() => act(() => homestayApi.removeGuest(stayId, g.id), "Đã xoá khách đi cùng.")}
                    aria-label="Xoá khách"
                  >
                    ✕
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {isActive && (
        <>
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900 sm:text-base">Hình thức thuê</h2>
                <p className="text-xs text-slate-500">Đang tính theo: {PRICING_LABEL[stay.pricingType]}</p>
              </div>
              <button className={smallBtn} onClick={() => setPricingOpen(true)}>Đổi hình thức</button>
            </div>
          </div>

          <div className={cardCls}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-slate-900 sm:text-base">Tạm tính hiện tại</h2>
              <button className={smallBtn} onClick={() => setAddOpen(true)}>+ Dịch vụ / phụ thu</button>
            </div>
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

      {stay.pricingChanges?.length > 0 && (
        <div className={`${cardCls} no-print`}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setPricingHistoryOpen((v) => !v)}
            aria-expanded={pricingHistoryOpen}
          >
            <span className="text-[15px] font-semibold text-slate-900 sm:text-base">
              Lịch sử đổi hình thức thuê ({stay.pricingChanges.length})
            </span>
            <span className="text-slate-500">{pricingHistoryOpen ? "▲" : "▼"}</span>
          </button>
          {pricingHistoryOpen && (
            <>
              <p className="mb-1 mt-1 text-xs text-slate-500">Chỉ để đối soát — số tiền là chênh lệch tiền phòng tại thời điểm đổi.</p>
              <div className="divide-y divide-slate-100">
                {stay.pricingChanges.map((c) => (
                  <div key={c.id} className="py-2 text-sm">
                    <div className="font-medium text-slate-900">{PRICING_LABEL[c.fromPricingType]} → {PRICING_LABEL[c.toPricingType]}</div>
                    <div className="text-xs text-slate-500">
                      {fmtDateTime(c.changedAt)} · {adjustmentText(c.amountDiff)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {stay.transfers.length > 0 && (
        <div className={`${cardCls} no-print`}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setTransfersOpen((v) => !v)}
            aria-expanded={transfersOpen}
          >
            <span className="text-[15px] font-semibold text-slate-900 sm:text-base">
              Lịch sử đổi phòng ({stay.transfers.length})
            </span>
            <span className="text-slate-500">{transfersOpen ? "▲" : "▼"}</span>
          </button>
          {transfersOpen && (
            <>
              <p className="mb-1 mt-1 text-xs text-slate-500">Chỉ để đối soát — không ảnh hưởng tới cách tính tiền phòng.</p>
              <div className="divide-y divide-slate-100">
                {stay.transfers.map((t) => (
                  <div key={t.id} className="py-2 text-sm">
                    <div className="font-medium text-slate-900">{t.fromRoomName} → {t.toRoomName}</div>
                    <div className="text-xs text-slate-500">{fmtDateTime(t.transferredAt)}{t.reason ? ` · ${t.reason}` : ""}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {isActive && (
        <>
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900 sm:text-base">Đổi phòng</h2>
                <p className="text-xs text-slate-500">Không tính lại giá — tiền phòng vẫn tính liên tục từ lúc nhận phòng.</p>
              </div>
              <button className={smallBtn} onClick={() => setRoomOpen(true)}>Đổi phòng</button>
            </div>
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

          <div className="flex flex-wrap justify-end gap-2">
            <button className={btnDanger} onClick={() => setConfirmCancel(true)}>Huỷ phòng</button>
            <button className={btnPrimary} onClick={doCheckout}>Trả phòng &amp; xuất hoá đơn</button>
          </div>
        </>
      )}

      {guestOpen && (
        <AddGuestModal
          stayId={stayId}
          onClose={() => setGuestOpen(false)}
          onAdded={async () => {
            setGuestOpen(false);
            await refresh();
            showNotice("Đã thêm khách đi cùng.");
          }}
        />
      )}

      {confirmCancel && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmCancel(false)}>
          <div className="modal-panel w-full max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold text-slate-900">Huỷ lượt nhận phòng {roomName}?</div>
            <p className="text-sm text-slate-600">
              Dùng khi nhận phòng nhầm hoặc khách không ở. Lượt này sẽ không có hoá đơn và không tính vào doanh thu; phòng trở về trạng thái trống.
            </p>
            <div className="flex justify-end gap-2">
              <button className={btn} onClick={() => setConfirmCancel(false)}>Không</button>
              <button
                className={btnDanger}
                onClick={async () => {
                  setConfirmCancel(false);
                  await act(() => homestayApi.cancelStay(stayId), "Đã huỷ lượt nhận phòng.");
                }}
              >
                Huỷ phòng
              </button>
            </div>
          </div>
        </div>
      )}

      {roomOpen && (
        <RoomModal
          rooms={emptyRooms}
          onClose={() => setRoomOpen(false)}
          onPick={async (room) => {
            setRoomOpen(false);
            await transfer(room.id);
          }}
        />
      )}

      {pricingOpen && (
        <PricingModal
          stayId={stayId}
          currentType={stay.pricingType}
          onClose={() => setPricingOpen(false)}
          onConfirm={async (type) => {
            setPricingOpen(false);
            await changePricingType(type);
          }}
        />
      )}

      {addOpen && (
        <AddChargesModal onClose={() => setAddOpen(false)} onAddService={addService} onAddSurcharge={addSurcharge} />
      )}
    </div>
  );
}

// Loads the service catalog only when opened, so the stay screen itself stays light.
function AddChargesModal({ onClose, onAddService, onAddSurcharge }) {
  const [items, setItems] = useState(null);
  const [rules, setRules] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [added, setAdded] = useState("");

  useEffect(() => {
    Promise.all([catalogApi.getItems("service"), catalogApi.getItems("surcharge")])
      .then(([svc, sur]) => {
        setItems(svc);
        setRules(sur);
      })
      .catch((err) => {
        console.error("[catalog]", err);
        setLoadError("Không tải được danh mục dịch vụ, thử lại sau.");
        setItems([]);
      });
  }, []);

  const groups = [];
  for (const item of items || []) {
    if (!item.categoryId) continue;
    let group = groups.find((g) => g.id === item.categoryId);
    if (!group) {
      group = { id: item.categoryId, name: item.categoryName || item.categoryId, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  async function add(fn, name) {
    await fn();
    setAdded(`Đã thêm: ${name}`);
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="text-base font-semibold text-slate-900">Thêm dịch vụ / phụ thu</div>
          <button className={`${btn} !px-3 !py-1 !text-xs`} onClick={onClose}>Đóng</button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {added && <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{added}</div>}
          {items === null && <p className="text-sm text-slate-500">Đang tải danh mục...</p>}
          {loadError && <p className="text-sm text-rose-600">{loadError}</p>}
          {groups.map((category) => (
            <div key={category.id}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{category.name}</h3>
              <div className="grid grid-cols-2 gap-2">
                {category.items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-0.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                    <strong className="truncate text-[13px] text-slate-900">{item.name}</strong>
                    <span className="text-[11px] text-slate-500">{formatVnd(item.price)} / {item.unit}</span>
                    <button className={`${btn} mt-1 !py-1 !text-xs`} onClick={() => add(() => onAddService(item.id, 1), item.name)}>+ Thêm 1</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {rules.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Phụ thu</h3>
              <div className="flex flex-wrap gap-1.5">
                {rules.map((rule) => (
                  <button key={rule.id} className={`${btn} !px-2.5 !py-1 !text-xs`} onClick={() => add(() => onAddSurcharge(rule.id), rule.name)}>
                    + {rule.name} ({formatVnd(rule.price)})
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Popup listing the empty rooms the stay can move to. Moving keeps the room charge running.
function RoomModal({ rooms, onClose, onPick }) {
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-semibold text-slate-900">Chuyển sang phòng trống</div>
        <p className="text-xs text-slate-500">Không tính lại giá — tiền phòng vẫn tính liên tục từ lúc nhận phòng.</p>
        {rooms.length === 0 ? (
          <p className="text-sm text-slate-500">Không có phòng trống để chuyển.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`${btn} !justify-start !py-2 !text-sm`}
                onClick={() => onPick(r)}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end pt-1">
          <button className={btn} onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}

// Popup for switching rental type: shows what each option adds (bù) or refunds (hoàn)
// against the room charge the stay has accumulated so far.
function PricingModal({ stayId, currentType, onClose, onConfirm }) {
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    homestayApi
      .getPricingOptions(stayId)
      .then(setOptions)
      .catch((err) => setLoadError(err.message));
  }, [stayId]);

  const currentTotal = options?.totals[currentType];
  const selectedDiff = selected && currentTotal != null ? options.totals[selected] - currentTotal : 0;

  async function confirm() {
    setSaving(true);
    try {
      await onConfirm(selected);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-semibold text-slate-900">Đổi hình thức thuê</div>
        {loadError && <p className="text-sm text-rose-600">{loadError}</p>}
        {!options && !loadError && <p className="text-sm text-slate-500">Đang tính giá...</p>}

        {options && (
          <div className="space-y-1.5">
            {Object.entries(PRICING_LABEL).map(([type, text]) => {
              const diff = options.totals[type] - currentTotal;
              const isCurrent = type === currentType;
              return (
                <button
                  key={type}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => setSelected(type)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
                    selected === type ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"
                  } ${isCurrent ? "opacity-60" : "hover:bg-slate-50"}`}
                >
                  <span className="font-medium text-slate-900">{text}</span>
                  <span className="text-xs text-slate-600">
                    {isCurrent ? "Đang dùng" : adjustmentText(diff)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Đổi sang {PRICING_LABEL[selected]}: {adjustmentText(selectedDiff)}.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button className={btn} onClick={onClose}>Huỷ</button>
          <button className={btnPrimary} disabled={!selected || saving} onClick={confirm}>
            {saving ? "Đang lưu..." : "Xác nhận đổi"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Positive = khách bù thêm, negative = hoàn lại, zero = không chênh lệch.
function adjustmentText(diff) {
  if (!diff) return "không chênh lệch";
  return diff > 0 ? `bù thêm ${formatVnd(diff)}` : `hoàn lại ${formatVnd(-diff)}`;
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

function AddGuestModal({ stayId, onClose, onAdded }) {
  const [guest, setGuest] = useState({ name: "", idType: "cccd", idNumber: "", idExpiryDate: "", phone: "", address: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    const errors = validateGuest(guest);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError(Object.values(errors)[0]);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await homestayApi.addGuest(stayId, guest);
      onAdded();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        className="modal-panel w-full max-w-md space-y-3 overflow-x-hidden rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-semibold text-slate-900">Thêm khách đi cùng</div>
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <GuestFields value={guest} onChange={(g) => { setGuest(g); setFieldErrors({}); }} errors={fieldErrors} />
        <div className="flex justify-end gap-2 pt-0.5">
          <button type="button" className={`${btn} !py-1.5`} onClick={onClose}>Huỷ</button>
          <button className={`${btnPrimary} !py-1.5`} disabled={saving}>{saving ? "Đang lưu..." : "Thêm"}</button>
        </div>
      </form>
    </div>
  );
}
