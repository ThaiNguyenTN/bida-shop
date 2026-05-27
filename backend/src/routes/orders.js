import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { fail, ok, orderCode, parseJson } from '../lib/http.js';
import { createPaymentUrl, verifyVnpayPayload } from '../services/payments/vnpay.js';
import { createMomoPayment, verifyMomoResult } from '../services/payments/momo.js';
import { verifyToken } from '../lib/auth.js';

export const ordersRouter = Router();

function requireUserId(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new Error('Vui lòng đăng nhập để tạo đơn hàng');
  try {
    const payload = verifyToken(token);
    if (!payload.sub) throw new Error('Phiên đăng nhập không hợp lệ');
    return payload.sub;
  } catch {
    throw new Error('Vui lòng đăng nhập để tạo đơn hàng');
  }
}
function extractIp(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').toString().split(',')[0].trim(); }
function serviceTotal(codes, services) { return (codes || []).reduce((sum, code) => sum + Number(services.find((s) => s.code === code)?.price || 0), 0); }
function normalizePhone(value) { return String(value || '').replace(/\D/g, ''); }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
function isValidGmail(value) { return /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(String(value || '').trim()); }
function isValidFullName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length >= 2 && !/\d/.test(text);
}

async function createNotification({ tx = null, userId, couponId = null, title, message }) {
  if (!userId) return;
  await query('INSERT INTO notifications(user_id, coupon_id, title, message, sent_at) VALUES ($1,$2,$3,$4,SYSUTCDATETIME())', [userId, couponId, title, message || ''], tx);
}

async function awardPointsIfEligible(orderId, tx = null) {
  const order = (await query('SELECT id, user_id, grand_total, rewarded_points, order_code FROM orders WHERE id = $1', [orderId], tx)).rows[0];
  if (!order || !order.user_id) return;
  if (Number(order.rewarded_points || 0) > 0) return;
  const points = Math.floor(Number(order.grand_total || 0) / 1000);
  if (points <= 0) return;
  await query(`UPDATE users SET points = points + $2,
      membership_level = CASE WHEN points + $2 >= 50000 THEN 'VIP' WHEN points + $2 >= 10000 THEN 'Silver' ELSE membership_level END,
      updated_at = SYSUTCDATETIME()
    WHERE id = $1`, [order.user_id, points], tx);
  await query('UPDATE orders SET rewarded_points = $2, updated_at = SYSUTCDATETIME() WHERE id = $1', [orderId, points], tx);
  await createNotification({ tx, userId: order.user_id, title: 'Đã cộng điểm tích lũy', message: `Đơn ${order.order_code} đã cộng ${points} điểm vào tài khoản của bạn.` });
}

async function notifyCouponExhaustedIfNeeded(couponId, tx = null) {
  if (!couponId) return;
  const coupon = (await query('SELECT id, code, usage_limit, used_count FROM coupons WHERE id = $1', [couponId], tx)).rows[0];
  if (!coupon?.usage_limit || Number(coupon.used_count) < Number(coupon.usage_limit)) return;
  const users = (await query('SELECT DISTINCT user_id FROM notifications WHERE coupon_id = $1 AND user_id IS NOT NULL', [couponId], tx)).rows;
  for (const user of users) {
    await createNotification({ tx, userId: user.user_id, couponId, title: `Voucher ${coupon.code} đã dùng hết`, message: `Voucher ${coupon.code} đã hết lượt sử dụng.` });
  }
}

