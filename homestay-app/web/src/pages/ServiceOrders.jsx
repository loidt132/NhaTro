import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { catalogApi, homestayApi, orderApi, formatVnd } from "../api.js";
import { badgeBase, btn, btnDanger, btnPrimary, card, input, label } from "../ui.js";
import { useAuth } from "../AuthContext.js";
import { useHomestay } from "../HomestayContext.js";
import DateField from "../components/DateField.jsx";
import { fetchVietQrPngDataUrl } from "../utils/vietqr.js";

const STATUS_LABEL = { pending: "Chờ xử lý", in_progress: "Đang xử lý", done: "Hoàn thành", cancelled: "Đã huỷ" };
const STATUS_BADGE = {
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-sky-100 text-sky-700",
  done: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-600",
};

const smallBtn = `${btn} !px-3 !py-1.5 !text-xs`;
const tabCls = (on) =>
  `rounded-xl border px-3 py-1.5 text-sm font-medium ${on ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white"}`;

// Gom các dòng cùng orderGroupId thành một đơn.
function groupOrders(rows) {
  const map = new Map();
  for (const o of rows) {
    const key = o.orderGroupId || o.id;
    if (!map.has(key)) map.set(key, { id: key, lines: [], first: o });
    map.get(key).lines.push(o);
  }
  return [...map.values()].map((g) => ({
    ...g,
    total: g.lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
  }));
}

