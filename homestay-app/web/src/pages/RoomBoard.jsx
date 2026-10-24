import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { homestayApi } from "../api.js";
import { badgeBase, btn, btnDanger, btnPrimary, card, input, label, roomStatus } from "../ui.js";
import { useAuth } from "../AuthContext.js";
import { useHomestay } from "../HomestayContext.js";
import GuestFields from "../components/GuestFields.jsx";
import { validateGuest, toApiGuest } from "../utils/guestValidation.js";

export default function RoomBoard() {
  const { user } = useAuth();
  const { currentHomestayId } = useHomestay();
  const isAdmin = user?.role === "admin";
  const [rooms, setRooms] = useState([]);
  const [maxRooms, setMaxRooms] = useState(null);
  const [checkInRoom, setCheckInRoom] = useState(null);
  const [roomModal, setRoomModal] = useState(null); // { mode: "create" | "edit", room? }
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const atCapacity = maxRooms != null && rooms.length >= maxRooms;

  async function refresh() {
    try {
      const [roomsData, homestayData] = await Promise.all([
        homestayApi.getRooms(),
        homestayApi.getCurrentHomestay(),
      ]);
      setRooms(roomsData);
      setMaxRooms(homestayData.maxRooms);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [currentHomestayId]);

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
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Sơ đồ phòng</h1>
          {maxRooms != null && (
            <span className="text-sm text-slate-500">
              ({rooms.length}/{maxRooms} phòng)
            </span>
          )}
        </div>
        {isAdmin && (
          <button
            className={btnPrimary}
            disabled={atCapacity}
            title={atCapacity ? `Đã đạt giới hạn ${maxRooms} phòng của homestay này` : undefined}
            onClick={() => setRoomModal({ mode: "create" })}
          >
            + Thêm phòng
          </button>
        )}
      </div>
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {rooms.map((room) => {
          const st = roomStatus(room);
          return (
            <button
              key={room.id}
              onClick={() => onRoomClick(room)}
              className={`${card} ${st.border} relative flex flex-col items-start gap-1 !p-3 text-left sm:gap-1.5 sm:!p-4 transition hover:shadow-md`}
            >
              {isAdmin && (
                <span
                  onClick={(e) => openEditRoom(room, e)}
                  className="absolute right-2 top-2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] sm:right-3 sm:top-3 sm:rounded-lg sm:px-2 sm:py-1 sm:text-xs font-medium text-slate-500 hover:bg-slate-50"
                >
                  Sửa
                </span>
              )}
              <span className={`${badgeBase} ${st.badge} !px-2 !py-0.5 !text-[11px] sm:!px-3 sm:!py-1 sm:!text-xs`}>{st.label}</span>
              <div className="text-lg font-bold leading-tight text-slate-900 sm:text-2xl">{room.name}</div>
              <div className="text-xs text-slate-500 sm:text-sm">{room.roomTypeName}</div>
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

function RoomModal({ mode, room, onClose, onSaved }) {
  // Room types are only needed here, so fetch them when the modal opens
  // instead of on every visit to the room board.
  const [roomTypes, setRoomTypes] = useState([]);
  const [name, setName] = useState(room?.name || "");
  const [roomTypeId, setRoomTypeId] = useState(room?.roomTypeId || "");
  const [lockId, setLockId] = useState(room?.lockId || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    homestayApi
      .getRoomTypes()
      .then((types) => {
        setRoomTypes(types);
        setRoomTypeId((current) => current || types[0]?.id || "");
      })
      .catch((err) => setError(err.message));
  }, []);

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
      <div className="modal-panel w-full max-w-md rounded-2xl bg-white p-4 shadow" onClick={(e) => e.stopPropagation()}>
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
  const [guest, setGuest] = useState({ name: "", idType: "cccd", idNumber: "", idExpiryDate: "", phone: "", address: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const errors = validateGuest(guest, { main: true });
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError(Object.values(errors)[0]);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const stay = await homestayApi.checkIn({
        roomId: room.id,
        pricingType,
        mainGuest: toApiGuest(guest),
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
      <div className="modal-panel w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
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

        <p className={label}>Khách chính</p>
        <GuestFields value={guest} onChange={(g) => { setGuest(g); setFieldErrors({}); }} errors={fieldErrors} main />

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
