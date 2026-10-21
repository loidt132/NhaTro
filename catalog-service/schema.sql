-- catalog-service schema for PostgreSQL (Neon / Supabase / any Postgres).
-- Column names are quoted camelCase so they match the JSON the API returns.
-- Apply with: npm run migrate

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) PRIMARY KEY,
  "homestayId" VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_homestay ON categories ("homestayId");
CREATE INDEX IF NOT EXISTS idx_items_homestay ON items ("homestayId");
CREATE INDEX IF NOT EXISTS idx_items_category ON items ("categoryId");
CREATE INDEX IF NOT EXISTS idx_items_kind ON items (kind);
