import { Router } from 'express';
import { comparePassword, hashPassword, signToken } from '../../lib/auth.js';
import { fail, ok } from '../../lib/http.js';
import { connectMongo } from '../../lib/mongo.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  buildOtpState,
  getOtpCooldownSeconds,
  hashOtpCode,
  isOtpExpired,
  OTP_MAX_ATTEMPTS,
  sendVerificationOtpEmail
} from '../../services/auth/emailOtp.js';
import { Address, Notification, Order, OrderItem, Product, ProductReview, User, Wishlist, nextId } from '../../models/mongo.js';

export const mongoAuthRouter = Router();

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
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()); }
function isValidFullName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length >= 2 && !/\d/.test(text);
}
function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(String(password || ''));
}
function verificationResponse(email, cooldownSeconds = 60) {
  return { requiresEmailVerification: true, email, cooldownSeconds };
}
function requiresVerifiedEmail(user) {
  return String(user?.role || '').toLowerCase() === 'customer' && !Number(user?.email_verified);
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
function parseNotificationIds(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  return [...new Set(rawIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}
function getEmailDeliveryError(error) {
  const message = String(error?.message || '');
  if (error?.code === 'SMTP_NOT_CONFIGURED') return { message: 'SMTP chưa được cấu hình đúng trong backend/.env.', details: message };
  if (error?.code === 'SMTP_UNAUTHORIZED_IP') return { message: 'SMTP đang chặn IP hiện tại. Hãy cho phép IP máy chạy backend hoặc dùng SMTP khác.', details: message };
  return { message: 'Không gửi được email OTP. Kiểm tra lại cấu hình SMTP rồi thử lại.', details: message };
}
async function findUserByEmail(email) {
  return User.findOne({ email: String(email || '').trim().toLowerCase(), is_active: 1 }).lean();
}
async function issueOtpForUser(userId, email) {
  const otpState = buildOtpState();
  await User.updateOne(
    { id: userId },
    {
      $set: {
        email_verified: 0,
        email_verified_at: null,
        email_verification_status: 'pending',
        email_otp_hash: otpState.otpHash,
        email_otp_expires_at: otpState.expiresAt,
        email_otp_last_sent_at: otpState.sentAt,
        email_otp_attempt_count: 0,
        verification_token: null,
        updated_at: new Date()
      }
    }
  );
  await sendVerificationOtpEmail(email, otpState.otp);
  return otpState;
}

mongoAuthRouter.use(async (_req, _res, next) => {
  await connectMongo();
  next();
});

mongoAuthRouter.post('/register', async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const phone = String(req.body?.phone || '').trim();
  if (!isValidFullName(fullName)) return fail(res, 'Họ tên phải có ít nhất 2 ký tự và không được chứa số.', 400);
  if (!isValidEmail(email)) return fail(res, 'Vui lòng nhập email hợp lệ.', 400);
  if (!isStrongPassword(password)) return fail(res, 'Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.', 400);
  if (phone && !/^0\d{9}$/.test(phone)) return fail(res, 'Số điện thoại phải gồm 10 số và bắt đầu bằng 0.', 400);
  if (await User.findOne({ email })) return fail(res, 'Email này đã được sử dụng.', 409);
  const user = await User.create({
    id: await nextId('users'),
    email,
    password_hash: await hashPassword(password),
    full_name: fullName,
    phone,
    role: 'customer',
    points: 0,
    membership_level: 'Member',
    email_verified: 0,
    email_verification_status: 'pending',
    email_verified_at: null
  });
  try {
    await issueOtpForUser(user.id, email);
  } catch (error) {
    await User.deleteOne({ id: user.id });
    if (String(error?.code || '').startsWith('SMTP_')) {
      const deliveryError = getEmailDeliveryError(error);
      return fail(res, deliveryError.message, 502, deliveryError.details);
    }
    throw error;
  }
  return ok(res, { user: serializeUser(user), ...verificationResponse(email) }, 201);
});

mongoAuthRouter.post('/verify-email', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const otp = String(req.body?.otp || '').trim();
  if (!email || !otp) return fail(res, 'Vui lòng nhập email và mã OTP', 400);
  const user = await findUserByEmail(email);
  if (!user) return fail(res, 'Không tìm thấy tài khoản phù hợp', 404);
  if (Number(user.email_verified)) return ok(res, { token: signToken(user), user: serializeUser(user) });
  if (!user.email_otp_hash || !user.email_otp_expires_at) return fail(res, 'Mã OTP không còn hiệu lực. Vui lòng gửi lại mã mới.', 400);
  if (Number(user.email_otp_attempt_count || 0) >= OTP_MAX_ATTEMPTS) return fail(res, 'Bạn đã nhập sai quá nhiều lần. Vui lòng gửi lại mã OTP mới.', 429);
  if (isOtpExpired(user.email_otp_expires_at)) return fail(res, 'Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.', 400);

  if (hashOtpCode(otp) !== user.email_otp_hash) {
    await User.updateOne({ id: user.id }, { $inc: { email_otp_attempt_count: 1 }, $set: { updated_at: new Date() } });
    return fail(res, 'Mã OTP không chính xác.', 400);
  }

  const verifiedUser = await User.findOneAndUpdate(
    { id: user.id },
    {
      $set: {
        email_verified: 1,
        email_verified_at: new Date(),
        email_verification_status: 'verified',
        email_otp_hash: null,
        email_otp_expires_at: null,
        email_otp_last_sent_at: null,
        email_otp_attempt_count: 0,
        verification_token: null,
        updated_at: new Date()
      }
    },
    { returnDocument: 'after' }
  ).lean();
  return ok(res, { token: signToken(verifiedUser), user: serializeUser(verifiedUser) });
});

mongoAuthRouter.post('/resend-email-otp', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return fail(res, 'Vui lòng nhập email.', 400);
  const user = await findUserByEmail(email);
  if (!user) return fail(res, 'Không tìm thấy tài khoản phù hợp', 404);
  if (Number(user.email_verified)) return fail(res, 'Tài khoản này đã xác thực email.', 400);
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

mongoAuthRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = await User.findOne({ email, is_active: 1 }).lean();
  if (!user || !(await comparePassword(String(req.body?.password || ''), user.password_hash))) return fail(res, 'Sai tài khoản hoặc mật khẩu', 401);
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

mongoAuthRouter.get('/me', requireAuth, async (req, res) => {
  const [addresses, wishlistRows, notifications, unreadCount] = await Promise.all([
    Address.find({ user_id: req.user.id }).sort({ is_default: -1, created_at: -1 }).lean(),
    Wishlist.find({ user_id: req.user.id }).lean(),
    Notification.find({ user_id: req.user.id }).sort({ sent_at: -1 }).limit(5).lean(),
    Notification.countDocuments({ user_id: req.user.id, is_read: 0 })
  ]);
  const products = wishlistRows.length ? await Product.find({ id: { $in: wishlistRows.map((w) => w.product_id) }, is_active: 1 }).lean() : [];
  return ok(res, {
    user: serializeUser(req.user),
    addresses,
    wishlist: products.map((p) => ({ id: p.id, name: p.name, slug: p.slug, price: p.sale_price || p.price })),
    notifications,
    unreadCount
  });
});

mongoAuthRouter.get('/orders', requireAuth, async (req, res) => {
  const orders = await Order.find({ user_id: req.user.id }).sort({ created_at: -1 }).lean();
  const items = orders.length ? await OrderItem.find({ order_id: { $in: orders.map((o) => o.id) } }).lean() : [];
  const reviews = items.length ? await ProductReview.find({ user_id: req.user.id, order_item_id: { $in: items.map((i) => i.id) } }).lean() : [];
  const reviewed = new Set(reviews.map((r) => r.order_item_id));
  return ok(res, orders.map((order) => ({
    ...order,
    items: items.filter((item) => item.order_id === order.id).map((item) => ({
      ...item,
      canReview: order.payment_status === 'paid' || order.order_status === 'completed',
      hasReview: reviewed.has(item.id)
    }))
  })));
});

mongoAuthRouter.get('/notifications', requireAuth, async (req, res) => ok(res, {
  items: await Notification.find({ user_id: req.user.id }).sort({ sent_at: -1, id: -1 }).limit(100).lean(),
  unreadCount: await Notification.countDocuments({ user_id: req.user.id, is_read: 0 })
}));

mongoAuthRouter.post('/notifications/:id/read', requireAuth, async (req, res) => {
  await Notification.updateOne({ id: Number(req.params.id), user_id: req.user.id }, { $set: { is_read: 1 } });
  return ok(res, { id: Number(req.params.id), isRead: true });
});
mongoAuthRouter.post('/notifications/read', requireAuth, async (req, res) => {
  const ids = parseNotificationIds(req.body?.ids);
  if (!ids.length) return fail(res, 'Hãy chọn ít nhất một thông báo', 400);
  await Notification.updateMany({ user_id: req.user.id, id: { $in: ids } }, { $set: { is_read: 1 } });
  return ok(res, { ids, isRead: true });
});
mongoAuthRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  await Notification.updateMany({ user_id: req.user.id }, { $set: { is_read: 1 } });
  return ok(res, { success: true });
});
mongoAuthRouter.delete('/notifications', requireAuth, async (req, res) => {
  const ids = parseNotificationIds(req.body?.ids);
  if (!ids.length) return fail(res, 'Hãy chọn ít nhất một thông báo', 400);
  const result = await Notification.deleteMany({ user_id: req.user.id, id: { $in: ids } });
  return ok(res, { deleted: result.deletedCount || 0, ids });
});

