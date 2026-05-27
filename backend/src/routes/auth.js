import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { comparePassword, hashPassword, signToken } from '../lib/auth.js';
import { fail, ok } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();
const serializeUser = (row) => ({ id: row.id, email: row.email, fullName: row.full_name, role: row.role, points: row.points, membershipLevel: row.membership_level, customerTag: row.customer_tag || 'new' });


function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isValidFullName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length >= 2 && !/\d/.test(text);
}

function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(String(password || ''));
}

function getReviewError({ rating, comment }) {
  const rate = Number(rating || 0);
  const text = String(comment || '').trim();
  if (!Number.isInteger(rate) || rate < 1 || rate > 5) return 'Điểm đánh giá phải từ 1 đến 5 sao.';
  if (text.length < 10) return 'Nhận xét phải có ít nhất 10 ký tự.';
  if (text.length > 500) return 'Nhận xét không được vượt quá 500 ký tự.';
  if (/(.)\1{9,}/i.test(text)) return 'Nhận xét không được lặp ký tự quá nhiều.';
  return null;
}
async function buildCouponReminderNotifications(userId) {
  const result = await query(`SELECT DISTINCT c.id AS coupon_id, c.code, c.ends_at, c.usage_limit, c.used_count
    FROM notifications n
    JOIN coupons c ON c.id = n.coupon_id
    WHERE n.user_id = $1 AND n.coupon_id IS NOT NULL AND c.active = 1`, [userId]);
  const now = new Date();
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const reminders = [];
  for (const coupon of result.rows) {
    if (coupon.ends_at) {
      const endsAt = new Date(coupon.ends_at);
      if (endsAt >= now && endsAt <= nextWeek) {
        reminders.push({
          id: `coupon-expiring-${coupon.coupon_id}`,
          title: `Voucher ${coupon.code} sắp hết hạn`,
          message: `Voucher ${coupon.code} sẽ hết hạn vào ${endsAt.toLocaleDateString('vi-VN')}.`,
          sent_at: endsAt.toISOString(),
          is_read: 0,
          generated: true
        });
      }
    }
    if (coupon.usage_limit && Number(coupon.used_count) >= Number(coupon.usage_limit)) {
      reminders.push({
        id: `coupon-exhausted-${coupon.coupon_id}`,
        title: `Voucher ${coupon.code} đã dùng hết`,
        message: `Voucher ${coupon.code} đã hết lượt sử dụng.`,
        sent_at: now.toISOString(),
        is_read: 0,
        generated: true
      });
    }
  }
  return reminders;
}

