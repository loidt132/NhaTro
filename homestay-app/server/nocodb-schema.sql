-- homestay-server schema for NocoDB / SQL import.
-- Multi-tenant: one deployment runs several homestays (properties), each
-- isolated by the homestayId column added to every table below except
-- guests/serviceCharges/roomTransfers/lockEventsLog (only ever reached
-- through an already-scoped stayId, so adding it there would be redundant).
-- Column names match the JS objects in server/src/index.js field-for-field
-- so wiring NocoDB calls is a straight rename-free mapping.
--
-- IMPORTANT: do not add `homestayId` (or any new table) by re-running this
-- file through NocoDB's SQL-import wizard — it silently turns any `xxxId`
-- column matching another table's name into a LinkToAnotherRecord relation
-- instead of a plain column, which then drops every value written to it.
-- Add `homestays` and every `homestayId` column by hand in the NocoDB UI as
-- plain "Single line text" fields, then run
-- `npm run fix-links` (scripts/fix-link-columns.js) as a safety net.

CREATE TABLE IF NOT EXISTS homestays (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'staff', -- 'admin' | 'staff'
  passwordHash TEXT NOT NULL, -- scrypt, stored as "salt:hash"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (username);

CREATE TABLE IF NOT EXISTS roomTypes (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  roomTypeId VARCHAR(64) NOT NULL,
  lockId VARCHAR(128), -- TTLock device id for this room's door, blank if unassigned
  status VARCHAR(20) NOT NULL DEFAULT 'empty', -- 'empty' | 'occupied' | 'cleaning'
  active BOOLEAN NOT NULL DEFAULT TRUE, -- false = "ngừng sử dụng", hidden from new check-ins
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rooms_room_type ON rooms (roomTypeId);

CREATE TABLE IF NOT EXISTS ratePlans (
  id VARCHAR(64) PRIMARY KEY,
  roomTypeId VARCHAR(64) NOT NULL,
  hourlyFirstBlockHours INT NOT NULL DEFAULT 2,
  hourlyFirstBlockPrice BIGINT NOT NULL DEFAULT 0,
  hourlyExtraPricePerHour BIGINT NOT NULL DEFAULT 0,
  overnightPrice BIGINT NOT NULL DEFAULT 0,
  fullDayPrice BIGINT NOT NULL DEFAULT 0,
  lateCheckoutPricePerHour BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_plans_room_type_unique ON ratePlans (roomTypeId);

-- One stay = one guest's booking of a room from check-in to check-out.
-- Room transfers mid-stay do NOT create a new stay row — see roomTransfers.
CREATE TABLE IF NOT EXISTS stays (
  id VARCHAR(64) PRIMARY KEY,
  roomId VARCHAR(64) NOT NULL, -- current room (updated on transfer)
  pricingType VARCHAR(20) NOT NULL, -- 'hourly' | 'overnight' | 'fullday'
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'checked_out'
  checkInAt TIMESTAMP NOT NULL,
  expectedCheckOutAt TIMESTAMP,
  checkOutAt TIMESTAMP,
  lockCardId VARCHAR(128), -- TTLock card id issued at check-in (mock or real)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stays_room ON stays (roomId);
CREATE INDEX IF NOT EXISTS idx_stays_status ON stays (status);
CREATE INDEX IF NOT EXISTS idx_stays_check_in ON stays (checkInAt);
CREATE INDEX IF NOT EXISTS idx_stays_check_out ON stays (checkOutAt);

CREATE TABLE IF NOT EXISTS guests (
  id VARCHAR(64) PRIMARY KEY,
  stayId VARCHAR(64) NOT NULL,
  isMain BOOLEAN NOT NULL DEFAULT FALSE,
  name VARCHAR(255) NOT NULL,
  idNumber VARCHAR(50), -- CCCD/hộ chiếu, needed for lưu trú reporting
  dob DATE,
  phone VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guests_stay ON guests (stayId);

-- Dịch vụ AND phụ thu lines added to a stay — kind distinguishes them, both
-- snapshot their name/unitPrice from catalog-service at the moment they were
-- added so a later price change there never alters a past/active invoice.
CREATE TABLE IF NOT EXISTS serviceCharges (
  id VARCHAR(64) PRIMARY KEY,
  stayId VARCHAR(64) NOT NULL,
  kind VARCHAR(20) NOT NULL, -- 'service' | 'surcharge'
  itemId VARCHAR(64) NOT NULL, -- catalog-service item id
  name VARCHAR(255) NOT NULL,
  unitPrice BIGINT NOT NULL DEFAULT 0,
  qty INT NOT NULL DEFAULT 1,
  amount BIGINT NOT NULL DEFAULT 0,
  addedAt TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_charges_stay ON serviceCharges (stayId);

-- Pure audit trail of room moves within one stay — never used to re-price
-- the stay (room pricing always uses one continuous duration, see
-- server/src/pricing.js). Kept purely for front-desk/ops record keeping.
CREATE TABLE IF NOT EXISTS roomTransfers (
  id VARCHAR(64) PRIMARY KEY,
  stayId VARCHAR(64) NOT NULL,
  fromRoomId VARCHAR(64) NOT NULL,
  toRoomId VARCHAR(64) NOT NULL,
  reason TEXT,
  transferredAt TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_room_transfers_stay ON roomTransfers (stayId);

-- Raw TTLock card-swipe / simulate-swipe events, for audit/debug only — not
-- read by any pricing or booking logic.
CREATE TABLE IF NOT EXISTS lockEventsLog (
  id VARCHAR(64) PRIMARY KEY,
  stayId VARCHAR(64) NOT NULL,
  lockCardId VARCHAR(128),
  type VARCHAR(50) NOT NULL,
  at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lock_events_stay ON lockEventsLog (stayId);

-- One settings row per homestay (payment QR info + owner info), same shape
-- as nhà trọ's settings table minus the per-landlord created_by column.
CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(64) PRIMARY KEY,
  bankCode VARCHAR(50),
  accountNo VARCHAR(100),
  accountName VARCHAR(255),
  qrNoteTemplate TEXT,
  ownerName VARCHAR(255),
  ownerPhone VARCHAR(32),
  ownerAddress TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Multi-tenant columns. NULL homestayId on a user means role='owner' (sees
-- every homestay, not pinned to one). See the warning at the top of this
-- file before adding these in NocoDB.
ALTER TABLE users ADD COLUMN IF NOT EXISTS homestayId VARCHAR(64);
ALTER TABLE roomTypes ADD COLUMN IF NOT EXISTS homestayId VARCHAR(64) NOT NULL;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS homestayId VARCHAR(64) NOT NULL;
ALTER TABLE ratePlans ADD COLUMN IF NOT EXISTS homestayId VARCHAR(64) NOT NULL;
ALTER TABLE stays ADD COLUMN IF NOT EXISTS homestayId VARCHAR(64) NOT NULL;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS homestayId VARCHAR(64) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_homestay ON users (homestayId);
CREATE INDEX IF NOT EXISTS idx_room_types_homestay ON roomTypes (homestayId);
CREATE INDEX IF NOT EXISTS idx_rooms_homestay ON rooms (homestayId);
CREATE INDEX IF NOT EXISTS idx_rate_plans_homestay ON ratePlans (homestayId);
CREATE INDEX IF NOT EXISTS idx_stays_homestay ON stays (homestayId);
CREATE INDEX IF NOT EXISTS idx_settings_homestay ON settings (homestayId);
