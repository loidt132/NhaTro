// Same rules as server/src/guestValidation.js — change both together.
import dayjs from "dayjs";

export const ID_TYPES = [
  { value: "cccd", label: "CCCD" },
  { value: "passport", label: "Hộ chiếu" },
];

const NAME_RE = /^\p{L}[\p{L}\s.'-]*$/u;
const CCCD_RE = /^\d{12}$/;
const PASSPORT_RE = /^[A-Z0-9]{6,9}$/;
const PHONE_RE = /^(\+84|0)(3|5|7|8|9)\d{8}$/;

export function normalizePhone(value) {
  return String(value || "").replace(/[\s.-]/g, "");
}

export function normalizeIdNumber(value) {
  return String(value || "").replace(/\s/g, "").toUpperCase();
}

// Date typed as dd/mm/yyyy. The form keeps this text; the API gets YYYY-MM-DD.
export function formatDmyInput(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `/${digits.slice(4)}`;
  return out;
}

export function parseDmy(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text || ""));
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return dayjs(iso, "YYYY-MM-DD", true).isValid() ? iso : null;
}

// Form state -> body for the API (dates converted to YYYY-MM-DD).
export function toApiGuest(guest) {
  return { ...guest, idExpiryDate: parseDmy(guest.idExpiryDate) || "" };
}

// Returns { field: message } for each invalid field, {} when valid.
export function validateGuest(guest, { today = dayjs() } = {}) {
  const errors = {};

  const name = String(guest.name || "").trim();
  if (!name) errors.name = "Vui lòng nhập họ tên";
  else if (name.length < 2 || name.length > 100 || !NAME_RE.test(name)) {
    errors.name = "Họ tên chỉ gồm chữ cái, dài 2–100 ký tự";
  }

  const phone = normalizePhone(guest.phone);
  if (!phone) {
    errors.phone = "Vui lòng nhập số điện thoại";
  } else if (!PHONE_RE.test(phone)) {
    errors.phone = "Số điện thoại không hợp lệ (VD: 0912345678)";
  }

  const address = String(guest.address || "").trim();
  if (!address) {
    errors.address = "Vui lòng nhập địa chỉ thường trú";
  } else if (address.length < 5 || address.length > 255) {
    errors.address = "Địa chỉ dài 5–255 ký tự";
  }

  const idType = guest.idType || "cccd";
  if (!ID_TYPES.some((t) => t.value === idType)) errors.idType = "Loại giấy tờ không hợp lệ";

  const idNumber = normalizeIdNumber(guest.idNumber);
  if (!idNumber) {
    errors.idNumber = "Vui lòng nhập số giấy tờ";
  } else if (idType === "cccd" && !CCCD_RE.test(idNumber)) {
    errors.idNumber = "CCCD gồm đúng 12 chữ số";
  } else if (idType === "passport" && !PASSPORT_RE.test(idNumber)) {
    errors.idNumber = "Số hộ chiếu gồm 6–9 chữ hoặc số";
  }

  if (idType === "passport" && !guest.idExpiryDate) {
    errors.idExpiryDate = "Vui lòng nhập ngày hết hạn hộ chiếu";
  } else if (guest.idExpiryDate) {
    const iso = parseDmy(guest.idExpiryDate);
    if (!iso) errors.idExpiryDate = "Ngày hết hạn dạng dd/mm/yyyy";
    else if (idType === "passport" && !dayjs(iso).isAfter(today, "day")) errors.idExpiryDate = "Hộ chiếu đã hết hạn";
  }

  return errors;
}
