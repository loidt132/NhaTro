// Field-level encryption for personal data at rest in the database
// (AES-256-GCM, one random IV per value).
//
// Stored formats
//   enc:v2:<kid>:<iv>:<tag>:<ciphertext>   current. <kid> identifies the key
//        used; the GCM additional-authenticated-data is "<table>.<column>:<rowId>",
//        so a ciphertext copied to another row/column fails to decrypt.
//   enc:v1:<iv>:<tag>:<ciphertext>         legacy (no key id, no AAD). Still
//        readable; rewritten as v2 by encrypt-existing-data.js.
//   anything else                          legacy plaintext, returned unchanged.
//
// Keys (32 bytes, 64 hex chars or base64)
//   ENCRYPTION_KEY           current key — used for every new write.
//   ENCRYPTION_KEY_PREVIOUS  optional, comma-separated retired keys, kept only
//                            so old values stay readable during a rotation.
//   BLIND_INDEX_KEY          optional key for the phone search index; derived
//                            from ENCRYPTION_KEY when unset.
//
// Fail-closed: when encryption is required (NODE_ENV=production, running on
// Vercel, or ENCRYPTION_REQUIRED=true) and ENCRYPTION_KEY is missing, writing a
// non-empty protected value throws instead of silently storing plaintext.
const crypto = require('crypto');

const PREFIX_V1 = 'enc:v1:';
const PREFIX_V2 = 'enc:v2:';

class EncryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EncryptionError';
    this.code = 'ENCRYPTION_ERROR';
  }
}

function parseKey(raw, label) {
  const text = String(raw || '').trim();
  const key = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (key.length !== 32) {
    throw new EncryptionError(`${label} must decode to exactly 32 bytes (64 hex chars or base64)`);
  }
  return key;
}

