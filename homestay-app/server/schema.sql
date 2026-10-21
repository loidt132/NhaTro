-- homestay-server schema for PostgreSQL (Neon / Supabase / any Postgres).
-- Multi-tenant: one deployment runs several homestays (properties), each
-- isolated by the "homestayId" column on every table below except
-- guests/serviceCharges/roomTransfers/lockEventsLog (only ever reached
-- through an already-scoped stayId).
-- Identifiers are quoted camelCase so they match the JS objects in
-- src/index.js field-for-field. Apply with: npm run migrate

CREATE TABLE IF NOT EXISTS homestays (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  "maxRooms" INT, -- owner-configured cap on rooms; NULL = unlimited
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- NULL homestayId on a user means role='owner' (sees every homestay).
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64),
  username VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'staff', -- 'owner' | 'admin' | 'staff'
  "passwordHash" TEXT NOT NULL, -- scrypt, stored as "salt:hash"
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_homestay ON users ("homestayId");

CREATE TABLE IF NOT EXISTS "roomTypes" (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_types_homestay ON "roomTypes" ("homestayId");

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL,
  "roomTypeId" VARCHAR(64) NOT NULL,
  "lockId" VARCHAR(128), -- TTLock device id for this room's door
  status VARCHAR(20) NOT NULL DEFAULT 'empty', -- 'empty' | 'occupied' | 'cleaning'
  active BOOLEAN NOT NULL DEFAULT TRUE, -- false = "ngừng sử dụng"
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rooms_room_type ON rooms ("roomTypeId");
CREATE INDEX IF NOT EXISTS idx_rooms_homestay ON rooms ("homestayId");

CREATE TABLE IF NOT EXISTS "ratePlans" (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64) NOT NULL,
  "roomTypeId" VARCHAR(64) NOT NULL,
  "hourlyFirstBlockHours" INT NOT NULL DEFAULT 2,
  "hourlyFirstBlockPrice" BIGINT NOT NULL DEFAULT 0,
  "hourlyExtraPricePerHour" BIGINT NOT NULL DEFAULT 0,
  "overnightPrice" BIGINT NOT NULL DEFAULT 0,
  "fullDayPrice" BIGINT NOT NULL DEFAULT 0,
  "lateCheckoutPricePerHour" BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_plans_room_type_unique ON "ratePlans" ("roomTypeId");
CREATE INDEX IF NOT EXISTS idx_rate_plans_homestay ON "ratePlans" ("homestayId");

-- One stay = one guest's booking of a room from check-in to check-out.
-- Room transfers mid-stay do NOT create a new stay row.
CREATE TABLE IF NOT EXISTS stays (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64) NOT NULL,
  "roomId" VARCHAR(64) NOT NULL, -- current room (updated on transfer)
  "pricingType" VARCHAR(20) NOT NULL, -- 'hourly' | 'overnight' | 'fullday'
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'checked_out'
  "checkInAt" TIMESTAMPTZ NOT NULL,
  "expectedCheckOutAt" TIMESTAMPTZ,
  "checkOutAt" TIMESTAMPTZ,
  "lockCardId" VARCHAR(128), -- TTLock card id issued at check-in
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stays_room ON stays ("roomId");
CREATE INDEX IF NOT EXISTS idx_stays_status ON stays (status);
CREATE INDEX IF NOT EXISTS idx_stays_check_in ON stays ("checkInAt");
CREATE INDEX IF NOT EXISTS idx_stays_check_out ON stays ("checkOutAt");
CREATE INDEX IF NOT EXISTS idx_stays_homestay ON stays ("homestayId");

-- idNumber/phone hold AES-GCM ciphertext (see src/cryptoFields.js), which is
-- longer than the plaintext — keep them TEXT.
CREATE TABLE IF NOT EXISTS guests (
  id VARCHAR(64) PRIMARY KEY,
  "stayId" VARCHAR(64) NOT NULL,
  "isMain" BOOLEAN NOT NULL DEFAULT FALSE,
  name VARCHAR(255) NOT NULL,
  "idNumber" TEXT,
  dob DATE,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guests_stay ON guests ("stayId");

-- Dịch vụ AND phụ thu lines added to a stay; name/unitPrice are snapshots
-- from catalog-service at the moment they were added.
CREATE TABLE IF NOT EXISTS "serviceCharges" (
  id VARCHAR(64) PRIMARY KEY,
  "stayId" VARCHAR(64) NOT NULL,
  kind VARCHAR(20) NOT NULL, -- 'service' | 'surcharge'
  "itemId" VARCHAR(64) NOT NULL, -- catalog-service item id
  name VARCHAR(255) NOT NULL,
  "unitPrice" BIGINT NOT NULL DEFAULT 0,
  qty INT NOT NULL DEFAULT 1,
  amount BIGINT NOT NULL DEFAULT 0,
  "addedAt" TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_charges_stay ON "serviceCharges" ("stayId");

-- Audit trail of room moves within one stay (never used to re-price).
CREATE TABLE IF NOT EXISTS "roomTransfers" (
  id VARCHAR(64) PRIMARY KEY,
  "stayId" VARCHAR(64) NOT NULL,
  "fromRoomId" VARCHAR(64) NOT NULL,
  "toRoomId" VARCHAR(64) NOT NULL,
  reason TEXT,
  "transferredAt" TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_room_transfers_stay ON "roomTransfers" ("stayId");

-- Raw TTLock card-swipe events, for audit/debug only.
CREATE TABLE IF NOT EXISTS "lockEventsLog" (
  id VARCHAR(64) PRIMARY KEY,
  "stayId" VARCHAR(64) NOT NULL,
  "lockCardId" VARCHAR(128),
  type VARCHAR(50) NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lock_events_stay ON "lockEventsLog" ("stayId");

-- One settings row per homestay (payment QR info + owner info).
CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64) NOT NULL,
  "bankCode" VARCHAR(50),
  "accountNo" VARCHAR(100),
  "accountName" VARCHAR(255),
  "qrNoteTemplate" TEXT,
  "ownerName" VARCHAR(255),
  "ownerPhone" VARCHAR(32),
  "ownerAddress" TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settings_homestay ON settings ("homestayId");
