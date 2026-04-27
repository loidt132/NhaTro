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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  primaryTenantId VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS readings (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  roomId VARCHAR(64) NOT NULL,
  month VARCHAR(7) NOT NULL,
  electricStart BIGINT DEFAULT 0,
  electricEnd BIGINT DEFAULT 0,
  waterStart BIGINT DEFAULT 0,
  waterEnd BIGINT DEFAULT 0,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
  electricUsage BIGINT DEFAULT 0,
  electricStart BIGINT DEFAULT 0,
  electricEnd BIGINT DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  modified_by VARCHAR(64) NOT NULL,
  invoiceId VARCHAR(64) NOT NULL,
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_settings_created_by ON settings (created_by);
