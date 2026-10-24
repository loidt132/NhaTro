import { ID_TYPES, formatDmyInput } from "../utils/guestValidation.js";
import { input, label } from "../ui.js";

// Identity fields shared by the check-in form and the add-guest form.
// `errors` comes from validateGuest; each field shows its own message.
export default function GuestFields({ value, onChange, errors = {} }) {
  const set = (field) => (e) => onChange({ ...value, [field]: e.target.value });
  const idIsPassport = value.idType === "passport";

  return (
    <>
      <Field label="Họ tên" error={errors.name}>
        <input value={value.name} onChange={set("name")} placeholder="Nguyễn Văn A" className={input} autoComplete="off" />
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
        <Field label="Hết hạn" required={idIsPassport} error={errors.idExpiryDate}>
          <input
            value={value.idExpiryDate}
            onChange={(e) => onChange({ ...value, idExpiryDate: formatDmyInput(e.target.value) })}
            inputMode="numeric"
            placeholder="dd/mm/yyyy"
            maxLength={10}
            className={input}
          />
        </Field>
        <Field label="Số điện thoại" error={errors.phone}>
          <input value={value.phone} onChange={set("phone")} inputMode="tel" placeholder="0912345678" className={input} />
        </Field>
      </div>

      <Field label="Địa chỉ thường trú" error={errors.address}>
        <input value={value.address} onChange={set("address")} placeholder="Số nhà, đường, phường/xã, tỉnh/thành" className={input} />
      </Field>
    </>
  );
}

function Field({ label: text, error, required = true, children }) {
  return (
    <div className="min-w-0 space-y-1">
      <label className={label}>{text}{required && <span className="text-rose-600"> *</span>}</label>
      {children}
      {error && <div className="text-xs text-rose-600">{error}</div>}
    </div>
  );
}
