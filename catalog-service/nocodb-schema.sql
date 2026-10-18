-- catalog-service schema for NocoDB / SQL import.
-- This is the standalone priced-catalog service shared by homestay-app and
-- (later) nhà trọ — see README.md. Only 2 tables; everything else in this
-- repo's data/seed.json maps straight onto these.
--
-- Multi-tenant: each homestay has its own price list, isolated by
-- homestayId (a plain id string — this service has no `homestays` table of
-- its own, it's just told which homestay a request is for). Same NocoDB
-- import gotcha as homestay-server: add `homestayId` by hand in the UI as
-- "Single line text", then run `npm run fix-links` as a safety net.

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dịch vụ (kind='service', needs a categoryId) and phụ thu (kind='surcharge',
-- categoryId left NULL — surcharges aren't grouped by category) live in the
-- same table, same as the running app's data/seed.json.
CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(64) PRIMARY KEY,
  categoryId VARCHAR(64), -- NULL for kind='surcharge'
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(50),
  price BIGINT NOT NULL DEFAULT 0,
  kind VARCHAR(20) NOT NULL DEFAULT 'service', -- 'service' | 'surcharge'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_category ON items (categoryId);
CREATE INDEX IF NOT EXISTS idx_items_kind ON items (kind);

ALTER TABLE categories ADD COLUMN IF NOT EXISTS homestayId VARCHAR(64) NOT NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS homestayId VARCHAR(64) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_homestay ON categories (homestayId);
CREATE INDEX IF NOT EXISTS idx_items_homestay ON items (homestayId);
