-- nhatro-unified schema for PostgreSQL (Neon). Apply with: npm run migrate
-- Column names are camelCase (quoted) to match the JS objects field-for-field;
-- created_at/updated_at are bookkeeping. Every business row belongs to one
-- landlord via created_by; deletes are soft ("isDeleted").
-- App-level instants (createdAt, paidAt, ...) are TEXT so values round-trip
-- exactly as the browser sent them (ISO string or date-only string).

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone TEXT, -- AES-GCM ciphertext (random IV) when ENCRYPTION_KEY is set
  "passwordHash" TEXT,
  "passwordSalt" TEXT,
  password TEXT, -- legacy plaintext column from old NocoDB rows (verifyPassword fallback)
  role VARCHAR(32) DEFAULT 'user',
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "maxRoomLimit" INT,
  "landlordId" VARCHAR(64),
  "linkedTenantId" VARCHAR(64),
  "linkedRoomId" VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (email) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  name VARCHAR(100),
  "baseRent" BIGINT DEFAULT 0,
  "electricRate" BIGINT DEFAULT 0,
  "waterRate" BIGINT DEFAULT 0,
  "tuyaDeviceId" VARCHAR(128),
  "primaryTenantId" VARCHAR(64),
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON rooms (created_by);

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  name VARCHAR(255),
  cccd TEXT,
  phone TEXT,
  "roomId" VARCHAR(64),
  "startDate" DATE,
  "endDate" DATE,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_created_by ON tenants (created_by);
CREATE INDEX IF NOT EXISTS idx_tenants_roomid ON tenants ("roomId");

CREATE TABLE IF NOT EXISTS rental_contracts (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "tenantId" VARCHAR(64),
  "roomId" VARCHAR(64),
  "startDate" DATE,
  "endDate" DATE,
  "monthlyRent" BIGINT DEFAULT 0,
  status VARCHAR(30) DEFAULT 'active',
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_created_by ON rental_contracts (created_by);

CREATE TABLE IF NOT EXISTS deposits (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "contractId" VARCHAR(64),
  "roomId" VARCHAR(64),
  "tenantId" VARCHAR(64),
  amount BIGINT DEFAULT 0,
  "remainingAmount" BIGINT DEFAULT 0,
  status VARCHAR(30) DEFAULT 'held',
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposits_created_by ON deposits (created_by);

CREATE TABLE IF NOT EXISTS deposit_transactions (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "depositId" VARCHAR(64),
  amount BIGINT DEFAULT 0,
  type VARCHAR(30),
  note TEXT,
  "occurredAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposit_transactions_created_by ON deposit_transactions (created_by);

CREATE TABLE IF NOT EXISTS deposit_refunds (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "depositId" VARCHAR(64),
  amount BIGINT DEFAULT 0,
  method VARCHAR(100),
  note TEXT,
  "refundedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposit_refunds_created_by ON deposit_refunds (created_by);

CREATE TABLE IF NOT EXISTS readings (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "roomId" VARCHAR(64),
  month VARCHAR(7),
  "electricStart" NUMERIC(14,3) DEFAULT 0,
  "electricEnd" NUMERIC(14,3) DEFAULT 0,
  "waterStart" BIGINT DEFAULT 0,
  "waterEnd" BIGINT DEFAULT 0,
  "electricPhotoUrl" TEXT,
  "waterPhotoUrl" TEXT,
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_readings_created_by ON readings (created_by);
CREATE INDEX IF NOT EXISTS idx_readings_roomid ON readings ("roomId");

CREATE TABLE IF NOT EXISTS meter_submissions (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "roomId" VARCHAR(64),
  month VARCHAR(7),
  "meterType" VARCHAR(20),
  "photoUrl" TEXT,
  "ocrRawText" TEXT,
  "ocrValue" NUMERIC(14,3),
  "finalValue" NUMERIC(14,3),
  status VARCHAR(20) DEFAULT 'pending',
  "submittedByRole" VARCHAR(20) DEFAULT 'tenant',
  "submittedByUserId" VARCHAR(64),
  "submittedByName" VARCHAR(255),
  "reviewedByUserId" VARCHAR(64),
  "reviewedAt" TEXT,
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meter_submissions_created_by ON meter_submissions (created_by);
CREATE INDEX IF NOT EXISTS idx_meter_submissions_roomid ON meter_submissions ("roomId");
CREATE INDEX IF NOT EXISTS idx_meter_submissions_status ON meter_submissions ("status");

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "roomId" VARCHAR(64),
  "tenantId" VARCHAR(64),
  month VARCHAR(7),
  rent BIGINT DEFAULT 0,
  "electricUsage" NUMERIC(14,3) DEFAULT 0,
  "electricStart" NUMERIC(14,3) DEFAULT 0,
  "electricEnd" NUMERIC(14,3) DEFAULT 0,
  "electricAmount" BIGINT DEFAULT 0,
  "waterUsage" BIGINT DEFAULT 0,
  "waterStart" BIGINT DEFAULT 0,
  "waterEnd" BIGINT DEFAULT 0,
  "waterAmount" BIGINT DEFAULT 0,
  other BIGINT DEFAULT 0,
  total BIGINT DEFAULT 0,
  status VARCHAR(50),
  "paidAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_roomid ON invoices ("roomId");

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "invoiceId" VARCHAR(64),
  "roomId" VARCHAR(64),
  "tenantId" VARCHAR(64),
  amount BIGINT DEFAULT 0,
  method VARCHAR(100),
  note TEXT,
  "paidAt" TEXT,
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_created_by ON payments (created_by);
CREATE INDEX IF NOT EXISTS idx_payments_invoiceid ON payments ("invoiceId");

CREATE TABLE IF NOT EXISTS rent_periods (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "roomId" VARCHAR(64),
  "tenantId" VARCHAR(64),
  month VARCHAR(7),
  rent BIGINT DEFAULT 0,
  "invoiceId" VARCHAR(64),
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rent_periods_created_by ON rent_periods (created_by);
CREATE INDEX IF NOT EXISTS idx_rent_periods_roomid ON rent_periods ("roomId");

CREATE TABLE IF NOT EXISTS payment_allocations (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "paymentId" VARCHAR(64),
  "rentPeriodId" VARCHAR(64),
  "invoiceId" VARCHAR(64),
  amount BIGINT DEFAULT 0,
  "createdAt" TEXT,
  "updatedAt" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_created_by ON payment_allocations (created_by);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_paymentid ON payment_allocations ("paymentId");
CREATE INDEX IF NOT EXISTS idx_payment_allocations_rentperiodid ON payment_allocations ("rentPeriodId");

CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  "bankCode" VARCHAR(50),
  "accountNo" VARCHAR(100),
  "accountName" VARCHAR(255),
  "qrNoteTemplate" TEXT,
  "landlordName" VARCHAR(255),
  "landlordPhone" VARCHAR(32),
  "landlordAddress" TEXT,
  "useTuyaMonthlyUsage" BOOLEAN NOT NULL DEFAULT FALSE,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settings_created_by ON settings (created_by);

