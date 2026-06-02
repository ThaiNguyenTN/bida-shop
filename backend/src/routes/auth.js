import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { comparePassword, hashPassword, signToken } from '../lib/auth.js';
import { fail, ok, parseJson } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import {
  buildOtpState,
  getOtpCooldownSeconds,
  hashOtpCode,
  isOtpExpired,
  OTP_MAX_ATTEMPTS,
  sendVerificationOtpEmail
} from '../services/auth/emailOtp.js';
import { ensureEmailVerificationSchema } from '../services/auth/emailVerificationSchema.js';

export const authRouter = Router();

const authUserColumns = `id, email, password_hash, full_name, phone, role, points, membership_level, customer_tag,
  email_verified, email_verified_at, email_verification_status, email_otp_hash, email_otp_expires_at,
  email_otp_last_sent_at, email_otp_attempt_count`;

const serializeUser = (row) => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  role: row.role,
  points: row.points,
  membershipLevel: row.membership_level,
  customerTag: row.customer_tag || 'new',
  emailVerified: Boolean(row.email_verified),
  emailVerificationStatus: row.email_verification_status || (row.email_verified ? 'verified' : 'pending')
});

function requiresVerifiedEmail(user) {
  if (!user) return false;
  if (String(user.role || '').toLowerCase() !== 'customer') return false;
  const hasOtpWorkflowState = user.email_verification_status != null || user.email_otp_hash != null || user.email_otp_expires_at != null || user.email_otp_last_sent_at != null;
  if (!hasOtpWorkflowState) return false;
  return !Number(user.email_verified);
}

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

function reviewContainsLink(text) {
  return /(https?:\/\/|www\.|[a-z0-9-]+\.(com|vn|net|org|io|co|me|info|xyz|shop|site|link)\b)/i.test(String(text || '').trim());
}

function verificationResponse(email, cooldownSeconds = 60) {
  return {
    requiresEmailVerification: true,
    email,
    cooldownSeconds
  };
}

function getEmailVerificationSetupError(error) {
  const message = String(error?.message || '');
  if (error?.code === 'ELOGIN' || /login failed for user/i.test(message)) {
    return {
      message: 'Backend không kết nối được SQL Server. Kiểm tra lại DB_USER/DB_PASSWORD trong backend/.env.',
      details: message
    };
  }
  return {
    message: 'Hệ thống chưa sẵn sàng cho xác thực email. Hãy chạy patch email OTP rồi thử lại.',
    details: message
  };
}

function getEmailDeliveryError(error) {
  const message = String(error?.message || '');
  if (error?.code === 'SMTP_UNAUTHORIZED_IP') {
    return {
      message: 'SMTP đang chặn IP hiện tại. Với Brevo, bạn cần cho phép IP máy chạy backend hoặc dùng SMTP khác.',
      details: message
    };
  }
  if (error?.code === 'SMTP_NOT_CONFIGURED') {
    return {
      message: 'SMTP chưa được cấu hình đúng trong backend/.env.',
      details: message
    };
  }
  return {
    message: 'Không gửi được email OTP. Kiểm tra lại cấu hình SMTP rồi thử lại.',
    details: message
  };
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
          title: `Voucher ${coupon.code} sap het han`,
          message: `Voucher ${coupon.code} se het han vao ${endsAt.toLocaleDateString('vi-VN')}.`,
          sent_at: endsAt.toISOString(),
          is_read: 0,
          generated: true
        });
      }
    }
    if (coupon.usage_limit && Number(coupon.used_count) >= Number(coupon.usage_limit)) {
      reminders.push({
        id: `coupon-exhausted-${coupon.coupon_id}`,
        title: `Voucher ${coupon.code} da dung het`,
        message: `Voucher ${coupon.code} da het luot su dung.`,
        sent_at: now.toISOString(),
        is_read: 0,
        generated: true
      });
    }
  }
  return reminders;
}

