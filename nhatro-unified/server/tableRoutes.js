// Per-table REST CRUD for the 9 tables that used to only sync in bulk through
// /api/state (stateStore.js). /api/state keeps working in parallel — these
// routes are purely additive while the web app migrates page by page.
const crypto = require('crypto');
const db = require('./db');
const stateStore = require('./stateStore');
const { encryptRow, decryptRow } = require('./cryptoFields');

function uid() {
  return crypto.randomUUID();
}

// stateStore collection key -> URL segment (kebab-case for multi-word keys).
const ROUTE_SEGMENTS = {
  rooms: 'rooms',
  tenants: 'tenants',
  readings: 'readings',
  invoices: 'invoices',
  payments: 'payments',
  rentPeriods: 'rent-periods',
  paymentAllocations: 'payment-allocations',
  deposits: 'deposits',
  depositTransactions: 'deposit-transactions',
};

async function findOwnedRow(table, id, userId) {
  const row = await db.getRowById(table, id);
  if (!row || String(row.created_by) !== String(userId)) return null;
  if (row.isDeleted === true) return null;
  return row;
}

// Mirrors the maxRoomLimit check that /api/state POST applies (index.js), so
// a per-table POST/PUT on rooms can't be used to bypass it.
async function ensureRoomLimitNotExceeded(userId, { isNewRoom }) {
  if (!isNewRoom) return null;
  const rows = await db.query('SELECT "maxRoomLimit" FROM users WHERE id = $1', [String(userId)]);
  const limit = rows[0]?.maxRoomLimit;
  if (limit === null || limit === undefined || Number(limit) <= 0) return null;
  const existing = await db.listOwnedRows(db.TABLES.rooms, userId);
  if (existing.length + 1 > Number(limit)) {
    return `Không thể thêm phòng mới. Bạn đã đạt giới hạn ${limit} phòng.`;
  }
  return null;
}

function registerTableRoutes(app, { authMiddleware, adminMiddleware }) {
  for (const [key, segment] of Object.entries(ROUTE_SEGMENTS)) {
    const table = db.TABLES[key];
    const basePath = `/api/${segment}`;

    app.get(basePath, authMiddleware, async (req, res) => {
      if (!stateStore.isConfigured()) return res.json({ list: [] });
      try {
        const rows = await stateStore.fetchOwnedRows(key, req.userId);
        return res.json({ list: rows.map(stateStore.stripSystemColumns) });
      } catch (error) {
        console.error(`${basePath} GET error`, error);
        return res.status(500).json({ error: `Không tải được danh sách ${segment}.` });
      }
    });

    app.get(`/api/admin/users/:userId/${segment}`, adminMiddleware, async (req, res) => {
      if (!stateStore.isConfigured()) return res.json({ list: [] });
      try {
        const rows = await stateStore.fetchOwnedRows(key, req.params.userId);
        return res.json({ list: rows.map(stateStore.stripSystemColumns) });
      } catch (error) {
        console.error(`/api/admin/users/:userId/${segment} GET error`, error);
        return res.status(500).json({ error: `Không tải được danh sách ${segment}.` });
      }
    });

    app.post(basePath, authMiddleware, async (req, res) => {
      if (!stateStore.isConfigured()) {
        return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
      }
      try {
        if (key === 'rooms') {
          const limitError = await ensureRoomLimitNotExceeded(req.userId, { isNewRoom: true });
          if (limitError) return res.status(400).json({ error: limitError });
        }
        const record = { ...(req.body || {}), id: req.body?.id || uid() };
        const row = stateStore.withOwnership(record, req.userId);
        await db.upsertRow(table, encryptRow(key, row));
        const saved = await db.getRowById(table, row.id);
        return res.json({ item: stateStore.stripSystemColumns(decryptRow(key, saved)) });
      } catch (error) {
        console.error(`${basePath} POST error`, error);
        return res.status(500).json({ error: error?.message || `Không thể tạo ${segment}.` });
      }
    });

    app.put(`${basePath}/:id`, authMiddleware, async (req, res) => {
      if (!stateStore.isConfigured()) {
        return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
      }
      try {
        const existing = await findOwnedRow(table, req.params.id, req.userId);
        if (!existing) return res.status(404).json({ error: `Không tìm thấy ${segment}.` });
        const existingDecrypted = decryptRow(key, existing);
        const record = { ...(req.body || {}), id: req.params.id };
        const row = stateStore.withOwnership(record, req.userId, existingDecrypted);
        await db.upsertRow(table, encryptRow(key, row));
        const saved = await db.getRowById(table, req.params.id);
        return res.json({ item: stateStore.stripSystemColumns(decryptRow(key, saved)) });
      } catch (error) {
        console.error(`${basePath}/:id PUT error`, error);
        return res.status(500).json({ error: error?.message || `Không thể cập nhật ${segment}.` });
      }
    });

    app.delete(`${basePath}/:id`, authMiddleware, async (req, res) => {
      if (!stateStore.isConfigured()) {
        return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
      }
      try {
        const existing = await findOwnedRow(table, req.params.id, req.userId);
        if (!existing) return res.status(404).json({ error: `Không tìm thấy ${segment}.` });
        await db.softDeleteRow(table, req.params.id, req.userId);
        return res.json({ ok: true });
      } catch (error) {
        console.error(`${basePath}/:id DELETE error`, error);
        return res.status(500).json({ error: error?.message || `Không thể xoá ${segment}.` });
      }
    });
  }
}

module.exports = { registerTableRoutes, findOwnedRow, uid };
