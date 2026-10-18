import { useEffect, useState } from "react";
import { homestayApi } from "../api.js";
import { btnPrimary, card, input, label } from "../ui.js";
import { useAuth } from "../AuthContext.js";
import { useHomestay } from "../HomestayContext.js";

const FIELDS = [
  ["hourlyFirstBlockHours", "Số giờ block đầu"],
  ["hourlyFirstBlockPrice", "Giá block đầu"],
  ["hourlyExtraPricePerHour", "Giá mỗi giờ thêm"],
  ["overnightPrice", "Giá qua đêm"],
  ["fullDayPrice", "Giá cả ngày"],
  ["lateCheckoutPricePerHour", "Phụ thu trả muộn/giờ"],
];

export default function RatePlanAdmin() {
  const { user } = useAuth();
  const { currentHomestayId } = useHomestay();
  const isAdmin = user?.role === "admin";
  const [plans, setPlans] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [editing, setEditing] = useState({});
  const [savedId, setSavedId] = useState("");
  const [newTypeName, setNewTypeName] = useState("");
  const [addingType, setAddingType] = useState(false);
  const [addTypeError, setAddTypeError] = useState("");
  const [renaming, setRenaming] = useState(null); // { id, value }
  const [busyTypeId, setBusyTypeId] = useState(null);
  const [typeError, setTypeError] = useState({}); // roomTypeId -> error message

  async function refresh() {
    const [plansData, typesData] = await Promise.all([
      homestayApi.getRatePlans(),
      homestayApi.getRoomTypes(),
    ]);
    setPlans(plansData);
    setRoomTypes(typesData);
  }

  useEffect(() => {
    refresh();
  }, [currentHomestayId]);

  async function addRoomType() {
    const name = newTypeName.trim();
    if (!name) return;
    setAddingType(true);
    setAddTypeError("");
    try {
      await homestayApi.addRoomType(name);
      setNewTypeName("");
      await refresh();
    } catch (err) {
      setAddTypeError(err.message || "Không thêm được loại phòng");
    } finally {
      setAddingType(false);
    }
  }

  function roomTypeName(id) {
    return roomTypes.find((t) => t.id === id)?.name || id;
  }

  function startRename(id, currentName) {
    setTypeError((prev) => ({ ...prev, [id]: "" }));
    setRenaming({ id, value: currentName });
  }

  async function saveRename() {
    if (!renaming) return;
    const name = renaming.value.trim();
    const id = renaming.id;
    if (!name) return;
    setBusyTypeId(id);
    try {
      await homestayApi.renameRoomType(id, name);
      setRenaming(null);
      await refresh();
    } catch (err) {
      setTypeError((prev) => ({ ...prev, [id]: err.message || "Không đổi tên được" }));
    } finally {
      setBusyTypeId(null);
    }
  }

  async function removeRoomType(id) {
    if (!window.confirm(`Xoá loại phòng "${roomTypeName(id)}"? Không thể hoàn tác.`)) return;
    setBusyTypeId(id);
    setTypeError((prev) => ({ ...prev, [id]: "" }));
    try {
      await homestayApi.deleteRoomType(id);
      await refresh();
    } catch (err) {
      setTypeError((prev) => ({ ...prev, [id]: err.message || "Không xoá được loại phòng" }));
    } finally {
      setBusyTypeId(null);
    }
  }

  function fieldValue(plan, key) {
    return editing[plan.id]?.[key] ?? plan[key];
  }

  function setField(plan, key, value) {
    setEditing((prev) => ({
      ...prev,
      [plan.id]: { ...prev[plan.id], [key]: value },
    }));
  }

  async function save(plan) {
    const patch = editing[plan.id];
    if (!patch) return;
    const numericPatch = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, Number(v)]));
    await homestayApi.updateRatePlan(plan.id, numericPatch);
    setEditing((prev) => ({ ...prev, [plan.id]: undefined }));
    setSavedId(plan.id);
    setTimeout(() => setSavedId(""), 1500);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Bảng giá phòng</h1>
        <p className="mt-1 text-sm text-slate-500">
          Giá theo giờ dùng kiểu "block N giờ đầu" + phụ thu mỗi giờ tiếp theo. Qua đêm/cả ngày là giá cố định,
          cộng thêm phụ thu nếu trả phòng sau 12h hôm sau.
        </p>
      </div>
      {!isAdmin && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Chỉ admin mới được sửa bảng giá — bạn đang xem ở chế độ chỉ đọc.
        </div>
      )}
      {isAdmin && (
        <div className={card}>
          <h2 className="mb-3 font-semibold text-slate-900">Thêm loại phòng</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className={label}>Tên loại phòng</label>
              <input
                className={input}
                placeholder="VD: Phòng Suite"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRoomType()}
              />
            </div>
            <button className={btnPrimary} disabled={addingType || !newTypeName.trim()} onClick={addRoomType}>
              {addingType ? "Đang thêm..." : "+ Thêm loại phòng"}
            </button>
          </div>
          {addTypeError && <div className="mt-2 text-sm text-red-600">{addTypeError}</div>}
        </div>
      )}
      {plans.map((plan) => (
        <div className={card} key={plan.id}>
          <div className="mb-3 flex items-center justify-between gap-3">
            {isAdmin && renaming?.id === plan.roomTypeId ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  className={input}
                  value={renaming.value}
                  autoFocus
                  onChange={(e) => setRenaming({ id: plan.roomTypeId, value: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && saveRename()}
                />
                <button
                  className={btnPrimary}
                  disabled={busyTypeId === plan.roomTypeId || !renaming.value.trim()}
                  onClick={saveRename}
                >
                  Lưu
                </button>
                <button className="text-sm text-slate-500" onClick={() => setRenaming(null)}>
                  Huỷ
                </button>
              </div>
            ) : (
              <>
                <h2 className="font-semibold text-slate-900">{roomTypeName(plan.roomTypeId)}</h2>
                {isAdmin && (
                  <div className="flex items-center gap-3 text-sm">
                    <button
                      className="text-slate-500 hover:text-slate-900"
                      onClick={() => startRename(plan.roomTypeId, roomTypeName(plan.roomTypeId))}
                    >
                      Sửa tên
                    </button>
                    <button
                      className="text-red-600 hover:text-red-700"
                      disabled={busyTypeId === plan.roomTypeId}
                      onClick={() => removeRoomType(plan.roomTypeId)}
                    >
                      Xoá
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          {typeError[plan.roomTypeId] && (
            <div className="mb-3 text-sm text-red-600">{typeError[plan.roomTypeId]}</div>
          )}
          <fieldset disabled={!isAdmin} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {FIELDS.map(([key, fieldLabel]) => (
              <div className="space-y-1" key={key}>
                <label className={label}>{fieldLabel}</label>
                <input
                  type="number"
                  value={fieldValue(plan, key)}
                  onChange={(e) => setField(plan, key, e.target.value)}
                  className={input}
                />
              </div>
            ))}
          </fieldset>
          {isAdmin && (
            <div className="mt-4 flex justify-end items-center gap-2">
              {savedId === plan.id && <span className="text-xs font-medium text-emerald-600">Đã lưu</span>}
              <button className={btnPrimary} onClick={() => save(plan)}>Lưu thay đổi</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
