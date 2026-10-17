// One-off dummy-data loader for the NocoDB tables this service uses.
// Run with: npm run seed  (reads .env via --env-file, see package.json)
import dayjs from "dayjs";
import { v4 as uuid } from "uuid";
import { listRows, createRow, updateRowByBusinessId } from "../src/nocodb.js";
import { hashPassword } from "../src/auth.js";

async function seedIfEmpty(tableKey, rows, build) {
  const existing = await listRows(tableKey);
  if (existing.length) {
    console.log(`- ${tableKey}: đã có ${existing.length} dòng, bỏ qua.`);
    return existing;
  }
  const created = [];
  for (const r of rows) {
    const row = await createRow(tableKey, build(r));
    created.push(row);
    console.log(`+ ${tableKey}: ${row.name || row.username || row.id}`);
  }
  return created;
}

async function main() {
  const roomTypes = await seedIfEmpty(
    "roomTypes",
    [
      { id: "type-standard", name: "Phòng Standard" },
      { id: "type-deluxe", name: "Phòng Deluxe" },
    ],
    (t) => t
  );
  const typeIdByName = Object.fromEntries(roomTypes.map((t) => [t.name, t.id]));
  const standardId = typeIdByName["Phòng Standard"];
  const deluxeId = typeIdByName["Phòng Deluxe"];

  const rooms = await seedIfEmpty(
    "rooms",
    [
      { id: "room-101", name: "101", roomTypeId: standardId, lockId: "mock-lock-101" },
      { id: "room-102", name: "102", roomTypeId: standardId, lockId: "mock-lock-102" },
      { id: "room-201", name: "201", roomTypeId: deluxeId, lockId: "mock-lock-201" },
      { id: "room-202", name: "202", roomTypeId: deluxeId, lockId: "mock-lock-202" },
    ],
    (r) => ({ ...r, status: "empty", active: true })
  );

  await seedIfEmpty(
    "ratePlans",
    [
      {
        id: "rate-standard",
        roomTypeId: standardId,
        hourlyFirstBlockHours: 2,
        hourlyFirstBlockPrice: 150000,
        hourlyExtraPricePerHour: 50000,
        overnightPrice: 250000,
        fullDayPrice: 350000,
        lateCheckoutPricePerHour: 50000,
      },
      {
        id: "rate-deluxe",
        roomTypeId: deluxeId,
        hourlyFirstBlockHours: 2,
        hourlyFirstBlockPrice: 220000,
        hourlyExtraPricePerHour: 70000,
        overnightPrice: 350000,
        fullDayPrice: 480000,
        lateCheckoutPricePerHour: 70000,
      },
    ],
    (p) => p
  );

  await seedIfEmpty(
    "users",
    [
      { id: "user-admin", username: "admin", name: "Quản trị viên", role: "admin", password: "admin123" },
      { id: "user-staff", username: "nhanvien", name: "Nhân viên lễ tân", role: "staff", password: "nhanvien123" },
    ],
    (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, passwordHash: hashPassword(u.password) })
  );

  const existingSettings = await listRows("settings");
  if (!existingSettings.length) {
    await createRow("settings", {
      id: "settings-1",
      bankCode: "MB",
      accountNo: "0123456789",
      accountName: "HOMESTAY DEMO",
      qrNoteTemplate: "Thanh toan phong {room}",
      ownerName: "Chủ homestay demo",
      ownerPhone: "0909123456",
      ownerAddress: "123 Đường Demo, Quận 1, TP.HCM",
    });
    console.log("+ settings: 1 dòng cấu hình mặc định");
  } else {
    console.log("- settings: đã có dữ liệu, bỏ qua.");
  }

  // One finished sample stay so Reports/Guest report show something on
  // first run instead of an empty screen.
  const existingStays = await listRows("stays");
  if (!existingStays.length && rooms.length) {
    const room = rooms[0];
    const checkInAt = dayjs().subtract(3, "hour").toISOString();
    const checkOutAt = dayjs().subtract(1, "hour").toISOString();
    const stay = await createRow("stays", {
      id: uuid(),
      roomId: room.id,
      pricingType: "hourly",
      status: "checked_out",
      checkInAt,
      expectedCheckOutAt: null,
      checkOutAt,
      lockCardId: "mock-card-seed",
    });
    await createRow("guests", {
      id: uuid(),
      stayId: stay.id,
      isMain: true,
      name: "Nguyễn Văn Demo",
      idNumber: "012345678901",
      dob: null, // NocoDB rejects "" for a DATE column
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
    await updateRowByBusinessId("rooms", room.id, { status: "empty" }); // leave it checked-out/clean for demo
    console.log(`+ stays: 1 lượt lưu trú mẫu (đã trả phòng) ở phòng ${room.name}`);
  } else {
    console.log("- stays: đã có dữ liệu hoặc chưa có phòng, bỏ qua lượt lưu trú mẫu.");
  }

  console.log("Xong.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
