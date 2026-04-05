import crypto from 'node:crypto';
import {
  createUser,
  findUserByIdentifier,
  hashPassword,
  isConfigured,
  json,
  loadUsers,
  normalizeEmail,
  normalizePhone,
  parseJsonBody,
  publicUser,
  signToken,
} from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(res, 500, { error: 'Auth NocoDB env is missing on Vercel' });

  try {
    const { name, email, phone, password } = await parseJsonBody(req);
    const cleanName = (name || '').trim();
    const cleanEmail = normalizeEmail(email);
    const cleanPhone = normalizePhone(phone);
    const cleanPassword = typeof password === 'string' ? password : '';

    if (!cleanName) return json(res, 400, { error: 'Tên không được để trống' });
    if (!cleanEmail && !cleanPhone) return json(res, 400, { error: 'Nhập email hoặc số điện thoại' });
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return json(res, 400, { error: 'Email không hợp lệ' });
    if (cleanPhone && cleanPhone.length < 9) return json(res, 400, { error: 'Số điện thoại không hợp lệ' });
    if (cleanPassword.length < 6) return json(res, 400, { error: 'Mật khẩu tối thiểu 6 ký tự' });

    const users = await loadUsers();
    if (findUserByIdentifier(users, cleanEmail || cleanPhone)) {
      return json(res, 409, { error: cleanEmail ? 'Email đã được sử dụng' : 'Số điện thoại đã được sử dụng' });
    }

    const passwordData = hashPassword(cleanPassword);
    const user = {
      id: crypto.randomUUID(),
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      createdAt: new Date().toISOString(),
    };

    await createUser(user);
    const token = signToken({ userId: user.id, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) });
    return json(res, 201, { token, user: publicUser(user) });
  } catch (error) {
    return json(res, 500, { error: error.message || 'Không thể tạo tài khoản' });
  }
}