function parseNotificationIds(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  return [...new Set(rawIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

async function listDbNotificationsForUser(userId, limit = 100) {
  return (await query(`SELECT TOP ${Math.max(1, Number(limit || 100))} id, title, message, sent_at, is_read, coupon_id
    FROM notifications
    WHERE user_id = $1
    ORDER BY sent_at DESC, id DESC`, [userId])).rows;
}

async function listOrdersForUser(userId) {
  let orders = [];
  try {
    orders = (await query(`SELECT o.id, o.order_code, o.created_at, o.grand_total, o.order_status, o.payment_status,
      o.payment_method, o.payment_provider, o.payment_ref, o.shipping_provider, o.tracking_code, o.shipping_address
    FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [userId])).rows;
  } catch {
    orders = (await query(`SELECT o.id, o.order_code, o.created_at, o.grand_total, o.order_status, o.payment_status,
      o.payment_method, o.shipping_provider, o.tracking_code, o.shipping_address
    FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [userId])).rows;
  }
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
    shipping_address: parseJson(order.shipping_address, {}),
    items: items.filter((item) => item.order_id === order.id).map((item) => ({
      ...item,
      canReview: order.payment_status === 'paid' || order.order_status === 'completed',
      hasReview: Boolean(item.review_id)
    }))
  }));
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  try {
    const result = await query(`SELECT ${authUserColumns} FROM users WHERE email = $1 AND is_active = 1`, [normalizedEmail]);
    return result.rows[0] || null;
  } catch {
    const result = await query('SELECT id, email, password_hash, full_name, phone, role, points, membership_level, customer_tag, email_verified FROM users WHERE email = $1 AND is_active = 1', [normalizedEmail]);
    const user = result.rows[0] || null;
    if (!user) return null;
    return {
      ...user,
      email_verified_at: null,
      email_verification_status: null,
      email_otp_hash: null,
      email_otp_expires_at: null,
      email_otp_last_sent_at: null,
      email_otp_attempt_count: 0
    };
  }
}

async function issueOtpForUser(userId, email, tx = null) {
  const otpState = buildOtpState();
  await query(`UPDATE users
    SET email_verified = 0,
        email_verified_at = NULL,
        email_verification_status = 'pending',
        email_otp_hash = $2,
        email_otp_expires_at = $3,
        email_otp_last_sent_at = $4,
        email_otp_attempt_count = 0,
        verification_token = NULL,
        updated_at = SYSUTCDATETIME()
    WHERE id = $1`, [userId, otpState.otpHash, otpState.expiresAt, otpState.sentAt], tx);
  await sendVerificationOtpEmail(email, otpState.otp);
  return otpState;
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
  if (!email) return res.status(400).json({ message: 'Vui lòng nhập email.' });
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Vui lòng nhập email hợp lệ.' });
  if (!password) return res.status(400).json({ message: 'Vui lòng nhập mật khẩu.' });
  if (!isStrongPassword(password)) {
    return res.status(400).json({
      message: 'Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'
    });
  }
  if (phone && !/^0\d{9}$/.test(phone)) {
    return res.status(400).json({ message: 'Số điện thoại phải gồm 10 số và bắt đầu bằng 0.' });
  }

  const existed = await query('SELECT id, email_verified FROM users WHERE email = $1', [email]);
  if (existed.rows.length) {
    return res.status(409).json({ message: 'Email này đã được sử dụng.' });
  }

  try {
    await ensureEmailVerificationSchema();
  } catch (error) {
    const setupError = getEmailVerificationSetupError(error);
    return fail(res, setupError.message, 500, setupError.details);
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await withTransaction(async (tx) => {
      const result = await query(
        `INSERT INTO users(email, password_hash, full_name, phone, role, points, membership_level, is_active, email_verified, email_verification_status)
         OUTPUT INSERTED.id, INSERTED.email, INSERTED.full_name, INSERTED.role, INSERTED.points, INSERTED.membership_level, INSERTED.customer_tag
         VALUES ($1, $2, $3, $4, 'customer', 0, 'Member', 1, 0, 'pending')`,
        [email, passwordHash, fullName, phone || ''],
        tx
      );
      const insertedUser = result.rows[0];
      await issueOtpForUser(insertedUser.id, email, tx);
      return insertedUser;
    });
  } catch (error) {
    if (String(error?.code || '').startsWith('SMTP_')) {
      const deliveryError = getEmailDeliveryError(error);
      return fail(res, deliveryError.message, 502, deliveryError.details);
    }
    throw error;
  }

  return ok(res, {
    user: serializeUser({ ...user, email_verified: 0, email_verification_status: 'pending' }),
    ...verificationResponse(email)
  }, 201);
});

