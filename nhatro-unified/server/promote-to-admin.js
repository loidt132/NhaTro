/**
 * Admin Promotion Script — operates on the PostgreSQL (Neon) `users` table.
 * Usage: node promote-to-admin.js <email_or_phone>
 *
 * Run from the server directory with DATABASE_URL set (in server/.env or the
 * environment).
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) return;
      const key = trimmed.slice(0, eqIndex).trim();
      if (!key || process.env[key] != null) return;
      process.env[key] = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Failed to load env file ${filePath}:`, error.message);
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const db = require('./db');
const { decryptField } = require('./cryptoFields');

if (!db.isConfigured()) {
  console.error('Error: Thiếu DATABASE_URL (chuỗi kết nối Neon).');
  process.exit(1);
}

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

function normalizePhone(value = '') {
  return value.replace(/\D+/g, '');
}

function mapUser(row) {
  const parsed = Number(row?.maxRoomLimit);
  return {
    id: row.id,
    name: row.name || '',
    email: normalizeEmail(row.email || ''),
    phone: normalizePhone(decryptField(row.phone || '')),
    role: row.role || 'user',
    maxRoomLimit: row.maxRoomLimit !== null && row.maxRoomLimit !== undefined && Number.isFinite(parsed) ? parsed : null,
  };
}

async function loadUsers() {
  const rows = await db.query('SELECT id, name, email, phone, role, "maxRoomLimit" FROM users ORDER BY created_at');
  return rows.map(mapUser);
}

async function updateUser(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((key, i) => `${db.q(key)} = $${i + 1}`);
  const values = keys.map((key) => fields[key]);
  sets.push(`updated_by = $${values.length + 1}`, `updated_at = $${values.length + 2}`);
  values.push('script:promote-to-admin', new Date().toISOString());
  values.push(String(id));
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
}

function findUser(users, identifier) {
  const normalizedEmail = normalizeEmail(identifier);
  const normalizedPhone = normalizePhone(identifier);
  return users.find((u) => u.email === normalizedEmail || u.phone === normalizedPhone);
}

async function promoteToAdmin(identifier) {
  if (!identifier) {
    console.error('Error: Please provide an email or phone number');
    console.log('Usage: node promote-to-admin.js <email_or_phone>');
    process.exit(1);
  }

  const users = await loadUsers();
  if (users.length === 0) {
    console.error('Error: No users found.');
    process.exit(1);
  }

  const user = findUser(users, identifier);
  if (!user) {
    console.error(`Error: User with email/phone "${identifier}" not found`);
    console.log('\nAvailable users:');
    users.forEach((u, i) => console.log(`  ${i + 1}. ${u.name} (${u.email || u.phone})`));
    process.exit(1);
  }

  if (user.role === 'admin') {
    console.log(`✓ User "${user.name}" is already an admin`);
    return;
  }

  await updateUser(user.id, { role: 'admin' });
  console.log(`✓ Successfully promoted "${user.name}" to admin role`);
  console.log(`  Email: ${user.email || '(none)'}`);
  console.log(`  Phone: ${user.phone || '(none)'}`);
}

async function demoteFromAdmin(identifier) {
  if (!identifier) {
    console.error('Error: Please provide an email or phone number');
    console.log('Usage: node promote-to-admin.js demote <email_or_phone>');
    process.exit(1);
  }

  const users = await loadUsers();
  const user = findUser(users, identifier);
  if (!user) {
    console.error(`Error: User with email/phone "${identifier}" not found`);
    process.exit(1);
  }

  if (user.role !== 'admin') {
    console.log(`✓ User "${user.name}" is not an admin`);
    return;
  }

  await updateUser(user.id, { role: 'user' });
  console.log(`✓ Successfully demoted "${user.name}" from admin role`);
}

async function listUsers() {
  const users = await loadUsers();
  if (users.length === 0) {
    console.log('No users found');
    return;
  }

  console.log('\nRegistered Users:');
  console.log('─'.repeat(70));
  users.forEach((u, i) => {
    const role = u.role === 'admin' ? '👑 ADMIN' : '👤 USER';
    const roomLimit = u.maxRoomLimit === null || u.maxRoomLimit === undefined ? 'Unlimited' : u.maxRoomLimit;
    console.log(`${i + 1}. ${u.name}`);
    console.log(`   Role: ${role}`);
    console.log(`   Email: ${u.email || '(none)'}`);
    console.log(`   Phone: ${u.phone || '(none)'}`);
    console.log(`   Room Limit: ${roomLimit}`);
    console.log('');
  });
}

async function setRoomLimit(identifier, limit) {
  if (!identifier || limit === undefined) {
    console.error('Error: Please provide email/phone and room limit');
    console.log('Usage: node promote-to-admin.js limit <email_or_phone> <number>');
    process.exit(1);
  }

  const users = await loadUsers();
  const user = findUser(users, identifier);
  if (!user) {
    console.error(`Error: User with email/phone "${identifier}" not found`);
    process.exit(1);
  }

  const limitNum = parseInt(limit, 10);
  if (Number.isNaN(limitNum) || limitNum < 0) {
    console.error('Error: Room limit must be a positive number or 0 for unlimited');
    process.exit(1);
  }

  await updateUser(user.id, { maxRoomLimit: limitNum === 0 ? null : limitNum });
  console.log(`✓ Set room limit for "${user.name}" to ${limitNum === 0 ? 'unlimited' : limitNum}`);
}

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (!command || command === 'promote') {
    await promoteToAdmin(args[1]);
  } else if (command === 'demote') {
    await demoteFromAdmin(args[1]);
  } else if (command === 'list') {
    await listUsers();
  } else if (command === 'limit') {
    await setRoomLimit(args[1], args[2]);
  } else {
    console.log(`
User Management CLI (PostgreSQL-backed)

Commands:
  promote <email_or_phone>    Promote a user to admin
  demote <email_or_phone>     Demote an admin to regular user
  limit <email_or_phone> <n>  Set room limit (0 = unlimited)
  list                         List all users

Examples:
  node promote-to-admin.js promote user@example.com
  node promote-to-admin.js list
  node promote-to-admin.js limit user@example.com 5
    `);
  }
}

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
