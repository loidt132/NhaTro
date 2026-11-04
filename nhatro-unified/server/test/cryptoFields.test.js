const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function load(env = {}) {
  for (const name of ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_PREVIOUS', 'BLIND_INDEX_KEY', 'ENCRYPTION_REQUIRED', 'NODE_ENV', 'VERCEL']) {
    delete process.env[name];
  }
  Object.assign(process.env, env);
  const mod = require('../cryptoFields');
  mod.resetKeyringForTests();
  return mod;
}

// Same construction as the pre-v2 implementation, to prove old rows stay readable.
function legacyV1(key, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

test('round trip with v2 format and random IV', () => {
  const c = load({ ENCRYPTION_KEY: KEY_A });
  const a = c.encryptField('012345678901', 'tenants.cccd:t1');
  const b = c.encryptField('012345678901', 'tenants.cccd:t1');
  assert.match(a, /^enc:v2:[0-9a-f]{8}:/);
  assert.notEqual(a, b);
  assert.equal(c.decryptField(a, 'tenants.cccd:t1'), '012345678901');
});

test('ciphertext moved to another row or column does not decrypt', () => {
  const c = load({ ENCRYPTION_KEY: KEY_A });
  const enc = c.encryptField('0901234567', 'tenants.phone:t1');
  assert.throws(() => c.decryptField(enc, 'tenants.phone:t2'), c.EncryptionError);
  assert.throws(() => c.decryptField(enc, 'tenants.cccd:t1'), c.EncryptionError);
});

test('tampered ciphertext is rejected', () => {
  const c = load({ ENCRYPTION_KEY: KEY_A });
  const enc = c.encryptField('secret', 'x:1');
  const parts = enc.split(':');
  parts[5] = Buffer.from('tampered!').toString('base64');
  assert.throws(() => c.decryptField(parts.join(':'), 'x:1'), c.EncryptionError);
});

test('legacy plaintext and enc:v1 values are still readable', () => {
  const c = load({ ENCRYPTION_KEY: KEY_A });
  assert.equal(c.decryptField('0901234567', 'tenants.phone:t1'), '0901234567');
  assert.equal(c.decryptField(legacyV1(KEY_A, '0901234567'), 'tenants.phone:t1'), '0901234567');
  assert.equal(c.needsReencrypt('0901234567'), true);
  assert.equal(c.needsReencrypt(legacyV1(KEY_A, 'x')), true);
});

test('key rotation: old values readable via ENCRYPTION_KEY_PREVIOUS, flagged for re-encryption', () => {
  const oldC = load({ ENCRYPTION_KEY: KEY_A });
  const oldValue = oldC.encryptField('0901234567', 'tenants.phone:t1');

  const c = load({ ENCRYPTION_KEY: KEY_B, ENCRYPTION_KEY_PREVIOUS: KEY_A });
  assert.equal(c.decryptField(oldValue, 'tenants.phone:t1'), '0901234567');
  assert.equal(c.needsReencrypt(oldValue), true);
  const fresh = c.encryptField('0901234567', 'tenants.phone:t1');
  assert.equal(c.needsReencrypt(fresh), false);

  const withoutOld = load({ ENCRYPTION_KEY: KEY_B });
  assert.throws(() => withoutOld.decryptField(oldValue, 'tenants.phone:t1'), withoutOld.EncryptionError);
});

test('fail-closed: required but no key throws instead of storing plaintext', () => {
  const c = load({ NODE_ENV: 'production' });
  assert.equal(c.isEncryptionRequired(), true);
  assert.ok(c.encryptionProblem());
  assert.throws(() => c.encryptField('0901234567', 'x:1'), c.EncryptionError);
  assert.equal(c.encryptField('', 'x:1'), ''); // empty values are never an issue
});

test('dev without a key keeps plaintext', () => {
  const c = load({});
  assert.equal(c.isEncryptionRequired(), false);
  assert.equal(c.encryptField('0901234567', 'x:1'), '0901234567');
});

test('rejects a key of the wrong length', () => {
  const c = load({ ENCRYPTION_KEY: 'abcd' });
  assert.throws(() => c.getKeyring(), /32 bytes/);
});

test('encryptRow / decryptRow cover tenants, users and settings, and add/strip the phone index', () => {
  const c = load({ ENCRYPTION_KEY: KEY_A });
  const tenant = c.encryptRow('tenants', { id: 't1', name: 'An', cccd: '012345678901', phone: '0901 234 567' });
  assert.match(tenant.cccd, /^enc:v2:/);
  assert.match(tenant.phone, /^enc:v2:/);
  assert.equal(tenant.name, 'An');
  assert.equal(tenant.phone_idx, c.blindIndex('0901234567'));
  const back = c.decryptRow('tenants', tenant);
  assert.equal(back.cccd, '012345678901');
  assert.equal(back.phone, '0901 234 567');
  assert.ok(!('phone_idx' in back));

  const settings = c.encryptRow('settings', { id: 'settings:u1', accountNo: '123', landlordPhone: '09', landlordAddress: 'HN', bankCode: 'VCB' });
  assert.match(settings.accountNo, /^enc:v2:/);
  assert.match(settings.landlordAddress, /^enc:v2:/);
  assert.equal(settings.bankCode, 'VCB');
  assert.deepEqual(c.decryptRow('settings', settings), { id: 'settings:u1', accountNo: '123', landlordPhone: '09', landlordAddress: 'HN', bankCode: 'VCB' });

  const user = c.encryptRow('users', { id: 'u1', phone: '0912345678' });
  assert.equal(c.decryptRow('users', user).phone, '0912345678');
  assert.ok(!('phone_idx' in user));
});

test('blind index is deterministic over digits only and depends on the key', () => {
  const c = load({ ENCRYPTION_KEY: KEY_A });
  assert.equal(c.blindIndex('0901 234 567'), c.blindIndex('0901234567'));
  assert.notEqual(c.blindIndex('0901234567'), c.blindIndex('0901234568'));
  assert.equal(c.blindIndex(''), null);
  // load() reuses one module instance, so capture each value before reloading.
  const withA = c.blindIndex('0901234567');
  const withB = load({ ENCRYPTION_KEY: KEY_B }).blindIndex('0901234567');
  assert.notEqual(withB, withA);
  const withExplicit = load({ ENCRYPTION_KEY: KEY_A, BLIND_INDEX_KEY: KEY_B }).blindIndex('0901234567');
  assert.notEqual(withExplicit, withA);
});