async function findCoupon(code, subtotal, tx = null) {
  if (!code) return { coupon: null, reason: null };
  const normalized = String(code).trim().toUpperCase();
  const result = await query('SELECT * FROM coupons WHERE code = $1 AND active = 1', [normalized], tx);
  const coupon = result.rows[0];
  if (!coupon) return { coupon: null, reason: 'Mã giảm giá không tồn tại hoặc đã bị tắt.' };
  if (coupon.starts_at && new Date(coupon.starts_at) > new Date()) return { coupon: null, reason: 'Voucher chưa đến thời gian sử dụng.' };
  if (coupon.ends_at && new Date(coupon.ends_at) < new Date()) return { coupon: null, reason: 'Voucher đã hết hạn.' };
  if (subtotal < Number(coupon.min_order_amount || 0)) return { coupon: null, reason: `Đơn hàng chưa đạt mức tối thiểu ${Number(coupon.min_order_amount || 0).toLocaleString('vi-VN')} đ.` };
  if (coupon.usage_limit && Number(coupon.used_count) >= Number(coupon.usage_limit)) return { coupon: null, reason: 'Voucher đã hết lượt sử dụng.' };
  if (coupon.discount_type === 'percent' && (Number(coupon.value || 0) <= 0 || Number(coupon.value || 0) > 100)) return { coupon: null, reason: 'Voucher phần trăm phải lớn hơn 0% và không được vượt quá 100%.' };
  if (coupon.discount_type === 'fixed' && Number(coupon.value || 0) <= 0) return { coupon: null, reason: 'Giá trị voucher phải lớn hơn 0.' };
  if (coupon.discount_type === 'fixed' && Number(coupon.value || 0) > subtotal) return { coupon: null, reason: 'Giá trị mã giảm giá không được lớn hơn giá trị đơn hàng.' };
  return { coupon, reason: null };
}

