import {
  findUserByIdentifier,
  isConfigured,
  json,
  loadUsers,
  parseJsonBody,
  publicUser,
  signToken,
  verifyPassword,
} from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(res, 500, { error: 'Auth NocoDB env is missing on Vercel' });

  try {
    const { identifier, password } = await parseJsonBody(req);
    const cleanIdentifier = (identifier || '').trim();
    const cleanPassword = typeof password === 'string' ? password : '';

    if (!cleanIdentifier || !cleanPassword) {
      return json(res, 400, { error: 'Nhập email hoặc số điện thoại và mật khẩu' });
    }

    const users = await loadUsers();
    const user = findUserByIdentifier(users, cleanIdentifier);
    if (!user || !user.passwordSalt || !user.passwordHash || !verifyPassword(cleanPassword, user.passwordSalt, user.passwordHash)) {
      return json(res, 401, { error: 'Thông tin đăng nhập không đúng' });
    }

    const token = signToken({ userId: user.id, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) });
    return json(res, 200, { token, user: publicUser(user) });
  } catch (error) {
    return json(res, 500, { error: error.message || 'Không thể đăng nhập' });
  }
}
