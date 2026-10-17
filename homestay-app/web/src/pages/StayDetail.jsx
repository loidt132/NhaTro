import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { homestayApi, catalogApi, formatVnd } from "../api.js";
import { badgeBase, btn, btnDanger, btnPrimary, card, input, label, table, tableWrap, td, th } from "../ui.js";

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
  const [catalogCategories, setCatalogCategories] = useState([]);
  const [surchargeRules, setSurchargeRules] = useState([]);
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState(null);

  async function refresh() {
    try {
      const [stayData, roomsData, items, categories, rules] = await Promise.all([
        homestayApi.getStay(stayId),
        homestayApi.getRooms(),
        catalogApi.getItems("service"),
        catalogApi.getCategories(),
        catalogApi.getItems("surcharge"),
      ]);
      setStay(stayData);
      setRooms(roomsData);
      setCatalogItems(items);
      setCatalogCategories(categories);
      setSurchargeRules(rules);
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

  const emptyRooms = rooms.filter((r) => r.status === "empty");
  const room = rooms.find((r) => r.id === stay.roomId);

  async function addService(itemId, qty) {
    await homestayApi.addService(stayId, { itemId, qty });
    refresh();
  }

  async function addSurcharge(ruleId) {
    await homestayApi.addSurcharge(stayId, { surchargeRuleId: ruleId, qty: 1 });
    refresh();
  }

  async function removeCharge(chargeId) {
    await homestayApi.removeCharge(stayId, chargeId);
    refresh();
  }

  async function transfer(toRoomId) {
    await homestayApi.transferRoom(stayId, { toRoomId, reason: "Đổi phòng theo yêu cầu" });
    refresh();
  }

  async function simulateSwipe(type) {
    await homestayApi.simulateSwipe(stayId, { type });
    refresh();
  }

  async function doCheckout() {
    const result = await homestayApi.checkout(stayId);
    setInvoice(result);
    refresh();
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
            {catalogCategories.map((category) => {
              const items = catalogItems.filter((item) => item.categoryId === category.id);
              if (items.length === 0) return null;
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