mongoAuthRouter.post('/wishlist/:productId', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  const existing = await Wishlist.findOne({ user_id: req.user.id, product_id: productId });
  if (existing) {
    await existing.deleteOne();
    return ok(res, { added: false });
  }
  await Wishlist.create({ id: await nextId('wishlists'), user_id: req.user.id, product_id: productId });
  return ok(res, { added: true }, 201);
});

mongoAuthRouter.post('/addresses', requireAuth, async (req, res) => {
  const body = req.body || {};
  if (!body.line1 || !body.city || !body.ward || !body.phone || !body.recipientName) return fail(res, 'Thiếu thông tin địa chỉ');
  if (!isValidFullName(body.recipientName)) return fail(res, 'Tên người nhận phải có ít nhất 2 ký tự và không được chứa số', 400);
  if (body.isDefault) await Address.updateMany({ user_id: req.user.id }, { $set: { is_default: 0 } });
  const address = await Address.create({
    id: await nextId('addresses'),
    user_id: req.user.id,
    label: body.label || 'Nhà riêng',
    recipient_name: body.recipientName,
    phone: body.phone,
    line1: body.line1,
    ward: body.ward,
    district: body.district || '',
    city: body.city,
    is_default: body.isDefault ? 1 : 0
  });
  return ok(res, address, 201);
});

