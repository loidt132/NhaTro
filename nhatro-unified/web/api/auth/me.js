import { isConfigured, json, loadUsers, publicUser, verifyToken } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(res, 500, { error: 'Auth NocoDB env is missing on Vercel' });

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) return json(res, 401, { error: 'Unauthorized' });

    const users = await loadUsers();
    const user = users.find((item) => item.id === payload.userId);
    if (!user) return json(res, 401, { error: 'Unauthorized' });

    return json(res, 200, { user: publicUser(user) });
  } catch (error) {
    return json(res, 500, { error: error.message || 'Auth lookup failed' });
  }
}
