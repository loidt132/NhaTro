-- Multi-user schema for NocoDB / SQL import
-- Every business row belongs to one authenticated user via created_by.
-- modified_by stores the last user that changed the row.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(32),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role VARCHAR(32) DEFAULT 'user',
  isActive BOOLEAN NOT NULL DEFAULT TRUE,
  maxRoomLimit INT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users (phone);

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL,
  baseRent BIGINT DEFAULT 0,
  electricRate BIGINT DEFAULT 0,
  waterRate BIGINT DEFAULT 0,
  tuyaDeviceId VARCHAR(128),
  primaryTenantId VARCHAR(64),
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Keep existing rooms tables compatible with the Tuya meter mapping.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS tuyaDeviceId VARCHAR(128);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS createdAt TIMESTAMP;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS updatedAt TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON rooms (created_by);

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  cccd VARCHAR(32),
  phone VARCHAR(32),
  roomId VARCHAR(64),
  startDate DATE,
  endDate DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenants_created_by ON tenants (created_by);
CREATE INDEX IF NOT EXISTS idx_tenants_room_id ON tenants (roomId);

-- Contract and deposit ledger. The current payment screen can be introduced
-- incrementally while these records preserve the correct ownership model.
CREATE TABLE IF NOT EXISTS rental_contracts (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  tenantId VARCHAR(64) NOT NULL,
  roomId VARCHAR(64) NOT NULL,
  startDate DATE,
  endDate DATE,
  monthlyRent BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON rental_contracts (tenantId);
CREATE INDEX IF NOT EXISTS idx_contracts_room ON rental_contracts (roomId);

CREATE TABLE IF NOT EXISTS deposits (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  contractId VARCHAR(64),
  roomId VARCHAR(64),
  tenantId VARCHAR(64),
  amount BIGINT NOT NULL DEFAULT 0,
  remainingAmount BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'held',
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deposit_transactions (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  depositId VARCHAR(64) NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0,
  type VARCHAR(30) NOT NULL,
  note TEXT,
  occurredAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS roomId VARCHAR(64);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS tenantId VARCHAR(64);
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS remainingAmount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE deposits ALTER COLUMN contractId DROP NOT NULL;

CREATE TABLE IF NOT EXISTS deposit_refunds (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  depositId VARCHAR(64) NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0,
  method VARCHAR(100),
  note TEXT,
  refundedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS readings (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  roomId VARCHAR(64) NOT NULL,
  month VARCHAR(7) NOT NULL,
  electricStart NUMERIC(14,3) DEFAULT 0,
  electricEnd NUMERIC(14,3) DEFAULT 0,
  waterStart BIGINT DEFAULT 0,
  waterEnd BIGINT DEFAULT 0,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CREATE TABLE IF NOT EXISTS does not add columns to an existing table.
-- Keep older readings tables compatible with the current application payload.
ALTER TABLE readings ADD COLUMN IF NOT EXISTS createdAt TIMESTAMP;
ALTER TABLE readings ADD COLUMN IF NOT EXISTS updatedAt TIMESTAMP;
ALTER TABLE readings ALTER COLUMN electricStart TYPE NUMERIC(14,3) USING electricStart::numeric;
ALTER TABLE readings ALTER COLUMN electricEnd TYPE NUMERIC(14,3) USING electricEnd::numeric;

CREATE INDEX IF NOT EXISTS idx_readings_created_by ON readings (created_by);
CREATE INDEX IF NOT EXISTS idx_readings_room_month ON readings (roomId, month);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  roomId VARCHAR(64) NOT NULL,
  tenantId VARCHAR(64),
  month VARCHAR(7) NOT NULL,
  rent BIGINT DEFAULT 0,
  electricUsage NUMERIC(14,3) DEFAULT 0,
  electricStart NUMERIC(14,3) DEFAULT 0,
  electricEnd NUMERIC(14,3) DEFAULT 0,
  electricAmount BIGINT DEFAULT 0,
  waterUsage BIGINT DEFAULT 0,
  waterStart BIGINT DEFAULT 0,
  waterEnd BIGINT DEFAULT 0,
  waterAmount BIGINT DEFAULT 0,
  other BIGINT DEFAULT 0,
  total BIGINT DEFAULT 0,
  status VARCHAR(50),
  paidAt TIMESTAMP, 
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_room_month ON invoices (roomId, month);

ALTER TABLE invoices ALTER COLUMN electricUsage TYPE NUMERIC(14,3) USING electricUsage::numeric;
ALTER TABLE invoices ALTER COLUMN electricStart TYPE NUMERIC(14,3) USING electricStart::numeric;
ALTER TABLE invoices ALTER COLUMN electricEnd TYPE NUMERIC(14,3) USING electricEnd::numeric;

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  invoiceId VARCHAR(64),
  roomId VARCHAR(64),
  tenantId VARCHAR(64),
  amount BIGINT DEFAULT 0,
  method VARCHAR(100),
  note TEXT,
  paidAt TIMESTAMP,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_created_by ON payments (created_by);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments (invoiceId);
ALTER TABLE payments ALTER COLUMN invoiceId DROP NOT NULL;

-- A rent period is one monthly rent obligation. It can be paid before that
-- month's utility invoice is created.
CREATE TABLE IF NOT EXISTS rent_periods (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  roomId VARCHAR(64) NOT NULL,
  tenantId VARCHAR(64),
  month VARCHAR(7) NOT NULL,
  rent BIGINT NOT NULL DEFAULT 0,
  invoiceId VARCHAR(64),
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rent_periods_room_month ON rent_periods (roomId, month);

-- Each allocation applies part of one received payment to one rent period.
CREATE TABLE IF NOT EXISTS payment_allocations (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  paymentId VARCHAR(64) NOT NULL,
  rentPeriodId VARCHAR(64) NOT NULL,
  invoiceId VARCHAR(64),
  amount BIGINT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations (paymentId);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_period ON payment_allocations (rentPeriodId);

CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  bankCode VARCHAR(50),
  accountNo VARCHAR(100),
  accountName VARCHAR(255),
  qrNoteTemplate TEXT,
  landlordName VARCHAR(255),
  landlordPhone VARCHAR(32),
  landlordAddress TEXT,
  useTuyaMonthlyUsage BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Safe for databases created before the Tuya monthly-usage setting existed.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS useTuyaMonthlyUsage BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_settings_created_by ON settings (created_by);
