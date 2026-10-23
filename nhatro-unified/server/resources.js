// One REST API per kind of data — replaces the old "send the whole state to /api/state"
// sync. Every add / edit / delete is its own request and is written to the database
// straight away:
//
//   GET    /api/<resource>            the signed-in user's live rows
//   GET    /api/<resource>/:id
//   POST   /api/<resource>            create   (201 + the saved row)
//   PUT    /api/<resource>/:id        update   (only the fields sent; 404 if not yours)
//   DELETE /api/<resource>/:id        soft delete (isDeleted = true; 204)
//   GET/PUT /api/settings             the user's single settings row
//   POST   /api/batch                 several of the operations above in ONE transaction
//                                     (a rent payment writes payment + allocations + periods)
//
// resources: rooms, tenants, readings, invoices, payments, rent-periods,
// payment-allocations, deposits, deposit-transactions.
//
// Rows belong to their owner (created_by). The server always decides id (unless the
// client supplies a fresh one), created_by/updated_by (the signed-in user) and
// created_at/updated_at (now); a request can never change them.
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { encryptRow, decryptRow } = require('./cryptoFields');

const RESOURCES = [
  { path: 'rooms', key: 'rooms', table: 'rooms' },
  { path: 'tenants', key: 'tenants', table: 'tenants' },
  { path: 'readings', key: 'readings', table: 'readings' },
  { path: 'invoices', key: 'invoices', table: 'invoices' },
  { path: 'payments', key: 'payments', table: 'payments' },
  { path: 'rent-periods', key: 'rentPeriods', table: 'rent_periods' },
  { path: 'payment-allocations', key: 'paymentAllocations', table: 'payment_allocations' },
  { path: 'deposits', key: 'deposits', table: 'deposits' },
  { path: 'deposit-transactions', key: 'depositTransactions', table: 'deposit_transactions' },
];
const BY_NAME = new Map();
RESOURCES.forEach((r) => {
  BY_NAME.set(r.path, r);
  BY_NAME.set(r.key, r);
});
const SETTINGS = { path: 'settings', key: 'settings', table: 'settings' };
const MAX_BATCH_OPS = 300;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// What the browser sees: the row without ownership columns and the soft-delete flag.
// created_at / updated_at stay (the app sorts and compares by them).
function toApp(resource, row) {
  if (!row) return row;
  const out = { ...decryptRow(resource.key, row) };
  delete out.created_by;
  delete out.updated_by;
  delete out.isDeleted;
  if (resource === SETTINGS) {
    delete out.created_at;
    delete out.updated_at;
  }
  return out;
}

function prepareData(resource, data) {
  const body = { ...(data || {}) };
  if (resource.key === 'invoices' && body.status === 'Còn nợ') body.status = 'Chưa thanh toán';
  return encryptRow(resource.key, body);
}

function newId() {
  return crypto.randomUUID();
}

