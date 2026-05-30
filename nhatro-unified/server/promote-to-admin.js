#!/usr/bin/env node

/**
 * Admin Promotion Script
 * Usage: node promote-to-admin.js <email_or_phone>
 * 
 * This script promotes an existing user to admin role.
 * Run from the server directory.
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const usersPath = path.join(dataDir, 'users.json');

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

function normalizePhone(value = '') {
  return value.replace(/\D+/g, '');
}

function loadUsers() {
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Failed to load users:', error.message);
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save users:', error.message);
    return false;
  }
}

async function promoteToAdmin(identifier) {
  if (!identifier) {
    console.error('Error: Please provide an email or phone number');
    console.log('Usage: node promote-to-admin.js <email_or_phone>');
    process.exit(1);
  }

  const users = loadUsers();
  if (users.length === 0) {
    console.error('Error: No users found. Please register a user first.');
    process.exit(1);
  }

  const normalizedEmail = normalizeEmail(identifier);
  const normalizedPhone = normalizePhone(identifier);
  
  const user = users.find(
    (u) => u.email === normalizedEmail || u.phone === normalizedPhone
  );

  if (!user) {
    console.error(`Error: User with email/phone "${identifier}" not found`);
    console.log('\nAvailable users:');
    users.forEach((u, i) => {
      console.log(`  ${i + 1}. ${u.name} (${u.email || u.phone})`);
    });
    process.exit(1);
  }

  if (user.role === 'admin') {
    console.log(`✓ User "${user.name}" is already an admin`);
    process.exit(0);
  }

  user.role = 'admin';
  if (saveUsers(users)) {
    console.log(`✓ Successfully promoted "${user.name}" to admin role`);
    console.log(`  Email: ${user.email || '(none)'}`);
    console.log(`  Phone: ${user.phone || '(none)'}`);
  } else {
    process.exit(1);
  }
}

async function demoteFromAdmin(identifier) {
  if (!identifier) {
    console.error('Error: Please provide an email or phone number');
    console.log('Usage: node promote-to-admin.js demote <email_or_phone>');
    process.exit(1);
  }

  const users = loadUsers();
  if (users.length === 0) {
    console.error('Error: No users found.');
    process.exit(1);
  }

  const normalizedEmail = normalizeEmail(identifier);
  const normalizedPhone = normalizePhone(identifier);
  
  const user = users.find(
    (u) => u.email === normalizedEmail || u.phone === normalizedPhone
  );

  if (!user) {
    console.error(`Error: User with email/phone "${identifier}" not found`);
    process.exit(1);
  }

  if (user.role !== 'admin') {
    console.log(`✓ User "${user.name}" is not an admin`);
    process.exit(0);
  }

  user.role = 'user';
  if (saveUsers(users)) {
    console.log(`✓ Successfully demoted "${user.name}" from admin role`);
  } else {
    process.exit(1);
  }
}

async function listUsers() {
  const users = loadUsers();
  if (users.length === 0) {
    console.log('No users found');
    return;
  }

  console.log('\nRegistered Users:');
  console.log('─'.repeat(70));
  users.forEach((u, i) => {
    const role = u.role === 'admin' ? '👑 ADMIN' : '👤 USER';
    const roomLimit = u.maxRoomLimit === null || u.maxRoomLimit === undefined 
      ? 'Unlimited' 
      : u.maxRoomLimit;
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

  const users = loadUsers();
  const normalizedEmail = normalizeEmail(identifier);
  const normalizedPhone = normalizePhone(identifier);
  
  const user = users.find(
    (u) => u.email === normalizedEmail || u.phone === normalizedPhone
  );

  if (!user) {
    console.error(`Error: User with email/phone "${identifier}" not found`);
    process.exit(1);
  }

  const limitNum = parseInt(limit, 10);
  if (isNaN(limitNum) || limitNum < 0) {
    console.error('Error: Room limit must be a positive number or 0 for unlimited');
    process.exit(1);
  }

  user.maxRoomLimit = limitNum === 0 ? null : limitNum;
  if (saveUsers(users)) {
    const limitText = limitNum === 0 ? 'unlimited' : limitNum;
    console.log(`✓ Set room limit for "${user.name}" to ${limitText}`);
  } else {
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'promote') {
  promoteToAdmin(args[1]);
} else if (command === 'demote') {
  demoteFromAdmin(args[1]);
} else if (command === 'list') {
  listUsers();
} else if (command === 'limit') {
  setRoomLimit(args[1], args[2]);
} else {
  console.log(`
User Management CLI

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
