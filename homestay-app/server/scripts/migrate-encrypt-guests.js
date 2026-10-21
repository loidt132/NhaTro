// One-off: encrypts idNumber/phone for every existing "guests" row in
// Postgres. nocodb.js already encrypts on write and decrypts on read going
// forward (see src/cryptoFields.js) — this just re-saves every row once so
// rows written before that change get encrypted too, instead of waiting on
// their next organic update.
//
// Run with: npm run migrate-encrypt-guests (reads .env via --env-file)
import { listRows, updateRowByBusinessId } from "../src/db.js";
import { isEncryptionConfigured } from "../src/cryptoFields.js";

if (!isEncryptionConfigured()) {
  console.error("ENCRYPTION_KEY chưa được cấu hình trong .env — dừng lại.");
  process.exit(1);
}

const guests = await listRows("guests", { limit: 1000 });
console.log(`Tìm thấy ${guests.length} guest(s).`);

let updated = 0;
for (const guest of guests) {
  await updateRowByBusinessId("guests", guest.id, {
    idNumber: guest.idNumber || "",
    phone: guest.phone || "",
  });
  updated += 1;
}

console.log(`Đã mã hoá lại idNumber/phone cho ${updated} guest(s).`);