function validId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function createResourcesRouter({ authMiddleware }) {
  const router = express.Router();

  // ---- who may do what ---------------------------------------------------------
  function isAdmin(req) {
    return String(req.authPayload?.role || '').trim().toLowerCase() === 'admin';
  }

  // Whose rows a GET returns: your own; an admin may look at someone else's
  // (?ownerUserId=, read-only preview); a tenant may read only its landlord's rooms.
  function readOwnerId(req, resource) {
    const requested = String(req.query?.ownerUserId || '').trim();
    if (!requested || requested === req.userId) return req.userId;
    if (req.authPayload?.role === 'tenant') {
      if (resource.key === 'rooms' && requested === String(req.authPayload?.landlordId || '')) return requested;
      throw new ApiError(403, 'Không có quyền xem dữ liệu này.');
    }
    return isAdmin(req) ? requested : req.userId;
  }

  function assertCanWrite(req) {
    if (req.authPayload?.role === 'tenant') throw new ApiError(403, 'Tài khoản người thuê không được sửa dữ liệu.');
  }

  async function assertRoomLimit(client, ownerId) {
    const run = client ? (text, params) => client.query(text, params).then((r) => r.rows) : db.query;
    const [user] = await run('SELECT "maxRoomLimit" FROM users WHERE id = $1', [String(ownerId)]);
    const limit = user?.maxRoomLimit;
    if (limit === null || limit === undefined || !(limit > 0)) return;
    const [{ count }] = await run(
      `SELECT count(*)::int AS count FROM rooms WHERE created_by = $1 AND COALESCE("isDeleted", false) = false`,
      [String(ownerId)]
    );
    if (count >= limit) throw new ApiError(400, `Không thể thêm phòng mới. Giới hạn ${limit} phòng đã đạt.`);
  }

  // ---- the five operations, shared by the REST routes and /api/batch ------------
  async function createOne(client, req, resource, data, wantedId) {
    const id = wantedId || data?.id || newId();
    if (!validId(String(id))) throw new ApiError(400, 'id không hợp lệ.');
    if (resource.key === 'rooms') await assertRoomLimit(client, req.userId);
    try {
      const row = await db.insertRow(resource.table, {
        id,
        ownerId: req.userId,
        actorId: req.userId,
        data: prepareData(resource, data),
      }, { client });
      return toApp(resource, row);
    } catch (error) {
      if (error instanceof db.DbConflictError) throw new ApiError(409, 'id đã tồn tại.');
      throw error;
    }
  }

  async function updateOne(client, req, resource, id, patch) {
    const row = await db.updateRow(resource.table, id, {
      ownerId: req.userId,
      actorId: req.userId,
      patch: prepareData(resource, patch),
    }, { client });
    if (!row) throw new ApiError(404, 'Không tìm thấy bản ghi.');
    return toApp(resource, row);
  }

  async function deleteOne(client, req, resource, id) {
    const deleted = await db.softDeleteRow(resource.table, id, req.userId, { client, actorId: req.userId });
    if (!deleted) throw new ApiError(404, 'Không tìm thấy bản ghi.');
  }

  // create-or-update by id, keeping the given created_at — used to import a backup file.
  // A row soft-deleted earlier by the same owner is revived; another owner's id is refused.
  async function upsertOne(client, req, resource, data, wantedId) {
    const id = wantedId || data?.id;
    if (!validId(String(id))) throw new ApiError(400, 'id không hợp lệ.');
    const existing = await db.getOwnedRow(resource.table, id, req.userId, { client });
    if (existing) return updateOne(client, req, resource, id, data);
    if (resource.key === 'rooms') await assertRoomLimit(client, req.userId);
    const prepared = prepareData(resource, data);
    const written = await db.upsertRow(resource.table, {
      ...prepared,
      id: String(id),
      created_by: req.userId,
      updated_by: req.userId,
      isDeleted: false,
    }, { client });
    if (!written) throw new ApiError(409, 'id thuộc về tài khoản khác.');
    return toApp(resource, await db.getOwnedRow(resource.table, id, req.userId, { client }));
  }

  async function listFor(resource, ownerId) {
    const rows = await db.query(
      `SELECT * FROM ${db.q(resource.table)} WHERE created_by = $1 AND COALESCE("isDeleted", false) = false ORDER BY created_at, id`,
      [String(ownerId)]
    );
    return rows.map((row) => toApp(resource, row));
  }

  // ---- settings: one row per user ----------------------------------------------
  const settingsId = (ownerId) => `settings:${ownerId}`;

  async function saveSettings(client, req, patch) {
    const id = settingsId(req.userId);
    const existing = await db.getOwnedRow(SETTINGS.table, id, req.userId, { client });
    if (existing) return updateOne(client, req, SETTINGS, id, patch);
    return createOne(client, req, SETTINGS, patch, id);
  }

  // ---- route plumbing ----------------------------------------------------------
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
      console.error(`${req.method} ${req.originalUrl} error`, error);
      return res.status(500).json({ error: 'Không thể xử lý yêu cầu.' });
    }
  };

  // Batch must be declared before the generic /:resource routes.
  router.post('/batch', authMiddleware, handle(async (req, res) => {
    assertCanWrite(req);
    const ops = req.body?.ops;
    if (!Array.isArray(ops) || ops.length === 0) throw new ApiError(400, 'Thiếu danh sách thao tác (ops).');
    if (ops.length > MAX_BATCH_OPS) throw new ApiError(400, `Tối đa ${MAX_BATCH_OPS} thao tác mỗi lần.`);

    const results = await db.withTransaction(async (client) => {
      const out = [];
      for (const op of ops) {
        const name = String(op?.resource || '');
        const resource = name === 'settings' ? SETTINGS : BY_NAME.get(name);
        if (!resource) throw new ApiError(400, `Loại dữ liệu không hợp lệ: ${name}`);
        const action = String(op?.action || '');
        if (resource === SETTINGS) {
          if (!['update', 'upsert', 'create'].includes(action)) throw new ApiError(400, 'settings chỉ hỗ trợ update.');
          out.push(await saveSettings(client, req, op.data));
        } else if (action === 'create') {
          out.push(await createOne(client, req, resource, op.data, op.id));
        } else if (action === 'update') {
          out.push(await updateOne(client, req, resource, op.id, op.data));
        } else if (action === 'delete') {
          await deleteOne(client, req, resource, op.id);
          out.push(null);
        } else if (action === 'upsert') {
          out.push(await upsertOne(client, req, resource, op.data, op.id));
        } else {
          throw new ApiError(400, `Thao tác không hợp lệ: ${action}`);
        }
      }
      return out;
    });
    res.json({ results });
  }));

  router.get('/settings', authMiddleware, handle(async (req, res) => {
    const ownerId = readOwnerId(req, SETTINGS);
    const row = await db.getOwnedRow(SETTINGS.table, settingsId(ownerId), ownerId);
    res.json({ settings: row ? toApp(SETTINGS, row) : {} });
  }));

  router.put('/settings', authMiddleware, handle(async (req, res) => {
    assertCanWrite(req);
    res.json({ settings: await saveSettings(null, req, req.body) });
  }));

  for (const resource of RESOURCES) {
    const base = `/${resource.path}`;

    router.get(base, authMiddleware, handle(async (req, res) => {
      res.json({ [resource.key]: await listFor(resource, readOwnerId(req, resource)) });
    }));

    router.get(`${base}/:id`, authMiddleware, handle(async (req, res) => {
      const ownerId = readOwnerId(req, resource);
      const row = await db.getOwnedRow(resource.table, req.params.id, ownerId);
      if (!row) throw new ApiError(404, 'Không tìm thấy bản ghi.');
      res.json(toApp(resource, row));
    }));

    router.post(base, authMiddleware, handle(async (req, res) => {
      assertCanWrite(req);
      res.status(201).json(await createOne(null, req, resource, req.body));
    }));

    router.put(`${base}/:id`, authMiddleware, handle(async (req, res) => {
      assertCanWrite(req);
      res.json(await updateOne(null, req, resource, req.params.id, req.body));
    }));

    router.delete(`${base}/:id`, authMiddleware, handle(async (req, res) => {
      assertCanWrite(req);
      await deleteOne(null, req, resource, req.params.id);
      res.status(204).end();
    }));
  }

  return router;
}

module.exports = { createResourcesRouter, RESOURCES };