authRouter.post('/verify-email', async (req, res) => {
  try {
    await ensureEmailVerificationSchema();
  } catch (error) {
    const setupError = getEmailVerificationSetupError(error);
    return fail(res, setupError.message, 500, setupError.details);
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const otp = String(req.body?.otp || '').trim();
  if (!email || !otp) return fail(res, 'Vui lòng nhập email và mã OTP', 400);
  const user = await findUserByEmail(email);
  if (!user) return fail(res, 'Không tìm thấy tài khoản phù hợp', 404);
  if (Number(user.email_verified)) {
    return ok(res, { token: signToken(user), user: serializeUser(user) });
  }
  if (!user.email_otp_hash || !user.email_otp_expires_at) {
    return fail(res, 'Mã OTP không còn hiệu lực. Vui lòng gửi lại mã mới.', 400);
  }
  if (Number(user.email_otp_attempt_count || 0) >= OTP_MAX_ATTEMPTS) {
    return fail(res, 'Bạn đã nhập sai quá nhiều lần. Vui lòng gửi lại mã OTP mới.', 429);
  }
  if (isOtpExpired(user.email_otp_expires_at)) {
    return fail(res, 'Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.', 400);
  }

  const otpHash = hashOtpCode(otp);
  if (otpHash !== user.email_otp_hash) {
    await query('UPDATE users SET email_otp_attempt_count = ISNULL(email_otp_attempt_count, 0) + 1, updated_at = SYSUTCDATETIME() WHERE id = $1', [user.id]);
    return fail(res, 'Mã OTP không chính xác.', 400);
  }

  await query(`UPDATE users
    SET email_verified = 1,
        email_verified_at = SYSUTCDATETIME(),
        email_verification_status = 'verified',
        email_otp_hash = NULL,
        email_otp_expires_at = NULL,
        email_otp_last_sent_at = NULL,
        email_otp_attempt_count = 0,
        verification_token = NULL,
        updated_at = SYSUTCDATETIME()
    WHERE id = $1`, [user.id]);
  const verifiedUser = await findUserByEmail(email);
  return ok(res, { token: signToken(verifiedUser), user: serializeUser(verifiedUser) });
});

authRouter.post('/resend-email-otp', async (req, res) => {
  try {
    await ensureEmailVerificationSchema();
  } catch (error) {
    const setupError = getEmailVerificationSetupError(error);
    return fail(res, setupError.message, 500, setupError.details);
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return fail(res, 'Vui lòng nhập email.', 400);
  const user = await findUserByEmail(email);
  if (!user) return fail(res, 'Không tìm thấy tài khoản phù hợp', 404);
  if (Number(user.email_verified)) {
    return fail(res, 'Tài khoản này đã xác thực email.', 400);
  }
  const cooldownSeconds = getOtpCooldownSeconds(user.email_otp_last_sent_at);
  if (cooldownSeconds > 0) {
    return res.status(429).json({
      ok: false,
      message: `Vui lòng chờ ${cooldownSeconds} giây trước khi gửi lại mã.`,
      code: 'OTP_COOLDOWN',
      details: { cooldownSeconds }
    });
  }
  try {
    await issueOtpForUser(user.id, user.email);
  } catch (error) {
    if (String(error?.code || '').startsWith('SMTP_')) {
      const deliveryError = getEmailDeliveryError(error);
      return fail(res, deliveryError.message, 502, deliveryError.details);
    }
    throw error;
  }
  return ok(res, verificationResponse(user.email));
});

authRouter.post('/login', async (req, res) => {
  try {
    await ensureEmailVerificationSchema();
  } catch {}
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, 'Thiếu email hoặc mật khẩu');
  const user = await findUserByEmail(email);
  if (!user || !(await comparePassword(password, user.password_hash))) {
    return fail(res, 'Sai tài khoản hoặc mật khẩu', 401);
  }
  if (requiresVerifiedEmail(user)) {
    return res.status(403).json({
      ok: false,
      message: 'Email chưa được xác thực. Vui lòng nhập mã OTP đã gửi tới hộp thư của bạn.',
      code: 'EMAIL_NOT_VERIFIED',
      details: verificationResponse(user.email, getOtpCooldownSeconds(user.email_otp_last_sent_at) || 60)
    });
  }
  return ok(res, { token: signToken(user), user: serializeUser(user) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const [addresses, wishlist, notifications, unreadSummary] = await Promise.all([
    query('SELECT id, label, recipient_name, phone, line1, ward, district, city, is_default FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [req.user.id]),
    query(`SELECT p.id, p.name, p.slug, ISNULL(p.sale_price, p.price) AS price FROM wishlists w JOIN products p ON p.id = w.product_id WHERE w.user_id = $1 AND p.is_active = 1`, [req.user.id]),
    listDbNotificationsForUser(req.user.id, 5),
    query('SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = $1 AND is_read = 0', [req.user.id])
  ]);
  return ok(res, {
    user: serializeUser(req.user),
    addresses: addresses.rows,
    wishlist: wishlist.rows,
    notifications: notifications,
    unreadCount: Number(unreadSummary.rows[0]?.unread_count || 0)
  });
});

authRouter.get('/notifications', requireAuth, async (req, res) => {
  const notifications = await listDbNotificationsForUser(req.user.id, 100);
  const unreadSummary = await query('SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = $1 AND is_read = 0', [req.user.id]);
  return ok(res, {
    items: notifications,
    unreadCount: Number(unreadSummary.rows[0]?.unread_count || 0)
  });
});

authRouter.get('/notifications/:id', requireAuth, async (req, res) => {
  const row = (await query(`SELECT TOP 1 id, title, message, sent_at, is_read, coupon_id
    FROM notifications
    WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id])).rows[0];
  if (!row) return fail(res, 'Không tìm thấy thông báo', 404);
  return ok(res, row);
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
  if (!body.line1 || !body.city || !body.ward || !body.phone || !body.recipientName) return fail(res, 'Thiếu thông tin địa chỉ');
  if (!isValidFullName(body.recipientName)) return fail(res, 'Tên người nhận phải có ít nhất 2 ký tự và không được chứa số', 400);
  if (body.isDefault) await query('UPDATE addresses SET is_default = 0 WHERE user_id = $1', [req.user.id]);
  const result = await query('INSERT INTO addresses(user_id, label, recipient_name, phone, line1, ward, district, city, is_default) OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [req.user.id, body.label || 'Nhà riêng', body.recipientName || req.user.full_name, body.phone || req.user.phone || '', body.line1, body.ward || '', body.district || '', body.city || '', body.isDefault ? 1 : 0]);
  return ok(res, result.rows[0], 201);
});

authRouter.post('/notifications/:id/read', requireAuth, async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  return ok(res, { id: req.params.id, isRead: true });
});

authRouter.post('/notifications/read', requireAuth, async (req, res) => {
  const ids = parseNotificationIds(req.body?.ids);
  if (!ids.length) return fail(res, 'Hãy chọn ít nhất một thông báo', 400);
  await query(`UPDATE notifications
    SET is_read = 1
    WHERE user_id = $1 AND id IN (${ids.map((_, index) => `$${index + 2}`).join(',')})`, [req.user.id, ...ids]);
  return ok(res, { ids, isRead: true });
});

authRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND is_read = 0', [req.user.id]);
  return ok(res, { success: true });
});

authRouter.delete('/notifications', requireAuth, async (req, res) => {
  const ids = parseNotificationIds(req.body?.ids);
  if (!ids.length) return fail(res, 'Hãy chọn ít nhất một thông báo', 400);
  await query(`DELETE FROM notifications
    WHERE user_id = $1 AND id IN (${ids.map((_, index) => `$${index + 2}`).join(',')})`, [req.user.id, ...ids]);
  return ok(res, { deleted: ids.length, ids });
});

authRouter.post('/reviews', requireAuth, async (req, res) => {
  const { orderItemId, rating, comment } = req.body || {};
  if (!orderItemId) return fail(res, 'Thiếu dòng sản phẩm cần đánh giá', 400);
  if (reviewContainsLink(comment)) return fail(res, 'Nháº­n xĂ©t khĂ´ng Ä‘Æ°á»£c chá»©a link hoáº·c Ä‘á»‹a chá»‰ website.', 400);
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
