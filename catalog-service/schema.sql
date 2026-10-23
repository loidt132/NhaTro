-- catalog-service schema for PostgreSQL (Neon / Supabase / any Postgres).
-- Column names are quoted camelCase so they match the JSON the API returns.
-- Every table ends with the same four audit columns: created_by, updated_by (the user id
-- the calling app forwards in x-actor-id, 'system' otherwise), created_at, updated_at.
-- Apply with: npm run migrate

-- "businessId" is whichever tenant key the calling app uses for itself
-- (a homestay's id, a landlord's user id for nhà trọ, ...) — catalog-service
-- doesn't need to know what kind of business it is, only that each one's
-- catalog/orders stay separate from every other's.
CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) PRIMARY KEY,
  "businessId" VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_by VARCHAR(64),
  updated_by VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Dịch vụ (kind='service', needs a categoryId) and phụ thu (kind='surcharge',
-- categoryId NULL) live in the same table.
CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(64) PRIMARY KEY,
  "businessId" VARCHAR(64) NOT NULL,
  "categoryId" VARCHAR(64),
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(50) DEFAULT '',
  price BIGINT NOT NULL DEFAULT 0,
  kind VARCHAR(20) NOT NULL DEFAULT 'service',
  created_by VARCHAR(64),
  updated_by VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_business ON categories ("businessId");
CREATE INDEX IF NOT EXISTS idx_items_business ON items ("businessId");
CREATE INDEX IF NOT EXISTS idx_items_category ON items ("categoryId");
CREATE INDEX IF NOT EXISTS idx_items_kind ON items (kind);

-- Đơn dịch vụ (giặt là, nước uống...) khách/phòng đặt từ một item ở trên.
-- itemName/unit/price/quantity/amount là snapshot tại thời điểm đặt — nếu
-- item gốc đổi giá hoặc bị xoá sau đó, đơn cũ không bị ảnh hưởng.
-- roomId/tenantId là chuỗi opaque: catalog-service không cần biết "phòng" là
-- gì, app gọi (nhà trọ, homestay...) tự hiểu ý nghĩa của chúng.
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  "businessId" VARCHAR(64) NOT NULL,
  "itemId" VARCHAR(64),
  "itemName" VARCHAR(255) NOT NULL,
  unit VARCHAR(50) DEFAULT '',
  price BIGINT NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 1,
  amount BIGINT NOT NULL DEFAULT 0,
  "roomId" VARCHAR(64),
  "tenantId" VARCHAR(64),
  "customerName" VARCHAR(255),
  "month" VARCHAR(7),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  note TEXT,
  "orderedAt" TIMESTAMPTZ DEFAULT now(),
  "completedAt" TIMESTAMPTZ,
  created_by VARCHAR(64),
  updated_by VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- CREATE TABLE IF NOT EXISTS skips this column on a table that already
-- existed before customerName was added (khách vãng lai, không gắn phòng).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "customerName" VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_orders_business ON orders ("businessId");
CREATE INDEX IF NOT EXISTS idx_orders_room_month ON orders ("roomId", "month");
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
