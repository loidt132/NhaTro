// Field-level encryption for sensitive tenant data (CCCD/ID number, phone)
// at rest in NocoDB. AES-256-GCM, one random IV per value.
//
// ENCRYPTION_KEY must be a 32-byte key, given as 64 hex chars or base64.
// Values that aren't in our "enc:v1:..." format are returned unchanged on
// decrypt, so existing plaintext rows keep working without a migration —
// they just get encrypted the next time they're written.
const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function loadKey() {
  const raw = process.env.ENCRYPTION_KEY || '';
  if (!raw) return null;
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or base64)');
  }
  return key;
}

let cachedKey;
function getKey() {
  if (cachedKey === undefined) cachedKey = loadKey();
  return cachedKey;
}

function isEncryptionConfigured() {
  return getKey() !== null;
}

function encryptField(value) {
  if (value === null || value === undefined || value === '') return value;
  const key = getKey();
  if (!key) return value; // not configured — leave as plaintext rather than crash
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptField(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) return value; // can't decrypt without the key — surface as-is
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !dataB64) return value;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

// Which columns get encrypted at rest, per NocoDB collection key (stateStore.js's keys).
const ENCRYPTED_FIELDS = {
  tenants: ['cccd', 'phone'],
};

function encryptRow(key, row) {
  const fields = ENCRYPTED_FIELDS[key];
  if (!fields || !row) return row;
  const out = { ...row };
  for (const field of fields) {
    if (field in out) out[field] = encryptField(out[field]);
  }
  return out;
}

function decryptRow(key, row) {
  const fields = ENCRYPTED_FIELDS[key];
  if (!fields || !row) return row;
  const out = { ...row };
  for (const field of fields) {
    if (field in out) out[field] = decryptField(out[field]);
  }
  return out;
}

module.exports = {
  isEncryptionConfigured,
  encryptField,
  decryptField,
  encryptRow,
  decryptRow,
};
