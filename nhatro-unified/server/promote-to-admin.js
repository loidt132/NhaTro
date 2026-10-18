#!/usr/bin/env node

/**
 * Admin Promotion Script — operates on the NocoDB `users` table (the only
 * place user data lives now; there is no local users.json fallback anymore).
 * Usage: node promote-to-admin.js <email_or_phone>
 *
 * Run from the server directory with NOCODB_URL / NOCODB_API_KEY /
 * NOCODB_TABLE_USERS set (or VITE_NOCODB_URL / VITE_NOCODB_API_KEY /
 * VITE_TABLE_USERS, e.g. by pointing at ../web/.env.development).
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

[
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', 'web', '.env.development'),
].forEach(loadEnvFile);

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

const NOCODB_URL = firstEnv('NOCODB_URL', 'VITE_NOCODB_URL').replace(/\/+$/, '');
const NOCODB_API_KEY = firstEnv('NOCODB_API_KEY', 'VITE_NOCODB_API_KEY');
const NOCODB_TABLE_USERS = firstEnv('NOCODB_TABLE_USERS', 'VITE_TABLE_USERS');

if (!NOCODB_URL || !NOCODB_API_KEY || !NOCODB_TABLE_USERS) {
  console.error('Error: Thiếu NOCODB_URL / NOCODB_API_KEY / NOCODB_TABLE_USERS (hoặc bản VITE_ tương ứng).');
  process.exit(1);
}

function usersUrl(suffix = '') {
  return `${NOCODB_URL}/api/v2/tables/${encodeURIComponent(NOCODB_TABLE_USERS)}/records${suffix}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'xc-token': NOCODB_API_KEY, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.msg || data?.message || `NocoDB request failed (${response.status})`);
  return data;
}

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

function normalizePhone(value = '') {
  return value.replace(/\D+/g, '');
}

function readUserValue(row, variants) {
  for (const key of variants) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function mapUser(row) {
  return {
    rowId: row?.Id ?? row?.ID ?? null,
    id: readUserValue(row, ['id']),
    name: readUserValue(row, ['name']),
    email: normalizeEmail(readUserValue(row, ['email'])),
    phone: normalizePhone(readUserValue(row, ['phone'])),
    role: readUserValue(row, ['role']) || 'user',
    maxRoomLimit: (() => {
      const raw = readUserValue(row, ['maxRoomLimit', 'max_room_limit', 'maxroomlimit']);
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    })(),
  };
}

async function loadUsers() {
  const data = await request(usersUrl('?limit=1000'));
  return (data?.list || []).map(mapUser);
}

async function updateUser(rowId, fields) {
  await request(usersUrl(), { method: 'PATCH', body: JSON.stringify([{ Id: rowId, ...fields }]) });
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
    console.error('Error: No users found in NocoDB.');
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

  await updateUser(user.rowId, { role: 'admin' });
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

  await updateUser(user.rowId, { role: 'user' });
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

  await updateUser(user.rowId, { maxRoomLimit: limitNum === 0 ? null : limitNum });
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
User Management CLI (NocoDB-backed)

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

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});
