// Creates one new homestay (tenant) with starter data: room types, rooms,
// rate plans, an admin + staff account for it, default settings, and one
// finished sample stay. Also ensures a global "owner" account exists (not
// tied to any homestay) so you can log in and create more homestays from
// the UI afterwards.
//
// Run with: npm run seed [Tên homestay]
// (reads .env via --env-file, see package.json; defaults to "Demo")
import dayjs from "dayjs";
import { v4 as uuid } from "uuid";
import { listRows, createRow, findOneWhere } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const homestayName = process.argv[2] || "Demo";

async function ensureOwner() {
  const existing = await findOneWhere("users", "(role,eq,owner)");
  if (existing) {
    console.log(`- owner: đã có sẵn (${existing.username}), bỏ qua.`);
    return;
  }
  await createRow("users", {
    id: uuid(),
    homestayId: null,
    username: "owner",
    name: "Chủ hệ thống",
    role: "owner",
    passwordHash: hashPassword("owner123"),
  });
  console.log("+ owner: tài khoản owner/owner123 (đổi mật khẩu sau khi đăng nhập lần đầu)");
}

async function main() {
  await ensureOwner();

  const homestay = await createRow("homestays", { id: uuid(), name: homestayName });
  console.log(`+ homestays: "${homestay.name}" (${homestay.id})`);
  const homestayId = homestay.id;

  const standard = await createRow("roomTypes", { id: uuid(), homestayId, name: "Phòng Standard" });
  const deluxe = await createRow("roomTypes", { id: uuid(), homestayId, name: "Phòng Deluxe" });
  console.log(`+ roomTypes: ${standard.name}, ${deluxe.name}`);

  const rooms = [];
  for (const r of [
    { name: "101", roomTypeId: standard.id, lockId: "mock-lock-101" },
    { name: "102", roomTypeId: standard.id, lockId: "mock-lock-102" },
    { name: "201", roomTypeId: deluxe.id, lockId: "mock-lock-201" },
    { name: "202", roomTypeId: deluxe.id, lockId: "mock-lock-202" },
  ]) {
    const row = await createRow("rooms", { id: uuid(), homestayId, ...r, status: "empty", active: true });
    rooms.push(row);
  }
  console.log(`+ rooms: ${rooms.map((r) => r.name).join(", ")}`);

  await createRow("ratePlans", {
    id: uuid(),
    homestayId,
    roomTypeId: standard.id,
    hourlyFirstBlockHours: 2,
    hourlyFirstBlockPrice: 150000,
    hourlyExtraPricePerHour: 50000,
    overnightPrice: 250000,
    fullDayPrice: 350000,
    lateCheckoutPricePerHour: 50000,
  });
  await createRow("ratePlans", {
    id: uuid(),
    homestayId,
    roomTypeId: deluxe.id,
    hourlyFirstBlockHours: 2,
    hourlyFirstBlockPrice: 220000,
    hourlyExtraPricePerHour: 70000,
    overnightPrice: 350000,
    fullDayPrice: 480000,
    lateCheckoutPricePerHour: 70000,
  });
  console.log("+ ratePlans: 2 bảng giá mặc định");

  const slug = homestayName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 16) || "homestay";
  await createRow("users", {
    id: uuid(),
    homestayId,
    username: `admin.${slug}`,
    name: `Quản trị viên - ${homestayName}`,
    role: "admin",
    passwordHash: hashPassword("admin123"),
  });
  await createRow("users", {
    id: uuid(),
    homestayId,
    username: `nhanvien.${slug}`,
    name: `Nhân viên lễ tân - ${homestayName}`,
    role: "staff",
    passwordHash: hashPassword("nhanvien123"),
  });
  console.log(`+ users: admin.${slug}/admin123, nhanvien.${slug}/nhanvien123`);

  await createRow("settings", {
    id: uuid(),
    homestayId,
    bankCode: "MB",
    accountNo: "0123456789",
    accountName: homestayName.toUpperCase(),
    qrNoteTemplate: "Thanh toan phong {room}",
    ownerName: `Chủ ${homestayName}`,
    ownerPhone: "0909123456",
    ownerAddress: "123 Đường Demo, Quận 1, TP.HCM",
  });
  console.log("+ settings: 1 dòng cấu hình mặc định");

  // One finished sample stay so Reports/Guest report show something on
  // first run instead of an empty screen.
  const room = rooms[0];
  const checkInAt = dayjs().subtract(3, "hour").toISOString();
  const checkOutAt = dayjs().subtract(1, "hour").toISOString();
  const stay = await createRow("stays", {
    id: uuid(),
    homestayId,
    roomId: room.id,
    pricingType: "hourly",
    status: "checked_out",
    checkInAt,
    expectedCheckOutAt: null,
    checkOutAt,
    lockCardId: `${room.lockId}-card-seed`,
  });
  await createRow("guests", {
    id: uuid(),
    stayId: stay.id,
    isMain: true,
    name: "Nguyễn Văn Demo",
    idNumber: "012345678901",
    dob: null, // Postgres rejects "" for a DATE column
    phone: "0909000000",
  });
  await createRow("serviceCharges", {
    id: uuid(),
    stayId: stay.id,
    kind: "service",
    itemId: "seed-item",
    name: "Nước suối",
    unitPrice: 15000,
    qty: 2,
    amount: 30000,
    addedAt: checkInAt,
  });
  console.log(`+ stays: 1 lượt lưu trú mẫu (đã trả phòng) ở phòng ${room.name}`);

  console.log(`\nXong. Đăng nhập owner/owner123 để xem tất cả homestay, hoặc admin.${slug}/admin123 cho riêng "${homestayName}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
