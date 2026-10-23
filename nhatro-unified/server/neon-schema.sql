-- nhatro-unified schema for PostgreSQL (Neon). Apply with: npm run migrate-to-neon
-- (idempotent — safe to re-run). Column names are quoted camelCase so they match
-- the JS objects the web app sends, field for field.
-- Every business row belongs to one user via created_by; deleted rows are soft
-- deleted via "isDeleted" (same behaviour the NocoDB version had).
-- Money / meter values are NUMERIC (node-pg returns them as JS numbers).

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT, -- AES-GCM encrypted at rest (see cryptoFields.js)
  password_hash TEXT,
  password_salt TEXT,
  role VARCHAR(32) DEFAULT 'user',
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "maxRoomLimit" INT,
  "landlordId" VARCHAR(64),
  "linkedTenantId" VARCHAR(64),
  "linkedRoomId" VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Tenant accounts are phone-only (email ''), so only real emails must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_users_linked_tenant ON users ("linkedTenantId");

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "name" TEXT,
  "baseRent" NUMERIC,
  "electricRate" NUMERIC,
  "waterRate" NUMERIC,
  "tuyaDeviceId" TEXT,
  "primaryTenantId" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rooms_created_by ON rooms (created_by);

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "name" TEXT,
  "cccd" TEXT,
  "phone" TEXT,
  "roomId" TEXT,
  "startDate" DATE,
  "endDate" DATE,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_created_by ON tenants (created_by);
CREATE INDEX IF NOT EXISTS idx_tenants_roomId ON tenants ("roomId");

CREATE TABLE IF NOT EXISTS rental_contracts (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "tenantId" TEXT,
  "roomId" TEXT,
  "startDate" DATE,
  "endDate" DATE,
  "monthlyRent" NUMERIC,
  "status" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_created_by ON rental_contracts (created_by);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_tenantId ON rental_contracts ("tenantId");
CREATE INDEX IF NOT EXISTS idx_rental_contracts_roomId ON rental_contracts ("roomId");

CREATE TABLE IF NOT EXISTS deposits (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "contractId" TEXT,
  "roomId" TEXT,
  "tenantId" TEXT,
  "amount" NUMERIC,
  "remainingAmount" NUMERIC,
  "status" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposits_created_by ON deposits (created_by);

CREATE TABLE IF NOT EXISTS deposit_transactions (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "depositId" TEXT,
  "amount" NUMERIC,
  "type" TEXT,
  "note" TEXT,
  "occurredAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposit_transactions_created_by ON deposit_transactions (created_by);

CREATE TABLE IF NOT EXISTS deposit_refunds (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "depositId" TEXT,
  "amount" NUMERIC,
  "method" TEXT,
  "note" TEXT,
  "refundedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposit_refunds_created_by ON deposit_refunds (created_by);

CREATE TABLE IF NOT EXISTS readings (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "roomId" TEXT,
  "month" TEXT,
  "electricStart" NUMERIC,
  "electricEnd" NUMERIC,
  "waterStart" NUMERIC,
  "waterEnd" NUMERIC,
  "electricPhotoUrl" TEXT,
  "waterPhotoUrl" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_readings_created_by ON readings (created_by);
CREATE INDEX IF NOT EXISTS idx_readings_roomId_month ON readings ("roomId", "month");

CREATE TABLE IF NOT EXISTS meter_submissions (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "roomId" TEXT,
  "month" TEXT,
  "meterType" TEXT,
  "photoUrl" TEXT,
  "ocrRawText" TEXT,
  "ocrValue" NUMERIC,
  "finalValue" NUMERIC,
  "status" TEXT,
  "submittedByRole" TEXT,
  "submittedByUserId" TEXT,
  "submittedByName" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meter_submissions_created_by ON meter_submissions (created_by);
CREATE INDEX IF NOT EXISTS idx_meter_submissions_roomId_month ON meter_submissions ("roomId", "month");
CREATE INDEX IF NOT EXISTS idx_meter_submissions_status ON meter_submissions ("status");

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "roomId" TEXT,
  "tenantId" TEXT,
  "month" TEXT,
  "rent" NUMERIC,
  "electricUsage" NUMERIC,
  "electricStart" NUMERIC,
  "electricEnd" NUMERIC,
  "electricAmount" NUMERIC,
  "waterUsage" NUMERIC,
  "waterStart" NUMERIC,
  "waterEnd" NUMERIC,
  "waterAmount" NUMERIC,
  "other" NUMERIC,
  "total" NUMERIC,
  "status" TEXT,
  "paidAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_roomId_month ON invoices ("roomId", "month");

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "invoiceId" TEXT,
  "roomId" TEXT,
  "tenantId" TEXT,
  "amount" NUMERIC,
  "method" TEXT,
  "note" TEXT,
  "paidAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_created_by ON payments (created_by);
CREATE INDEX IF NOT EXISTS idx_payments_invoiceId ON payments ("invoiceId");

CREATE TABLE IF NOT EXISTS rent_periods (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "roomId" TEXT,
  "tenantId" TEXT,
  "month" TEXT,
  "rent" NUMERIC,
  "invoiceId" TEXT,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rent_periods_created_by ON rent_periods (created_by);
CREATE INDEX IF NOT EXISTS idx_rent_periods_roomId_month ON rent_periods ("roomId", "month");

CREATE TABLE IF NOT EXISTS payment_allocations (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "paymentId" TEXT,
  "rentPeriodId" TEXT,
  "invoiceId" TEXT,
  "amount" NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_created_by ON payment_allocations (created_by);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_paymentId ON payment_allocations ("paymentId");
CREATE INDEX IF NOT EXISTS idx_payment_allocations_rentPeriodId ON payment_allocations ("rentPeriodId");

CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64),
  "bankCode" TEXT,
  "accountNo" TEXT,
  "accountName" TEXT,
  "qrNoteTemplate" TEXT,
  "landlordName" TEXT,
  "landlordPhone" TEXT,
  "landlordAddress" TEXT,
  "useTuyaMonthlyUsage" BOOLEAN DEFAULT FALSE,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settings_created_by ON settings (created_by);
