-- catalog-service schema for PostgreSQL (Neon / Supabase / any Postgres).
-- Column names are quoted camelCase so they match the JSON the API returns.
-- Every table has "isDeleted" (soft delete: "delete" only sets it to true and stamps
-- updated_by/updated_at; reads skip those rows) and ends with the same four audit columns: created_by, updated_by (the user id
-- homestay-server forwards in x-actor-id, 'system' otherwise), created_at, updated_at.
-- Apply with: npm run migrate

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE, -- soft delete: rows are never removed, only flagged
  created_by VARCHAR(64),
  updated_by VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Dịch vụ (kind='service', needs a categoryId) and phụ thu (kind='surcharge',
-- categoryId NULL) live in the same table.
CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64) NOT NULL,
  "categoryId" VARCHAR(64),
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(50) DEFAULT '',
  price BIGINT NOT NULL DEFAULT 0,
  kind VARCHAR(20) NOT NULL DEFAULT 'service',
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE, -- soft delete: rows are never removed, only flagged
  created_by VARCHAR(64),
  updated_by VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_homestay ON categories ("homestayId");
CREATE INDEX IF NOT EXISTS idx_items_homestay ON items ("homestayId");
CREATE INDEX IF NOT EXISTS idx_items_category ON items ("categoryId");
CREATE INDEX IF NOT EXISTS idx_items_kind ON items (kind);