mongoAuthRouter.post('/reviews', requireAuth, async (req, res) => {
  const { orderItemId, rating, comment } = req.body || {};
  if (!orderItemId) return fail(res, 'Thiếu dòng sản phẩm cần đánh giá', 400);
  if (reviewContainsLink(comment)) return fail(res, 'Nhận xét không được chứa link hoặc địa chỉ website.', 400);
  const reviewError = getReviewError({ rating, comment });
  if (reviewError) return fail(res, reviewError, 400);

  const item = await OrderItem.findOne({ id: Number(orderItemId) }).lean();
  if (!item) return fail(res, 'Không tìm thấy dòng sản phẩm cần đánh giá', 404);
  const order = await Order.findOne({ id: item.order_id, user_id: req.user.id }).lean();
  if (!order || !(order.payment_status === 'paid' || order.order_status === 'completed')) {
    return fail(res, 'Bạn chỉ có thể đánh giá sản phẩm đã mua và đã thanh toán hoặc hoàn thành', 403);
  }

  const rate = Number(rating);
  const reviewComment = String(comment || '').trim();
  const existing = await ProductReview.findOne({ user_id: req.user.id, order_item_id: Number(orderItemId) });
  if (existing) {
    existing.rating = rate;
    existing.comment = reviewComment;
    existing.is_visible = 1;
    existing.updated_at = new Date();
    await existing.save();
  } else {
    await ProductReview.create({
      id: await nextId('product_reviews'),
      user_id: req.user.id,
      product_id: item.product_id,
      order_item_id: Number(orderItemId),
      rating: rate,
      comment: reviewComment,
      is_visible: 1
    });
  }

  const summary = await ProductReview.aggregate([
    { $match: { product_id: item.product_id, is_visible: 1 } },
    { $group: { _id: '$product_id', rating: { $avg: '$rating' }, review_count: { $sum: 1 } } }
  ]);
  await Product.updateOne(
    { id: item.product_id },
    {
      $set: {
        rating: summary[0]?.rating || 0,
        review_count: summary[0]?.review_count || 0,
        updated_at: new Date()
      }
    }
  );

  return ok(res, { success: true });
});
