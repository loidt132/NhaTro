import dayjs from "dayjs";

// Rules for a guest's identity data. The web app keeps a copy in
// web/src/utils/guestValidation.js — change both together.
export const ID_TYPES = ["cccd", "passport"];

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

// Returns { field: message } for each invalid field, {} when valid.
// Every field is required, for the main guest and companions alike.
// A CCCD expiry only has to be a valid date; a passport must have an expiry
// date that is still in the future.
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
  if (!ID_TYPES.includes(idType)) errors.idType = "Loại giấy tờ không hợp lệ";

  const idNumber = normalizeIdNumber(guest.idNumber);
  if (!idNumber) {
    errors.idNumber = "Vui lòng nhập số giấy tờ";
  } else if (idType === "cccd" && !CCCD_RE.test(idNumber)) {
    errors.idNumber = "CCCD gồm đúng 12 chữ số";
  } else if (idType === "passport" && !PASSPORT_RE.test(idNumber)) {
    errors.idNumber = "Số hộ chiếu gồm 6–9 chữ hoặc số";
  }

  if (!guest.idExpiryDate) {
    errors.idExpiryDate = "Vui lòng nhập ngày hết hạn giấy tờ";
  } else {
    const expiry = dayjs(guest.idExpiryDate);
    if (!expiry.isValid()) errors.idExpiryDate = "Ngày hết hạn không hợp lệ";
    else if (idType === "passport" && !expiry.isAfter(today, "day")) errors.idExpiryDate = "Hộ chiếu đã hết hạn";
  }

  return errors;
}

// Trims and normalizes what gets stored, so the checks and the saved row agree.
export function cleanGuestInput(body) {
  return {
    name: String(body.name || "").trim().replace(/\s+/g, " "),
    idType: body.idType || "cccd",
    idNumber: normalizeIdNumber(body.idNumber),
    address: String(body.address || "").trim().replace(/\s+/g, " "),
    idExpiryDate: body.idExpiryDate || null, // "" is not a valid DATE
    phone: normalizePhone(body.phone),
    dob: body.dob || null, // "" is not a valid DATE
  };
}
