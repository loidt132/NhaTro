import { ID_TYPES } from "../utils/guestValidation.js";
import { input, label } from "../ui.js";

// Identity fields shared by the check-in form and the add-guest form.
// `errors` comes from validateGuest; each field shows its own message.
export default function GuestFields({ value, onChange, errors = {}, main = false }) {
  const set = (field) => (e) => onChange({ ...value, [field]: e.target.value });
  const idIsPassport = value.idType === "passport";

  return (
    <>
      <Field label="Họ tên" error={errors.name}>
        <input value={value.name} onChange={set("name")} placeholder="Nguyễn Văn A" className={input} autoComplete="off" />
      </Field>

      <Field label={main ? "Địa chỉ thường trú" : "Địa chỉ (không bắt buộc)"} error={errors.address}>
        <input value={value.address} onChange={set("address")} placeholder="Số nhà, đường, phường/xã, tỉnh/thành" className={input} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Loại giấy tờ" error={errors.idType}>
          <select value={value.idType} onChange={set("idType")} className={input}>
            {ID_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label={idIsPassport ? "Số hộ chiếu" : "Số CCCD"} error={errors.idNumber}>
          <input
            value={value.idNumber}
            onChange={set("idNumber")}
            inputMode={idIsPassport ? "text" : "numeric"}
            maxLength={idIsPassport ? 9 : 12}
            className={input}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label={idIsPassport ? "Hết hạn hộ chiếu" : "Hết hạn (không bắt buộc)"} error={errors.idExpiryDate}>
          <input type="date" value={value.idExpiryDate} onChange={set("idExpiryDate")} className={input} />
        </Field>
        <Field label={main ? "Số điện thoại" : "Số điện thoại (không bắt buộc)"} error={errors.phone}>
          <input value={value.phone} onChange={set("phone")} inputMode="tel" placeholder="0912345678" className={input} />
        </Field>
      </div>
    </>
  );
}

function Field({ label: text, error, children }) {
  return (
    <div className="min-w-0 space-y-1">
      <label className={label}>{text}</label>
      {children}
      {error && <div className="text-xs text-rose-600">{error}</div>}
    </div>
  );
}