async function upsertAddressForUser(userId, customer, tx) {
  const line1 = String(customer?.address?.line1 || '').trim();
  const district = String(customer?.address?.district || '').trim();
  const city = String(customer?.address?.city || '').trim();
  if (!userId || !line1 || !district || !city) return;
  const exists = (await query('SELECT TOP 1 id FROM addresses WHERE user_id = $1 AND line1 = $2 AND district = $3 AND city = $4', [userId, line1, district, city], tx)).rows[0];
  if (exists) return;
  await query('INSERT INTO addresses(user_id, label, recipient_name, phone, line1, district, city, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [userId, 'Địa chỉ giao hàng', customer.fullName || '', customer.phone || '', line1, district, city, 1], tx);
}

async function createOrderRecord({ tx, userId, payload }) {
  const { customer, items, paymentMethod, note, couponCode } = payload;
  const fullName = String(customer?.fullName || '').trim();
  const email = String(customer?.email || '').trim();
  const phone = normalizePhone(customer?.phone || '');
  const line1 = String(customer?.address?.line1 || '').trim();
  const district = String(customer?.address?.district || '').trim();
  const city = String(customer?.address?.city || '').trim();
  if (!isValidFullName(fullName)) throw new Error('Họ tên phải có ít nhất 2 ký tự và không được chứa số');
  if (!isValidEmail(email) || !isValidGmail(email)) throw new Error('Vui lòng dùng đúng địa chỉ Gmail, ví dụ tenban@gmail.com');
  if (!/^0\d{9}$/.test(phone)) throw new Error('Số điện thoại phải gồm đúng 10 số');
  if (!line1 || !district || !city) throw new Error('Thiếu địa chỉ giao hàng');
  if (!Array.isArray(items) || items.length === 0) throw new Error('Giỏ hàng đang trống');
  if (!['cod', 'bank_transfer', 'vnpay', 'momo'].includes(paymentMethod)) throw new Error('Phương thức thanh toán không hợp lệ');

  let subtotal = 0;
  const normalizedItems = [];
  for (const item of items) {
    const product = (await query('SELECT * FROM products WHERE id = $1 AND is_active = 1', [item.productId], tx)).rows[0];
    if (!product) throw new Error('Sản phẩm không tồn tại');
    const variant = item.variantId ? (await query('SELECT * FROM product_variants WHERE id = $1 AND product_id = $2', [item.variantId, item.productId], tx)).rows[0] : null;
    const services = (await query('SELECT code, name, price FROM product_services WHERE product_id = $1', [item.productId], tx)).rows;
    const quantity = Number(item.quantity || 1);
    const stock = variant ? Number(variant.stock) : Number(product.stock_total);
    if (quantity <= 0 || stock < quantity) throw new Error(`Tồn kho không đủ cho ${product.name}`);
    const serviceCodes = Array.isArray(item.selectedServices) ? item.selectedServices : [];
    const unitPrice = Number(product.sale_price || product.price) + Number(variant?.price_delta || 0) + serviceTotal(serviceCodes, services);
    const lineTotal = unitPrice * quantity;
    subtotal += lineTotal;
    normalizedItems.push({ product, variant, quantity, services: services.filter((s) => serviceCodes.includes(s.code)), unitPrice, lineTotal });
  }

  const couponState = await findCoupon(couponCode, subtotal, tx);
  if (couponCode && !couponState.coupon) throw new Error(couponState.reason || 'Voucher không hợp lệ');
  const coupon = couponState.coupon;
  const shippingBase = subtotal >= 5000000 ? 0 : 45000;
  const discountTotal = coupon ? (coupon.discount_type === 'percent' ? Math.min(subtotal, Math.round((subtotal * Number(coupon.value)) / 100)) : coupon.discount_type === 'free_shipping' ? 0 : Number(coupon.value)) : 0;
  if (discountTotal > subtotal) throw new Error('Giá trị mã giảm giá không được lớn hơn giá trị đơn hàng');
  const shippingTotal = coupon?.discount_type === 'free_shipping' ? 0 : shippingBase;
  const grandTotal = subtotal - discountTotal + shippingTotal;
  const code = orderCode('BIDA');
  const inserted = await query(`INSERT INTO orders(order_code, user_id, customer_name, email, phone, payment_method, subtotal, discount_total, shipping_total, grand_total, shipping_address, note, coupon_code, guest_checkout)
    OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [code, userId, fullName, email, phone, paymentMethod, subtotal, discountTotal, shippingTotal, grandTotal, JSON.stringify({ line1, district, city }), note || null, coupon?.code || null, 0], tx);
  const order = inserted.rows[0];

  for (const item of normalizedItems) {
    await query('INSERT INTO order_items(order_id, product_id, variant_id, product_name, sku, quantity, unit_price, line_total, selected_services) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [order.id, item.product.id, item.variant?.id || null, item.product.name, item.product.sku, item.quantity, item.unitPrice, item.lineTotal, JSON.stringify(item.services)], tx);
    if (item.variant) await query('UPDATE product_variants SET stock = stock - $1 WHERE id = $2', [item.quantity, item.variant.id], tx);
    await query('UPDATE products SET stock_total = stock_total - $1, sold_count = sold_count + $1, updated_at = SYSUTCDATETIME() WHERE id = $2', [item.quantity, item.product.id], tx);
  }
  if (coupon) {
    await query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [coupon.id], tx);
    await notifyCouponExhaustedIfNeeded(coupon.id, tx);
  }
  await upsertAddressForUser(userId, customer, tx);
  await createNotification({ tx, userId, title: `Đã tạo đơn ${order.order_code}`, message: `Bạn đã đặt hàng thành công với tổng thanh toán ${Number(order.grand_total).toLocaleString('vi-VN')} đ.` });
  return order;
}

ordersRouter.get('/payments/vnpay/return', async (req, res) => {
  const valid = verifyVnpayPayload(req.query);
  const code = req.query.vnp_TxnRef;
  const success = valid && req.query.vnp_ResponseCode === '00' && req.query.vnp_TransactionStatus === '00';
  return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}/info.html?payment=${success ? 'success' : 'failed'}&order=${code}`);
});
ordersRouter.get('/payments/vnpay/ipn', async (req, res) => {
  const valid = verifyVnpayPayload(req.query); if (!valid) return res.json({ RspCode: '97', Message: 'Invalid Signature' });
  const order = (await query('SELECT * FROM orders WHERE order_code = $1', [req.query.vnp_TxnRef])).rows[0];
  if (!order) return res.json({ RspCode: '01', Message: 'Order not found' });
  const success = req.query.vnp_ResponseCode === '00' && req.query.vnp_TransactionStatus === '00';
  await withTransaction(async (tx) => {
    await query('UPDATE orders SET payment_status = $1, updated_at = SYSUTCDATETIME() WHERE id = $2', [success ? 'paid' : 'failed', order.id], tx);
    if (success) {
      await awardPointsIfEligible(order.id, tx);
      await createNotification({ tx, userId: order.user_id, title: `Thanh toán thành công ${order.order_code}`, message: `Đơn hàng ${order.order_code} đã được thanh toán thành công.` });
    }
  });
  return res.json({ RspCode: '00', Message: 'Confirm Success' });
});
ordersRouter.post('/payments/momo/ipn', async (req, res) => {
  const valid = verifyMomoResult(req.body || {}); if (!valid) return res.status(400).json({ resultCode: 97, message: 'Invalid signature' });
  const order = (await query('SELECT * FROM orders WHERE order_code = $1', [req.body.orderId])).rows[0];
  if (!order) return res.status(404).json({ resultCode: 1, message: 'Order not found' });
  const success = Number(req.body.resultCode) === 0;
  await withTransaction(async (tx) => {
    await query('UPDATE orders SET payment_status = $1, updated_at = SYSUTCDATETIME() WHERE id = $2', [success ? 'paid' : 'failed', order.id], tx);
    if (success) {
      await awardPointsIfEligible(order.id, tx);
      await createNotification({ tx, userId: order.user_id, title: `Thanh toán thành công ${order.order_code}`, message: `Đơn hàng ${order.order_code} đã được thanh toán thành công.` });
    }
  });
  return res.json({ message: 'success' });
});
ordersRouter.post('/checkout', async (req, res) => {
  try {
    const userId = requireUserId(req);
    const order = await withTransaction((tx) => createOrderRecord({ tx, userId, payload: req.body || {} }));
    const items = (await query('SELECT product_name, quantity, unit_price FROM order_items WHERE order_id = $1', [order.id])).rows;
    if (order.payment_method === 'vnpay') {
      const url = createPaymentUrl({ orderCode: order.order_code, amount: order.grand_total, ipAddr: extractIp(req), orderInfo: `Thanh toan don hang ${order.order_code}` });
      await query('INSERT INTO payment_transactions(order_id, provider, amount, status) VALUES ($1,$2,$3,$4)', [order.id, 'vnpay', order.grand_total, 'pending']);
      return ok(res, { order, payment: { provider: 'vnpay', redirectUrl: url } }, 201);
    }
    if (order.payment_method === 'momo') {
      const momo = await createMomoPayment({ orderCode: order.order_code, amount: order.grand_total, orderInfo: `Thanh toán đơn hàng ${order.order_code}`, items: items.map((item) => ({ name: item.product_name, quantity: item.quantity, amount: item.unit_price })) });
      await query('INSERT INTO payment_transactions(order_id, provider, request_id, provider_ref, amount, status, raw_payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [order.id, 'momo', momo.requestId, momo.result.transId ? String(momo.result.transId) : null, order.grand_total, 'pending', JSON.stringify(momo.result)]);
      return ok(res, { order, payment: { provider: 'momo', redirectUrl: momo.result.payUrl, deeplink: momo.result.deeplink } }, 201);
    }
    return ok(res, { order }, 201);
  } catch (error) {
    return fail(res, error.message, 400);
  }
});
ordersRouter.get('/:orderCode', async (req, res) => {
  const order = (await query('SELECT * FROM orders WHERE order_code = $1', [req.params.orderCode])).rows[0];
  if (!order) return fail(res, 'Không tìm thấy đơn hàng', 404);
  const items = (await query('SELECT * FROM order_items WHERE order_id = $1', [order.id])).rows.map((r) => ({ ...r, selected_services: parseJson(r.selected_services, []) }));
  return ok(res, { ...order, shipping_address: parseJson(order.shipping_address, {}), items });
});
