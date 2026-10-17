import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { homestayApi } from "../api.js";
import { badgeBase, btn, btnDanger, btnPrimary, card, input, label, roomStatus } from "../ui.js";
import { useAuth } from "../AuthContext.js";

export default function RoomBoard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rooms, setRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [checkInRoom, setCheckInRoom] = useState(null);
  const [roomModal, setRoomModal] = useState(null); // { mode: "create" | "edit", room? }
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function refresh() {
    try {
      const [roomsData, typesData] = await Promise.all([
        homestayApi.getRooms(),
        homestayApi.getRoomTypes(),
      ]);
      setRooms(roomsData);
      setRoomTypes(typesData);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function roomTypeName(id) {
    return roomTypes.find((t) => t.id === id)?.name || id;
  }

  function onRoomClick(room) {
    // An inactive room still has to be reachable if it somehow has a guest
    // in it (e.g. deactivated mid-stay) — only block starting a *new*
    // check-in on it.
    if (room.status === "occupied") {
      navigate(`/stays/${room.activeStayId}`);
    } else if (room.active !== false && room.status === "empty") {
      setCheckInRoom(room);
    }
  }

  async function markClean(roomId, e) {
    e.stopPropagation();
    await homestayApi.setRoomStatus(roomId, "empty");
    refresh();
  }

  function openEditRoom(room, e) {
    e.stopPropagation();
    setRoomModal({ mode: "edit", room });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">Sơ đồ phòng</h1>
        {isAdmin && (
          <button className={btnPrimary} onClick={() => setRoomModal({ mode: "create" })}>
            + Thêm phòng
          </button>
        )}
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rooms.map((room) => {
          const st = roomStatus(room);
          return (
            <button
              key={room.id}
              onClick={() => onRoomClick(room)}
              className={`${card} ${st.border} relative flex flex-col items-start gap-1.5 text-left transition hover:shadow-md`}
            >
              {isAdmin && (
                <span
                  onClick={(e) => openEditRoom(room, e)}
                  className="absolute right-3 top-3 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
                >
                  Sửa
                </span>
              )}
              <span className={`${badgeBase} ${st.badge}`}>{st.label}</span>
              <div className="text-2xl font-bold text-slate-900">{room.name}</div>
              <div className="text-sm text-slate-500">{roomTypeName(room.roomTypeId)}</div>
              {room.active !== false && room.status === "cleaning" && (
                <span onClick={(e) => markClean(room.id, e)} className={`${btn} mt-1 !py-1.5 !text-xs`}>
                  Đã dọn xong
                </span>
              )}
            </button>
          );
        })}
      </div>

      {checkInRoom && (
        <CheckInModal
          room={checkInRoom}
          onClose={() => setCheckInRoom(null)}
          onDone={(stayId) => {
            setCheckInRoom(null);
            navigate(`/stays/${stayId}`);
          }}
        />
      )}

      {roomModal && (
        <RoomModal
          mode={roomModal.mode}
          room={roomModal.room}
          roomTypes={roomTypes}
          onClose={() => setRoomModal(null)}
          onSaved={() => {
            setRoomModal(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RoomModal({ mode, room, roomTypes, onClose, onSaved }) {
  const [name, setName] = useState(room?.name || "");
  const [roomTypeId, setRoomTypeId] = useState(room?.roomTypeId || roomTypes[0]?.id || "");
  const [lockId, setLockId] = useState(room?.lockId || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Vui lòng nhập tên phòng");
      return;
    }
    if (!roomTypeId) {
      setError("Vui lòng chọn loại phòng");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (mode === "edit") {
        await homestayApi.updateRoom(room.id, { name, roomTypeId, lockId });
      } else {
        await homestayApi.addRoom({ name, roomTypeId, lockId });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive() {
    setSubmitting(true);
    setError("");
    try {
      await homestayApi.updateRoom(room.id, { active: room.active === false });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    setSubmitting(true);
    setError("");
    try {
      await homestayApi.deleteRoom(room.id);
      onSaved();
    } catch (err) {
      // Server refuses when the room has stay/revenue history — surface
      // its message so the user knows to deactivate instead.
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-lg font-semibold text-slate-900">{mode === "edit" ? "Cập nhật phòng" : "Thêm phòng"}</div>
        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className={label}>Tên phòng (VD: 301)</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className={label}>Loại phòng</label>
            <select className={input} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
              {roomTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={label}>Mã khoá TTLock (lockId)</label>
            <input
              className={input}
              value={lockId}
              onChange={(e) => setLockId(e.target.value)}
              placeholder="Để trống nếu chưa gán khoá"
            />
          </div>

          {mode === "edit" && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="flex gap-2">
                <button type="button" disabled={submitting} onClick={toggleActive} className={`${btn} !py-1.5 !text-xs`}>
                  {room.active === false ? "Kích hoạt lại" : "Ngừng sử dụng"}
                </button>
                <button type="button" disabled={submitting} onClick={remove} className={btnDanger}>
                  Xoá
                </button>
              </div>
              <span className="text-xs text-slate-400">Có lịch sử lưu trú thì chỉ ngừng sử dụng được, không xoá được.</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={btn}>Huỷ</button>
            <button disabled={submitting} className={btnPrimary}>
              {submitting ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CheckInModal({ room, onClose, onDone }) {
  const [pricingType, setPricingType] = useState("hourly");
  const [name, setName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) {
      setError("Vui lòng nhập tên khách");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const stay = await homestayApi.checkIn({
        roomId: room.id,
        pricingType,
        mainGuest: { name, idNumber, phone },
      });
      onDone(stay.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900">Nhận phòng {room.name}</h2>
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <div className="space-y-1">
          <label className={label}>Loại tính giá</label>
          <select value={pricingType} onChange={(e) => setPricingType(e.target.value)} className={input}>
            <option value="hourly">Theo giờ (2h đầu + phụ thu)</option>
            <option value="overnight">Qua đêm (22h - 12h hôm sau)</option>
            <option value="fullday">Cả ngày (14h - 12h hôm sau)</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className={label}>Họ tên khách chính</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" className={input} />
        </div>

        <div className="space-y-1">
          <label className={label}>Số CCCD/hộ chiếu</label>
          <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className={input} />
        </div>

        <div className="space-y-1">
          <label className={label}>Số điện thoại</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
        </div>

        <p className="text-xs text-slate-500">
          Khi xác nhận, hệ thống sẽ phát hành thẻ TTLock (mock) cho khoá phòng {room.lockId}.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button className={btn} onClick={onClose}>Huỷ</button>
          <button className={btnPrimary} disabled={submitting} onClick={submit}>
            {submitting ? "Đang xử lý..." : "Xác nhận nhận phòng"}
          </button>
        </div>
      </div>
    </div>
  );
}