// Short, non-secret fingerprint stored in each v2 value so the right key can
// be picked after a rotation.
function keyIdOf(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

let keyring; // { current: {id, key} | null, byId: Map }
function getKeyring() {
  if (keyring) return keyring;
  const byId = new Map();
  let current = null;
  const rawCurrent = String(process.env.ENCRYPTION_KEY || '').trim();
  if (rawCurrent) {
    const key = parseKey(rawCurrent, 'ENCRYPTION_KEY');
    current = { id: keyIdOf(key), key };
    byId.set(current.id, current);
  }
  for (const part of String(process.env.ENCRYPTION_KEY_PREVIOUS || '').split(',')) {
    if (!part.trim()) continue;
    const key = parseKey(part, 'ENCRYPTION_KEY_PREVIOUS');
    const id = keyIdOf(key);
    if (!byId.has(id)) byId.set(id, { id, key });
  }
  keyring = { current, byId };
  return keyring;
}

// For tests / scripts that change process.env after load.
function resetKeyringForTests() {
  keyring = undefined;
  blindKey = undefined;
}

function isEncryptionConfigured() {
  return getKeyring().current !== null;
}

function isEncryptionRequired() {
  const flag = String(process.env.ENCRYPTION_REQUIRED || '').trim().toLowerCase();
  if (['true', '1', 'yes'].includes(flag)) return true;
  if (['false', '0', 'no'].includes(flag)) return false;
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

// Human-readable problem with the setup, or null when it's fine.
function encryptionProblem() {
  try {
    if (!isEncryptionConfigured() && isEncryptionRequired()) {
      return 'ENCRYPTION_KEY chưa được cấu hình — dữ liệu cá nhân sẽ bị từ chối ghi.';
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

function aadFor(context) {
  return Buffer.from(String(context || ''), 'utf8');
}

function encryptField(value, context = '') {
  if (value === null || value === undefined || value === '') return value;
  const { current } = getKeyring();
  if (!current) {
    if (isEncryptionRequired()) {
      throw new EncryptionError('ENCRYPTION_KEY chưa được cấu hình — từ chối lưu dữ liệu cá nhân dạng văn bản thô.');
    }
    return value; // local dev without a key: stay plaintext
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(aadFor(context));
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX_V2}${current.id}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function openGcm(key, ivB64, tagB64, dataB64, context) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  if (context !== null) decipher.setAAD(aadFor(context));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function decryptField(value, context = '') {
  if (typeof value !== 'string') return value;
  const { byId } = getKeyring();
  if (value.startsWith(PREFIX_V2)) {
    const [kid, ivB64, tagB64, dataB64] = value.slice(PREFIX_V2.length).split(':');
    if (!kid || !ivB64 || !tagB64 || !dataB64) throw new EncryptionError('Giá trị mã hóa sai định dạng.');
    const entry = byId.get(kid);
    if (!entry) throw new EncryptionError(`Không có khóa "${kid}" để giải mã — kiểm tra ENCRYPTION_KEY / ENCRYPTION_KEY_PREVIOUS.`);
    try {
      return openGcm(entry.key, ivB64, tagB64, dataB64, context);
    } catch {
      throw new EncryptionError('Giải mã thất bại (dữ liệu bị sửa hoặc sai ngữ cảnh).');
    }
  }
  if (value.startsWith(PREFIX_V1)) {
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX_V1.length).split(':');
    if (!ivB64 || !tagB64 || !dataB64) throw new EncryptionError('Giá trị mã hóa sai định dạng.');
    if (byId.size === 0) throw new EncryptionError('ENCRYPTION_KEY chưa được cấu hình — không giải mã được dữ liệu.');
    for (const { key } of byId.values()) {
      try {
        return openGcm(key, ivB64, tagB64, dataB64, null);
      } catch {
        // try the next key
      }
    }
    throw new EncryptionError('Giải mã thất bại với mọi khóa hiện có.');
  }
  return value; // legacy plaintext
}

// True when the stored value should be rewritten with the current key/format.
function needsReencrypt(value) {
  if (value === null || value === undefined || value === '') return false;
  const { current } = getKeyring();
  if (!current) return false;
  return !(typeof value === 'string' && value.startsWith(`${PREFIX_V2}${current.id}:`));
}

// ---- blind index: deterministic HMAC so rows can be found by phone without decrypting everything.
let blindKey;
function getBlindKey() {
  if (blindKey !== undefined) return blindKey;
  const explicit = String(process.env.BLIND_INDEX_KEY || '').trim();
  if (explicit) {
    blindKey = parseKey(explicit, 'BLIND_INDEX_KEY');
  } else {
    const { current } = getKeyring();
    blindKey = current ? Buffer.from(crypto.hkdfSync('sha256', current.key, Buffer.alloc(0), 'nhatro:blind-index:v1', 32)) : null;
  }
  return blindKey;
}

function normalizeDigits(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function blindIndex(value) {
  const digits = normalizeDigits(value);
  const key = getBlindKey();
  if (!digits || !key) return null;
  return crypto.createHmac('sha256', key).update(digits).digest('hex');
}

// Which columns get encrypted at rest, per collection key.
const ENCRYPTED_FIELDS = {
  tenants: ['cccd', 'phone'],
  users: ['phone'],
  settings: ['accountNo', 'landlordPhone', 'landlordAddress'],
};
const TABLE_OF = { tenants: 'tenants', users: 'users', settings: 'settings' };

// Searchable hash columns kept next to an encrypted one: { collection: { field: indexColumn } }.
const BLIND_INDEXES = {
  tenants: { phone: 'phone_idx' },
};

function contextFor(key, field, row) {
  return `${TABLE_OF[key] || key}.${field}:${row?.id ?? ''}`;
}

function encryptRow(key, row) {
  const fields = ENCRYPTED_FIELDS[key];
  if (!fields || !row) return row;
  const out = { ...row };
  for (const field of fields) {
    if (!(field in out)) continue;
    const plain = out[field];
    out[field] = encryptField(plain, contextFor(key, field, row));
    const indexColumn = BLIND_INDEXES[key]?.[field];
    if (indexColumn) out[indexColumn] = blindIndex(plain);
  }
  return out;
}

function decryptRow(key, row) {
  const fields = ENCRYPTED_FIELDS[key];
  if (!fields || !row) return row;
  const out = { ...row };
  for (const field of fields) {
    if (field in out) out[field] = decryptField(out[field], contextFor(key, field, row));
  }
  for (const indexColumn of Object.values(BLIND_INDEXES[key] || {})) delete out[indexColumn];
  return out;
}

module.exports = {
  EncryptionError,
  ENCRYPTED_FIELDS,
  BLIND_INDEXES,
  isEncryptionConfigured,
  isEncryptionRequired,
  encryptionProblem,
  encryptField,
  decryptField,
  encryptRow,
  decryptRow,
  contextFor,
  needsReencrypt,
  blindIndex,
  keyIdOf,
  getKeyring,
  resetKeyringForTests,
};
