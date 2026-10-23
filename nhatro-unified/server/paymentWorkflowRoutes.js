// Composite, transactional endpoints for the handful of Payments.jsx actions
// that write more than one table in a single user action (advance rent
// payment, deposit receive/refund, invoice paid-toggle, invoice from meter
// reading). Each mirrors the exact calculation the browser used to do
// itself before writing the whole state blob via /api/state — only the
// write now happens atomically on the server instead.
const crypto = require('crypto');
const db = require('./db');
const stateStore = require('./stateStore');

function uid() {
  return crypto.randomUUID();
}

async function findOwnedRow(table, id, userId) {
  const row = await db.getRowById(table, id);
  if (!row || String(row.created_by) !== String(userId) || row.isDeleted === true) return null;
  return row;
}

function addMonths(ym, count) {
  const [year, month] = String(ym).split('-').map(Number);
  const date = new Date(year, month - 1 + Math.max(0, count - 1), 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_UNPAID = 'Chưa thanh toán';
const STATUS_PAID = 'Đã thanh toán';
const isUnpaidStatus = (status = '') => {
  const s = String(status || '').trim();
  return s === STATUS_UNPAID;
};

function registerPaymentWorkflowRoutes(app, { authMiddleware, fetchApi, SERVICE_CATALOG_URL, CATALOG_TIMEOUT_MS }) {
  // ---- Advance rent payment: payments + rent_periods + payment_allocations ----
  app.post('/api/payments/advance', authMiddleware, async (req, res) => {
    if (!stateStore.isConfigured()) return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
    const userId = req.userId;
    // startMonth/count are already fully resolved by the UI (it picks the
    // from/to month range, or falls back to its own advancePaymentStartMonth
    // search) — the server only needs the final values to run the allocation
    // loop atomically, not to re-derive them.
    const { roomId, tenantId, startMonth, count: rawCount, amount, note } = req.body || {};
    try {
      const room = await findOwnedRow('rooms', roomId, userId);
      if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
      const tenant = await findOwnedRow('tenants', tenantId, userId);
      if (!tenant) return res.status(404).json({ error: 'Không tìm thấy khách thuê.' });
      if (!/^\d{4}-\d{2}$/.test(String(startMonth || ''))) return res.status(400).json({ error: 'Thiếu startMonth hợp lệ (YYYY-MM).' });

      const count = Math.min(60, Math.max(1, Number(rawCount) || 1));
      let amountToAllocate = Math.max(0, Number(amount) || 0);
      if (!amountToAllocate) return res.status(400).json({ error: 'Nhập số tiền đóng trước.' });

      const existingPeriods = await db.listOwnedRows(db.TABLES.rentPeriods, userId);
      const existingAllocations = await db.listOwnedRows(db.TABLES.paymentAllocations, userId);
      const periodsOfRoom = existingPeriods.filter((p) => String(p.roomId) === String(roomId));
      const allocatedOfPeriod = (periodId) => existingAllocations
        .filter((a) => String(a.rentPeriodId) === String(periodId))
        .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

      const now = new Date().toISOString();
      const periodsToUpsert = [];
      const allocationsToInsert = [];
      for (let index = 0; index < count; index += 1) {
        const periodMonth = addMonths(startMonth, index + 1);
        let period = periodsOfRoom.find((p) => p.month === periodMonth) || periodsToUpsert.find((p) => p.month === periodMonth);
        if (!period) {
          period = { id: uid(), roomId, tenantId, month: periodMonth, rent: room.baseRent ?? 0, created_at: now, updated_at: now };
          periodsToUpsert.push(period);
        }
        const allocated = allocatedOfPeriod(period.id) + allocationsToInsert.filter((a) => a.rentPeriodId === period.id).reduce((s, a) => s + a.amount, 0);
        const remaining = Math.max(0, (Number(period.rent) || 0) - allocated);
        const allocationAmount = Math.min(remaining, amountToAllocate);
        if (allocationAmount > 0) {
          allocationsToInsert.push({ id: uid(), rentPeriodId: period.id, amount: allocationAmount, created_at: now, updated_at: now });
          amountToAllocate -= allocationAmount;
        }
      }
      if (amountToAllocate > 0) return res.status(400).json({ error: `Số tiền vượt phần tiền phòng còn phải đóng của ${count} tháng. Hãy tăng số tháng hoặc giảm số tiền.` });
      if (!allocationsToInsert.length) return res.status(400).json({ error: 'Các tháng đã chọn đã được đóng đủ tiền phòng.' });

      const totalAmount = allocationsToInsert.reduce((sum, a) => sum + a.amount, 0);
      const payment = stateStore.withOwnership({
        id: uid(), roomId, tenantId, amount: totalAmount, method: 'Tiền mặt',
        note: note || `Đóng trước tiền phòng ${startMonth} đến ${addMonths(startMonth, count)}`,
        paidAt: now, created_at: now,
      }, userId);
      allocationsToInsert.forEach((a) => { a.paymentId = payment.id; });

      await db.withTransaction(async (client) => {
        await db.upsertRow(db.TABLES.payments, payment, { client });
        for (const period of periodsToUpsert) {
          await db.upsertRow(db.TABLES.rentPeriods, stateStore.withOwnership(period, userId), { client });
        }
        for (const allocation of allocationsToInsert) {
          await db.upsertRow(db.TABLES.paymentAllocations, stateStore.withOwnership(allocation, userId), { client });
        }
      });

      return res.json({
        payment: stateStore.stripSystemColumns(payment),
        rentPeriods: periodsToUpsert.map(stateStore.stripSystemColumns),
        paymentAllocations: allocationsToInsert.map(stateStore.stripSystemColumns),
      });
    } catch (error) {
      console.error('POST /api/payments/advance error', error);
      return res.status(500).json({ error: error?.message || 'Không thể thu tiền đóng trước.' });
    }
  });

  // ---- Deposit receive: deposits + deposit_transactions ----
  app.post('/api/deposits/receive', authMiddleware, async (req, res) => {
    if (!stateStore.isConfigured()) return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
    const userId = req.userId;
    const { roomId, tenantId, amount, note } = req.body || {};
    try {
      const room = await findOwnedRow('rooms', roomId, userId);
      if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
      const tenant = await findOwnedRow('tenants', tenantId, userId);
      if (!tenant) return res.status(404).json({ error: 'Không tìm thấy khách thuê.' });
      const depositAmount = Math.max(0, Number(amount) || 0);
      if (!depositAmount) return res.status(400).json({ error: 'Nhập số tiền cọc.' });

      const now = new Date().toISOString();
      const deposit = stateStore.withOwnership({
        id: uid(), roomId, tenantId, amount: depositAmount, remainingAmount: depositAmount, status: 'held', created_at: now,
      }, userId);
      const transaction = stateStore.withOwnership({
        id: uid(), depositId: deposit.id, amount: depositAmount, type: 'received', note: note || 'Thu tiền cọc', occurredAt: now, created_at: now,
      }, userId);

      await db.withTransaction(async (client) => {
        await db.upsertRow(db.TABLES.deposits, deposit, { client });
        await db.upsertRow(db.TABLES.depositTransactions, transaction, { client });
      });

      return res.json({ deposit: stateStore.stripSystemColumns(deposit), transaction: stateStore.stripSystemColumns(transaction) });
    } catch (error) {
      console.error('POST /api/deposits/receive error', error);
      return res.status(500).json({ error: error?.message || 'Không thể thu tiền cọc.' });
    }
  });

  // ---- Deposit refund: deposits + deposit_transactions ----
  app.post('/api/deposits/:roomId/refund', authMiddleware, async (req, res) => {
    if (!stateStore.isConfigured()) return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
    const userId = req.userId;
    const { roomId } = req.params;
    const { amount, note } = req.body || {};
    try {
      const allDeposits = await db.listOwnedRows(db.TABLES.deposits, userId);
      const heldDeposits = allDeposits.filter((d) => String(d.roomId) === String(roomId) && d.status === 'held');
      const balance = heldDeposits.reduce((sum, d) => sum + (Number(d.remainingAmount ?? d.amount) || 0), 0);
      const refundedAmount = Math.max(0, Number(amount) || 0);
      if (!balance) return res.status(400).json({ error: 'Phòng này không còn tiền cọc để hoàn.' });
      if (!refundedAmount || refundedAmount > balance) return res.status(400).json({ error: `Số hoàn cọc phải từ 1 đến ${balance} đ.` });

      const now = new Date().toISOString();
      const difference = balance - refundedAmount;
      const updatedDeposits = heldDeposits.map((d) => stateStore.withOwnership({ ...d, remainingAmount: 0, status: 'refunded' }, userId, d));
      const transactions = [
        stateStore.withOwnership({ id: uid(), depositId: heldDeposits[0]?.id, amount: refundedAmount, type: 'refunded', note: note || 'Hoàn tiền cọc', occurredAt: now, created_at: now }, userId),
      ];
      if (difference > 0) {
        transactions.push(stateStore.withOwnership({ id: uid(), depositId: heldDeposits[0]?.id, amount: difference, type: 'deducted', note: 'Cấn trừ tự động do số tiền hoàn thấp hơn tiền cọc', occurredAt: now, created_at: now }, userId));
      }

      await db.withTransaction(async (client) => {
        for (const deposit of updatedDeposits) {
          await db.upsertRow(db.TABLES.deposits, deposit, { client });
        }
        for (const transaction of transactions) {
          await db.upsertRow(db.TABLES.depositTransactions, transaction, { client });
        }
      });

      return res.json({
        deposits: updatedDeposits.map(stateStore.stripSystemColumns),
        transactions: transactions.map(stateStore.stripSystemColumns),
      });
    } catch (error) {
      console.error('POST /api/deposits/:roomId/refund error', error);
      return res.status(500).json({ error: error?.message || 'Không thể hoàn tiền cọc.' });
    }
  });

  // ---- Invoice paid-toggle: invoices + payments ----
  app.put('/api/invoices/:id/toggle-paid', authMiddleware, async (req, res) => {
    if (!stateStore.isConfigured()) return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
    const userId = req.userId;
    try {
      const invoice = await findOwnedRow('invoices', req.params.id, userId);
      if (!invoice) return res.status(404).json({ error: 'Không tìm thấy hoá đơn.' });

      const allPayments = await db.listOwnedRows(db.TABLES.payments, userId);
      const directPayments = allPayments.filter((p) => String(p.invoiceId || '') === String(invoice.id));

      if (directPayments.length) {
        const updatedInvoice = stateStore.withOwnership({ ...invoice, status: STATUS_UNPAID, paidAt: null }, userId, invoice);
        await db.withTransaction(async (client) => {
          await db.upsertRow(db.TABLES.invoices, updatedInvoice, { client });
          for (const payment of directPayments) {
            await db.softDeleteRow(db.TABLES.payments, payment.id, userId, { client });
          }
        });
        return res.json({ invoice: stateStore.stripSystemColumns(updatedInvoice), removedPaymentIds: directPayments.map((p) => p.id) });
      }

      const allRentPeriods = await db.listOwnedRows(db.TABLES.rentPeriods, userId);
      const allAllocations = await db.listOwnedRows(db.TABLES.paymentAllocations, userId);
      const period = allRentPeriods.find((p) => String(p.roomId) === String(invoice.roomId) && p.month === invoice.month);
      const allocated = period ? allAllocations.filter((a) => String(a.rentPeriodId) === String(period.id)).reduce((sum, a) => sum + (Number(a.amount) || 0), 0) : 0;
      const advancePaid = Math.min(Number(invoice.rent) || 0, allocated);
      if (advancePaid >= (Number(invoice.total) || 0)) {
        return res.status(400).json({ error: 'Hóa đơn này đã được cấn từ tiền đóng trước. Hãy điều chỉnh giao dịch đóng trước nếu cần hoàn tác.' });
      }

      const paidAt = new Date().toISOString();
      const updatedInvoice = stateStore.withOwnership({ ...invoice, status: STATUS_PAID, paidAt }, userId, invoice);
      const payment = stateStore.withOwnership({
        id: uid(), invoiceId: invoice.id, roomId: invoice.roomId, tenantId: invoice.tenantId,
        amount: Math.max(0, (Number(invoice.total) || 0) - advancePaid),
        method: 'Tiền mặt', note: `Thanh toán ${invoice.month}`, paidAt, created_at: paidAt,
      }, userId);

      await db.withTransaction(async (client) => {
        await db.upsertRow(db.TABLES.invoices, updatedInvoice, { client });
        await db.upsertRow(db.TABLES.payments, payment, { client });
      });

      return res.json({ invoice: stateStore.stripSystemColumns(updatedInvoice), payment: stateStore.stripSystemColumns(payment) });
    } catch (error) {
      console.error('PUT /api/invoices/:id/toggle-paid error', error);
      return res.status(500).json({ error: error?.message || 'Không thể cập nhật trạng thái thanh toán.' });
    }
  });

  // Dịch vụ/phụ thu "Hoàn thành" của phòng trong tháng — cộng vào field
  // `other` của hoá đơn, mirrors Payments.jsx's serviceOrdersTotal().
  async function serviceOrdersTotal(userId, roomId, month) {
    try {
      const params = new URLSearchParams({ businessId: userId, roomId, month, status: 'done' });
      const r = await fetchApi(`${SERVICE_CATALOG_URL}/api/orders?${params.toString()}`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
      const body = await r.json().catch(() => ({}));
      const rows = Array.isArray(body) ? body : (body.list || body.orders || []);
      return (rows || []).reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    } catch (error) {
      console.error('serviceOrdersTotal error', error);
      return 0;
    }
  }

  function computeInvoiceAmounts(room, reading, other) {
    const eUse = Math.max(0, (reading.electricEnd ?? 0) - (reading.electricStart ?? 0));
    const wUse = Math.max(0, (reading.waterEnd ?? 0) - (reading.waterStart ?? 0));
    const electricAmount = eUse * (room.electricRate ?? 0);
    const waterAmount = wUse * (room.waterRate ?? 0);
    return {
      eUse, wUse, electricAmount, waterAmount,
      total: (room.baseRent ?? 0) + electricAmount + waterAmount + other,
    };
  }

  // ---- Create invoice from meter reading: invoices + rent_periods ----
  app.post('/api/invoices/from-reading', authMiddleware, async (req, res) => {
    if (!stateStore.isConfigured()) return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
    const userId = req.userId;
    const { roomId, tenantId, month, readingId } = req.body || {};
    try {
      const room = await findOwnedRow('rooms', roomId, userId);
      if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
      const tenant = await findOwnedRow('tenants', tenantId, userId);
      if (!tenant) return res.status(404).json({ error: 'Không tìm thấy khách thuê.' });
      const reading = await findOwnedRow('readings', readingId, userId);
      if (!reading) return res.status(400).json({ error: 'Chưa có chỉ số điện nước cho tháng này' });

      const other = await serviceOrdersTotal(userId, roomId, month);
      const amounts = computeInvoiceAmounts(room, reading, other);
      const nowIso = new Date().toISOString();
      const invoice = stateStore.withOwnership({
        id: uid(), roomId, tenantId, month, rent: room.baseRent ?? 0,
        electricUsage: amounts.eUse, electricEnd: reading.electricEnd, electricStart: reading.electricStart,
        waterUsage: amounts.wUse, waterEnd: reading.waterEnd, waterStart: reading.waterStart,
        electricAmount: amounts.electricAmount, waterAmount: amounts.waterAmount, other, total: amounts.total,
        status: STATUS_UNPAID, created_at: nowIso,
      }, userId);

      const existingPeriods = await db.listOwnedRows(db.TABLES.rentPeriods, userId);
      const existingPeriod = existingPeriods.find((p) => String(p.roomId) === String(roomId) && p.month === month);
      const period = stateStore.withOwnership(
        existingPeriod
          ? { ...existingPeriod, invoiceId: invoice.id }
          : { id: uid(), roomId, tenantId, month, rent: room.baseRent ?? 0, invoiceId: invoice.id, created_at: nowIso },
        userId,
        existingPeriod
      );

      await db.withTransaction(async (client) => {
        await db.upsertRow(db.TABLES.invoices, invoice, { client });
        await db.upsertRow(db.TABLES.rentPeriods, period, { client });
      });

      return res.json({ invoice: stateStore.stripSystemColumns(invoice), rentPeriod: stateStore.stripSystemColumns(period) });
    } catch (error) {
      console.error('POST /api/invoices/from-reading error', error);
      return res.status(500).json({ error: error?.message || 'Không thể tạo hoá đơn.' });
    }
  });

  // ---- Refresh an invoice from its meter reading (and current service orders) ----
  app.put('/api/invoices/:id/from-reading', authMiddleware, async (req, res) => {
    if (!stateStore.isConfigured()) return res.status(501).json({ error: 'Database chưa được cấu hình trên server.' });
    const userId = req.userId;
    const { readingId } = req.body || {};
    try {
      const invoice = await findOwnedRow('invoices', req.params.id, userId);
      if (!invoice) return res.status(404).json({ error: 'Không tìm thấy hoá đơn.' });
      const room = await findOwnedRow('rooms', invoice.roomId, userId);
      if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
      const reading = await findOwnedRow('readings', readingId, userId);
      if (!reading) return res.status(400).json({ error: 'Chưa có chỉ số điện nước cho tháng này' });

      const other = await serviceOrdersTotal(userId, invoice.roomId, invoice.month);
      const amounts = computeInvoiceAmounts(room, reading, other);
      const updatedInvoice = stateStore.withOwnership({
        ...invoice,
        rent: room.baseRent ?? 0,
        electricUsage: amounts.eUse, electricEnd: reading.electricEnd, electricStart: reading.electricStart,
        waterUsage: amounts.wUse, waterEnd: reading.waterEnd, waterStart: reading.waterStart,
        electricAmount: amounts.electricAmount, waterAmount: amounts.waterAmount, other, total: amounts.total,
      }, userId, invoice);

      await db.upsertRow(db.TABLES.invoices, updatedInvoice);
      return res.json({ invoice: stateStore.stripSystemColumns(updatedInvoice) });
    } catch (error) {
      console.error('PUT /api/invoices/:id/from-reading error', error);
      return res.status(500).json({ error: error?.message || 'Không thể cập nhật hoá đơn.' });
    }
  });
}

module.exports = { registerPaymentWorkflowRoutes };