async function listOrdersForUser(userId) {
  const orders = (await query(`SELECT o.id, o.order_code, o.created_at, o.grand_total, o.order_status, o.payment_status,
      o.shipping_provider, o.tracking_code, o.shipping_address
    FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [userId])).rows;
  if (!orders.length) return [];
  const orderIds = orders.map((order) => order.id);
  const items = (await query(`SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, oi.line_total,
      p.slug,
      pr.id AS review_id, pr.rating AS review_rating
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_reviews pr ON pr.order_item_id = oi.id AND pr.user_id = $1
    WHERE oi.order_id IN (${orderIds.map((_, index) => `$${index + 2}`).join(',')})
    ORDER BY oi.order_id DESC, oi.id ASC`, [userId, ...orderIds])).rows;
  return orders.map((order) => ({
    ...order,
    items: items.filter((item) => item.order_id === order.id).map((item) => ({
      ...item,
      canReview: order.payment_status === 'paid' || order.order_status === 'completed',
      hasReview: Boolean(item.review_id)
    }))
  }));
}

authRouter.post('/register', async (req, res) => {
  const body = req.body || {};
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const phone = String(body.phone || '').trim();

  if (!isValidFullName(fullName)) {
    return res.status(400).json({ message: 'Họ tên phải có ít nhất 2 ký tự và không được chứa số.' });
  }

  if (!email) {
    return res.status(400).json({ message: 'Vui lòng nhập email.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Vui lòng nhập email hợp lệ.' });
  }

  if (!password) {
    return res.status(400).json({ message: 'Vui lòng nhập mật khẩu.' });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({
      message: 'Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'
    });
  }

  if (phone && !/^0\d{9}$/.test(phone)) {
    return res.status(400).json({ message: 'Số điện thoại phải gồm 10 số và bắt đầu bằng 0.' });
  }

  const existed = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existed.rows.length) {
    return res.status(409).json({ message: 'Email này đã được sử dụng.' });
  }

  const passwordHash = await hashPassword(password);
  const result = await query(
    `INSERT INTO users(email, password_hash, full_name, phone, role, points, membership_level, is_active)
     OUTPUT INSERTED.id, INSERTED.email, INSERTED.full_name, INSERTED.role, INSERTED.points, INSERTED.membership_level, INSERTED.customer_tag
     VALUES ($1, $2, $3, $4, 'customer', 0, 'Member', 1)`,
    [email, passwordHash, fullName, phone || '']
  );

  const user = result.rows[0];
  const token = signToken(user);
  return ok(res, { token, user: serializeUser(user) }, 201);
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, 'Thiếu email hoặc mật khẩu');
  const result = await query('SELECT id, email, password_hash, full_name, role, points, membership_level, customer_tag FROM users WHERE email = $1 AND is_active = 1', [String(email).toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await comparePassword(password, user.password_hash))) return fail(res, 'Sai tài khoản hoặc mật khẩu', 401);
  return ok(res, { token: signToken(user), user: serializeUser(user) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const [addresses, wishlist, notifications, reminders] = await Promise.all([
    query('SELECT id, label, recipient_name, phone, line1, ward, district, city, is_default FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [req.user.id]),
    query(`SELECT p.id, p.name, p.slug, ISNULL(p.sale_price, p.price) AS price FROM wishlists w JOIN products p ON p.id = w.product_id WHERE w.user_id = $1 AND p.is_active = 1`, [req.user.id]),
    query('SELECT TOP 20 id, title, message, sent_at, is_read, coupon_id FROM notifications WHERE user_id = $1 ORDER BY sent_at DESC', [req.user.id]),
    buildCouponReminderNotifications(req.user.id)
  ]);
  const notificationRows = [...reminders, ...notifications.rows].sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
  return ok(res, { user: serializeUser(req.user), addresses: addresses.rows, wishlist: wishlist.rows, notifications: notificationRows, unreadCount: notificationRows.filter((n) => !Number(n.is_read)).length });
});

authRouter.get('/orders', requireAuth, async (req, res) => ok(res, await listOrdersForUser(req.user.id)));

authRouter.post('/wishlist/:productId', requireAuth, async (req, res) => {
  const exists = await query('SELECT id FROM wishlists WHERE user_id = $1 AND product_id = $2', [req.user.id, req.params.productId]);
  if (exists.rows[0]) {
    await query('DELETE FROM wishlists WHERE id = $1', [exists.rows[0].id]);
    return ok(res, { added: false });
  }
  await query('INSERT INTO wishlists(user_id, product_id) VALUES ($1,$2)', [req.user.id, req.params.productId]);
  return ok(res, { added: true }, 201);
});

authRouter.post('/addresses', requireAuth, async (req, res) => {
  const body = req.body || {};
  if (!body.line1 || !body.city || !body.phone || !body.recipientName) return fail(res, 'Thiếu thông tin địa chỉ');
  if (!isValidFullName(body.recipientName)) return fail(res, 'Tên người nhận phải có ít nhất 2 ký tự và không được chứa số', 400);
  if (body.isDefault) await query('UPDATE addresses SET is_default = 0 WHERE user_id = $1', [req.user.id]);
  const result = await query('INSERT INTO addresses(user_id, label, recipient_name, phone, line1, ward, district, city, is_default) OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [req.user.id, body.label || 'Nhà riêng', body.recipientName || req.user.full_name, body.phone || req.user.phone || '', body.line1, body.ward || '', body.district || '', body.city || '', body.isDefault ? 1 : 0]);
  return ok(res, result.rows[0], 201);
});

authRouter.post('/notifications/:id/read', requireAuth, async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  return ok(res, { id: req.params.id, isRead: true });
});

authRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND is_read = 0', [req.user.id]);
  return ok(res, { success: true });
});

authRouter.post('/reviews', requireAuth, async (req, res) => {
  const { orderItemId, rating, comment } = req.body || {};
  if (!orderItemId) return fail(res, 'Thiếu dòng sản phẩm cần đánh giá', 400);
  const reviewError = getReviewError({ rating, comment });
  if (reviewError) return fail(res, reviewError, 400);
  const orderItem = (await query(`SELECT TOP 1 oi.id, oi.product_id, oi.order_id, oi.product_name
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.id = $1 AND o.user_id = $2 AND (o.payment_status = 'paid' OR o.order_status = 'completed')`, [orderItemId, req.user.id])).rows[0];
  if (!orderItem) return fail(res, 'Bạn chỉ có thể đánh giá sản phẩm đã mua và đã thanh toán hoặc hoàn thành', 403);
  const rate = Number(rating);
  const reviewComment = String(comment || '').trim();
  const exists = (await query('SELECT id FROM product_reviews WHERE user_id = $1 AND order_item_id = $2', [req.user.id, orderItemId])).rows[0];
  await withTransaction(async (tx) => {
    if (exists) {
      await query('UPDATE product_reviews SET rating = $3, comment = $4, updated_at = SYSUTCDATETIME(), is_visible = 1 WHERE id = $1 AND user_id = $2', [exists.id, req.user.id, rate, reviewComment], tx);
    } else {
      await query('INSERT INTO product_reviews(user_id, product_id, order_item_id, rating, comment, is_visible) VALUES ($1,$2,$3,$4,$5,1)', [req.user.id, orderItem.product_id, orderItemId, rate, reviewComment], tx);
    }
    await query(`UPDATE products SET
      rating = ISNULL((SELECT AVG(CAST(rating AS DECIMAL(10,2))) FROM product_reviews WHERE product_id = $1 AND is_visible = 1), 0),
      review_count = ISNULL((SELECT COUNT(*) FROM product_reviews WHERE product_id = $1 AND is_visible = 1), 0),
      updated_at = SYSUTCDATETIME()
      WHERE id = $1`, [orderItem.product_id], tx);
  });
  return ok(res, { success: true });
});
