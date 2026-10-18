// One-off: registers TTLOCK_USERNAME/TTLOCK_PASSWORD as a TTLock Open
// Platform API user under this app's TTLOCK_CLIENT_ID. Only needs to run
// once per username — safe to re-run (TTLock just returns an error if the
// username is already registered).
//
// Run with: npm run ttlock-register-user (reads .env via --env-file)
import { TTLockProvider } from "../src/lockProvider.js";

const { TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD, TTLOCK_BASE_URL } = process.env;

if (!TTLOCK_CLIENT_ID || !TTLOCK_CLIENT_SECRET || !TTLOCK_USERNAME || !TTLOCK_PASSWORD) {
  console.error(
    "Thiếu TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET / TTLOCK_USERNAME / TTLOCK_PASSWORD trong .env — dừng lại."
  );
  process.exit(1);
}

const provider = new TTLockProvider({
  clientId: TTLOCK_CLIENT_ID,
  clientSecret: TTLOCK_CLIENT_SECRET,
  username: TTLOCK_USERNAME,
  password: TTLOCK_PASSWORD,
  baseUrl: TTLOCK_BASE_URL,
});

try {
  await provider.registerUser();
  console.log(`Đã đăng ký user "${TTLOCK_USERNAME}" với TTLock thành công.`);
} catch (err) {
  console.error(`Đăng ký thất bại: ${err.message}`);
  console.error("Nếu lỗi là \"user already exists\" thì bỏ qua được — user này đã sẵn sàng dùng.");
  process.exit(1);
}
