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

  function roomTypeName(id) {
    return roomTypes.find((t) => t.id === id)?.name || id;
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
      {plans.map((plan) => (
        <div className={card} key={plan.id}>
          <h2 className="mb-3 font-semibold text-slate-900">{roomTypeName(plan.roomTypeId)}</h2>
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