export default function ServiceOrders() {
  const { user } = useAuth();
  const { currentHomestayId } = useHomestay();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const [items, setItems] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [orders, setOrders] = useState(null);
  const [from, setFrom] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState("");

  const occupiedRooms = useMemo(() => rooms.filter((r) => r.status === "occupied" && r.activeStayId), [rooms]);

  async function loadOrders() {
    try {
      // Đơn lưu theo tháng ở catalog-service; lấy từng tháng trong khoảng rồi lọc theo ngày ở đây.
      const start = dayjs(from || undefined).startOf("month");
      const end = dayjs(to || undefined).startOf("month");
      const months = [];
      for (let m = start; !m.isAfter(end); m = m.add(1, "month")) months.push(m.format("YYYY-MM"));
      const results = await Promise.all(months.slice(-12).map((month) => orderApi.list({ month, status: statusFilter })));
      const rows = results.flat().filter((o) => {
        const at = dayjs(o.orderedAt);
        return (!from || !at.isBefore(dayjs(from).startOf("day"))) && (!to || !at.isAfter(dayjs(to).endOf("day")));
      });
      setOrders(rows);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (!currentHomestayId) return;
    catalogApi.getItems("service").then(setItems).catch((err) => console.error("[catalog]", err));
    homestayApi.getRooms().then(setRooms).catch(() => {});
  }, [currentHomestayId]);

  useEffect(() => {
    setOrders(null);
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter, currentHomestayId]);

  const groups = useMemo(
    () => groupOrders(orders || []).sort((a, b) => dayjs(b.first.orderedAt).diff(dayjs(a.first.orderedAt))),
    [orders]
  );

  async function changeStatus(group, status) {
    setError("");
    try {
      await orderApi.update(group.id, { status });
      await loadOrders();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeGroup(group) {
    if (!window.confirm("Xoá đơn này?")) return;
    setError("");
    try {
      await orderApi.remove(group.id);
      await loadOrders();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Đơn dịch vụ</h1>
        <button className={btnPrimary} onClick={() => setFormOpen(true)} disabled={!items.length}>+ Tạo đơn</button>
      </div>
      {!items.length && currentHomestayId && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Chưa có dịch vụ nào trong bảng giá — vào "Dịch vụ &amp; phụ thu" để thêm.
        </div>
      )}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <DateField label="Từ ngày" value={from} onChange={setFrom} />
        <DateField label="Đến ngày" value={to} onChange={setTo} />
        <div className="col-span-2 space-y-1 sm:w-44">
          <label className={label}>Trạng thái</label>
          <select className={input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Tất cả</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className={`${card} !p-3 sm:!p-4`}>
        {orders === null ? (
          <p className="text-sm text-slate-500">Đang tải...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có đơn dịch vụ nào.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {groups.map((g) => {
              const o = g.first;
              const toRoom = o.settlement === "room";
              return (
                <div key={g.id} className="space-y-1.5 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-900">
                      {o.roomId ? `Phòng ${o.customerName}` : `${o.customerName || "Khách"} (vãng lai)`}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-emerald-700">{formatVnd(g.total)}</span>
                  </div>
                  <div className="text-xs text-slate-600">
                    {g.lines.map((l) => (
                      <div key={l.id}>{l.itemName} × {l.quantity}{l.unit ? ` ${l.unit}` : ""}</div>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500">
                    {dayjs(o.orderedAt).format("DD/MM/YYYY HH:mm")} · {toRoom ? "Đã tính vào phòng" : "Thu tiền ngay"}
                    {o.note ? ` · ${o.note}` : ""}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      className={`${badgeBase} border-0 ${STATUS_BADGE[o.status] || ""}`}
                      value={o.status}
                      onChange={(e) => changeStatus(g, e.target.value)}
                    >
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    {!toRoom && o.status !== "cancelled" && (
                      <button className={smallBtn} onClick={() => setInvoice(g)}>Hoá đơn</button>
                    )}
                    {isAdmin && !toRoom && <button className={btnDanger} onClick={() => removeGroup(g)}>Xoá</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {formOpen && (
        <OrderForm
          items={items}
          rooms={occupiedRooms}
          onClose={() => setFormOpen(false)}
          onCreated={async (created) => {
            setFormOpen(false);
            await loadOrders();
            // Thu tiền ngay → mở luôn hoá đơn riêng để in / quét QR.
            if (created[0]?.settlement === "paid") setInvoice(groupOrders(created)[0]);
          }}
        />
      )}
      {invoice && <OrderInvoice group={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
}

function OrderForm({ items, rooms, onClose, onCreated }) {
  const [customerType, setCustomerType] = useState(rooms.length ? "stay" : "walkin");
  const [stayId, setStayId] = useState(rooms[0]?.activeStayId || "");
  const [customerName, setCustomerName] = useState("");
  const [settlement, setSettlement] = useState("room");
  const [lines, setLines] = useState([{ itemId: items[0]?.id || "", quantity: 1 }]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const itemById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const total = lines.reduce((sum, l) => sum + (Number(itemById[l.itemId]?.price) || 0) * (Number(l.quantity) || 0), 0);
  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit(e) {
    e.preventDefault();
    const valid = lines.filter((l) => l.itemId && Number(l.quantity) > 0);
    if (!valid.length) return setError("Chọn ít nhất một dịch vụ với số lượng lớn hơn 0.");
    if (customerType === "walkin" && !customerName.trim()) return setError("Nhập tên khách vãng lai.");
    if (customerType === "stay" && !stayId) return setError("Chọn phòng đang có khách.");
    setSaving(true);
    setError("");
    try {
      const created = await orderApi.create({
        items: valid.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
        ...(customerType === "stay" ? { stayId, settlement } : { customerName: customerName.trim() }),
        note: note.trim() || null,
      });
      onCreated(created);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        className="modal-panel max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-semibold text-slate-900">Tạo đơn dịch vụ</div>
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

        <div className="flex gap-2">
          <button type="button" className={tabCls(customerType === "stay")} onClick={() => setCustomerType("stay")} disabled={!rooms.length}>Khách đang ở</button>
          <button type="button" className={tabCls(customerType === "walkin")} onClick={() => setCustomerType("walkin")}>Khách vãng lai</button>
        </div>

        {customerType === "stay" ? (
          <>
            <div className="space-y-1">
              <label className={label}>Phòng</label>
              <select className={input} value={stayId} onChange={(e) => setStayId(e.target.value)}>
                {rooms.map((r) => <option key={r.activeStayId} value={r.activeStayId}>{r.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className={label}>Thanh toán</label>
              <div className="flex gap-2">
                <button type="button" className={tabCls(settlement === "room")} onClick={() => setSettlement("room")}>Tính vào phòng</button>
                <button type="button" className={tabCls(settlement === "paid")} onClick={() => setSettlement("paid")}>Thu tiền ngay</button>
              </div>
              <p className="text-xs text-slate-500">
                {settlement === "room" ? "Cộng vào tạm tính của phòng, thanh toán khi trả phòng." : "Thu riêng, xuất hoá đơn riêng cho đơn này."}
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <label className={label}>Tên khách vãng lai</label>
            <input className={input} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Tên khách / SĐT" autoComplete="off" />
          </div>
        )}

        <div className="space-y-2">
          <label className={label}>Dịch vụ</label>
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className={`${input} min-w-0 flex-1`} value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({formatVnd(it.price)})</option>)}
              </select>
              <input
                type="number" min="0" step="any" aria-label="Số lượng"
                className={`${input} w-20 shrink-0`} value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
              />
              <button
                type="button" className={`${btn} !px-2.5`} aria-label="Xoá dòng"
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
              >✕</button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <button type="button" className={smallBtn} onClick={() => setLines((ls) => [...ls, { itemId: items[0]?.id || "", quantity: 1 }])}>
              + Thêm dịch vụ
            </button>
            <span className="text-sm text-slate-700">Tạm tính: <strong className="tabular-nums">{formatVnd(total)}</strong></span>
          </div>
        </div>

        <div className="space-y-1">
          <label className={label}>Ghi chú</label>
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-0.5">
          <button type="button" className={`${btn} !py-1.5`} onClick={onClose}>Huỷ</button>
          <button className={`${btnPrimary} !py-1.5`} disabled={saving}>{saving ? "Đang lưu..." : "Tạo đơn"}</button>
        </div>
      </form>
    </div>
  );
}

// Hoá đơn riêng của một đơn dịch vụ thu tiền ngay (in / lưu PDF, kèm mã QR).
function OrderInvoice({ group, onClose }) {
  const [homestayName, setHomestayName] = useState("");
  const [qr, setQr] = useState(null);
  const [qrError, setQrError] = useState("");
  const o = group.first;
  const who = o.roomId ? `Phòng ${o.customerName}` : o.customerName || "Khách vãng lai";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [name, settings] = await Promise.all([homestayApi.getDisplayName(), homestayApi.getSettings()]);
        if (cancelled) return;
        setHomestayName(name);
        if (!settings?.bankCode || !settings?.accountNo) {
          setQrError("Chưa cấu hình ngân hàng — vào Cài đặt để thêm mã QR.");
          return;
        }
        const addInfo = `Dich vu ${o.roomId ? o.customerName : ""}`.trim();
        const url = await fetchVietQrPngDataUrl(settings.bankCode, settings.accountNo, group.total, addInfo, settings.accountName);
        if (!cancelled) setQr(url);
      } catch (err) {
        if (!cancelled) setQrError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [group.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="modal-panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="invoice-print space-y-3 bg-white">
          <div className="text-center">
            <div className="text-base font-bold text-slate-900">{homestayName}</div>
            <div className="text-lg font-bold uppercase tracking-wide text-slate-900">Hoá đơn dịch vụ</div>
          </div>
          <div className="space-y-0.5 text-sm text-slate-700">
            <div>Khách: <strong>{who}</strong></div>
            <div>Thời gian: {dayjs(o.orderedAt).format("DD/MM/YYYY HH:mm")}</div>
          </div>
          <div className="divide-y divide-slate-100 text-sm">
            {group.lines.map((l) => (
              <div key={l.id} className="flex items-baseline justify-between gap-2 py-1.5">
                <span>{l.itemName} × {l.quantity}{l.unit ? ` ${l.unit}` : ""}</span>
                <span className="shrink-0 tabular-nums">{formatVnd(l.amount)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
            <span>Tổng cộng</span>
            <span className="tabular-nums">{formatVnd(group.total)}</span>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 text-sm font-semibold text-slate-900">Quét mã QR để thanh toán</div>
            {qr ? (
              <img src={qr} alt="Mã QR thanh toán" className="h-40 w-40 rounded-lg border border-slate-200" onError={() => { setQr(null); setQrError("Không tải được ảnh QR."); }} />
            ) : (
              <p className="text-sm text-slate-500">{qrError || "Đang tạo mã QR..."}</p>
            )}
          </div>
        </div>
        <div className="no-print mt-3 flex justify-end gap-2">
          <button className={`${btn} !py-1.5`} onClick={onClose}>Đóng</button>
          <button className={`${btnPrimary} !py-1.5`} onClick={() => window.print()}>In / Lưu PDF</button>
        </div>
      </div>
    </div>
  );
}
