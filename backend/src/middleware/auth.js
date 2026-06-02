import { fail } from '../lib/http.js';
import { verifyToken } from '../lib/auth.js';
import { query } from '../lib/db.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'Unauthorized', 401);
  try {
    const payload = verifyToken(token);
    let user = null;
    try {
      const result = await query(`SELECT id, email, full_name, phone, role, points, membership_level, customer_tag,
        email_verified, email_verified_at, email_verification_status
        FROM users WHERE id = $1 AND is_active = 1`, [payload.sub]);
      user = result.rows[0] || null;
    } catch {
      const result = await query('SELECT id, email, full_name, phone, role, points, membership_level, customer_tag, email_verified FROM users WHERE id = $1 AND is_active = 1', [payload.sub]);
      user = result.rows[0] ? { ...result.rows[0], email_verified_at: null, email_verification_status: null } : null;
    }
    if (!user) return fail(res, 'User not found', 401);
    req.user = user;
    next();
  } catch (error) {
    return fail(res, 'Invalid token', 401, error.message);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 'Unauthorized', 401);
    if (!roles.includes(req.user.role)) return fail(res, 'Forbidden', 403);
    next();
  };
}
