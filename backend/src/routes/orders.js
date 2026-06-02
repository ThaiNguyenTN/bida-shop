import crypto from 'crypto';
import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { fail, ok, orderCode, parseJson } from '../lib/http.js';
import { createPaymentUrl, verifyVnpayPayload } from '../services/payments/vnpay.js';
import { verifyMomoResult } from '../services/payments/momo.js';
import { verifyToken } from '../lib/auth.js';
import { ensureEmailVerificationSchema } from '../services/auth/emailVerificationSchema.js';

export const ordersRouter = Router();

function extractIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').toString().split(',')[0].trim();
}

function backendBaseUrl(req) {
  if (process.env.BACKEND_PUBLIC_URL) return process.env.BACKEND_PUBLIC_URL.replace(/\/+$/, '');
  const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0];
  return `${protocol}://${req.get('host')}`;
}

function vnpayReturnUrl(req) {
  return process.env.VNPAY_RETURN_URL || `${backendBaseUrl(req)}/api/orders/payments/vnpay/return`;
}

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/+$/, '');
}

function serviceTotal(codes, services) {
  return (codes || []).reduce((sum, code) => sum + Number(services.find((s) => s.code === code)?.price || 0), 0);
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidFullName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length >= 2 && !/\d/.test(text);
}

function isSuccessfulVnpayResponse(params) {
  return params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';
}

function requiresVerifiedEmail(user) {
  if (!user) return false;
  if (String(user.role || '').toLowerCase() !== 'customer') return false;
  const hasOtpWorkflowState = user.email_verification_status != null || user.email_otp_hash != null || user.email_otp_expires_at != null || user.email_otp_last_sent_at != null;
  if (!hasOtpWorkflowState) return false;
  return !Number(user.email_verified);
}

async function requireCheckoutUser(req) {
  try {
    await ensureEmailVerificationSchema();
  } catch {}
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new Error('Vui lòng đăng nhập để tạo đơn hàng');
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new Error('Vui lòng đăng nhập để tạo đơn hàng');
  }
  if (!payload.sub) throw new Error('Phiên đăng nhập không hợp lệ');
  let user = null;
  try {
    user = (await query(`SELECT id, email, full_name, phone, role, points, membership_level, customer_tag,
      email_verified, email_verified_at, email_verification_status, email_otp_hash, email_otp_expires_at, email_otp_last_sent_at
      FROM users WHERE id = $1 AND is_active = 1`, [payload.sub])).rows[0];
  } catch {
    user = (await query('SELECT id, email, full_name, phone, role, points, membership_level, customer_tag, email_verified FROM users WHERE id = $1 AND is_active = 1', [payload.sub])).rows[0];
    if (user) {
      user = {
        ...user,
        email_verified_at: null,
        email_verification_status: null,
        email_otp_hash: null,
        email_otp_expires_at: null,
        email_otp_last_sent_at: null
      };
    }
  }
  if (!user) throw new Error('Không tìm thấy tài khoản');
  if (requiresVerifiedEmail(user)) throw new Error('Vui lòng xác thực email trước khi thanh toán');
  return user;
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
  await createNotification({ tx, userId: order.user_id, title: 'Da cong diem tich luy', message: `Don ${order.order_code} da cong ${points} diem vao tai khoan cua ban.` });
}

async function notifyCouponExhaustedIfNeeded(couponId, tx = null) {
  if (!couponId) return;
  const coupon = (await query('SELECT id, code, usage_limit, used_count FROM coupons WHERE id = $1', [couponId], tx)).rows[0];
  if (!coupon?.usage_limit || Number(coupon.used_count) < Number(coupon.usage_limit)) return;
  const users = (await query('SELECT DISTINCT user_id FROM notifications WHERE coupon_id = $1 AND user_id IS NOT NULL', [couponId], tx)).rows;
  for (const user of users) {
    await createNotification({ tx, userId: user.user_id, couponId, title: `Voucher ${coupon.code} da dung het`, message: `Voucher ${coupon.code} da het luot su dung.` });
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
  const ward = String(customer?.address?.ward || customer?.address?.district || '').trim();
  const city = String(customer?.address?.city || '').trim();
  if (!userId || !line1 || !ward || !city) return;
  const exists = (await query('SELECT TOP 1 id FROM addresses WHERE user_id = $1 AND line1 = $2 AND ward = $3 AND city = $4', [userId, line1, ward, city], tx)).rows[0];
  if (exists) return;
  await query('INSERT INTO addresses(user_id, label, recipient_name, phone, line1, ward, district, city, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [userId, 'Địa chỉ giao hàng', customer.fullName || '', customer.phone || '', line1, ward, '', city, 1], tx);
}

async function findActiveCartByUser(userId, tx = null) {
  return (await query('SELECT TOP 1 id, user_id FROM carts WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC, id DESC', [userId, 'active'], tx)).rows[0] || null;
}

async function touchCart(cartId, tx = null) {
  await query('UPDATE carts SET updated_at = SYSUTCDATETIME() WHERE id = $1', [cartId], tx);
}

async function loadSelectedCartItems(cartId, tx) {
  const cartItems = (await query(`SELECT id, product_id, variant_id, quantity, selected_services
    FROM cart_items WHERE cart_id = $1 AND is_selected = 1 ORDER BY id ASC`, [cartId], tx)).rows;
  if (!cartItems.length) throw new Error('Giỏ hàng đang trống');

  let subtotal = 0;
  const normalizedItems = [];
  for (const item of cartItems) {
    const product = (await query('SELECT * FROM products WHERE id = $1 AND is_active = 1', [item.product_id], tx)).rows[0];
    if (!product) throw new Error('Sản phẩm không tồn tại');
    const variant = item.variant_id ? (await query('SELECT * FROM product_variants WHERE id = $1 AND product_id = $2', [item.variant_id, item.product_id], tx)).rows[0] : null;
    if (item.variant_id && !variant) throw new Error(`Biến thể của ${product.name} không còn tồn tại`);
    const services = (await query('SELECT code, name, price FROM product_services WHERE product_id = $1', [item.product_id], tx)).rows;
    const quantity = Number(item.quantity || 1);
    const stock = variant ? Number(variant.stock) : Number(product.stock_total);
    if (quantity <= 0 || stock < quantity) throw new Error(`Tồn kho không đủ cho ${product.name}`);
    const selectedCodes = parseJson(item.selected_services, []);
    const selectedServices = services.filter((service) => selectedCodes.includes(service.code));
    const unitPrice = Number(product.sale_price || product.price) + Number(variant?.price_delta || 0) + serviceTotal(selectedCodes, services);
    const lineTotal = unitPrice * quantity;
    subtotal += lineTotal;
    normalizedItems.push({
      cartItemId: item.id,
      product,
      variant,
      quantity,
      services: selectedServices,
      unitPrice,
      lineTotal
    });
  }

  return { items: normalizedItems, subtotal };
}

async function logPaymentTransaction({
  tx,
  orderId,
  provider,
  requestId = null,
  providerRef = null,
  txnRef = null,
  eventType = null,
  amount,
  status,
  checksumValid = null,
  responseCode = null,
  transactionStatus = null,
  rawPayload = null
}) {
  await query(`INSERT INTO payment_transactions(
      order_id, provider, request_id, provider_ref, txn_ref, event_type, amount, status,
      checksum_valid, response_code, transaction_status, raw_payload, processed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,SYSUTCDATETIME())`, [
    orderId,
    provider,
    requestId,
    providerRef,
    txnRef,
    eventType,
    amount,
    status,
    checksumValid,
    responseCode,
    transactionStatus,
    rawPayload ? JSON.stringify(rawPayload) : null
  ], tx);
}

async function createOrderRecord({ tx, user, payload, ipAddr }) {
  const { customer, paymentMethod, note, couponCode } = payload;
  const fullName = String(customer?.fullName || '').trim();
  const email = String(customer?.email || '').trim().toLowerCase();
  const phone = normalizePhone(customer?.phone || '');
  const line1 = String(customer?.address?.line1 || '').trim();
  const ward = String(customer?.address?.ward || customer?.address?.district || '').trim();
  const city = String(customer?.address?.city || '').trim();

  if (!isValidFullName(fullName)) throw new Error('Họ tên phải có ít nhất 2 ký tự và không được chứa số');
  if (!isValidEmail(email)) throw new Error('Vui lòng nhập email hợp lệ');
  if (email !== String(user.email || '').trim().toLowerCase()) throw new Error('Email đặt hàng phải trùng với email tài khoản đã xác thực');
  if (!/^0\d{9}$/.test(phone)) throw new Error('Số điện thoại phải gồm đúng 10 số');
  if (!line1 || !ward || !city) throw new Error('Thiếu địa chỉ giao hàng');
  if (!['cod', 'vnpay'].includes(paymentMethod)) throw new Error('Phương thức thanh toán không hợp lệ');

  const cart = await findActiveCartByUser(user.id, tx);
  if (!cart) throw new Error('Giỏ hàng đang trống');
  const selectedCart = await loadSelectedCartItems(cart.id, tx);

  const couponState = await findCoupon(couponCode, selectedCart.subtotal, tx);
  if (couponCode && !couponState.coupon) throw new Error(couponState.reason || 'Voucher không hợp lệ');
  const coupon = couponState.coupon;
  const shippingBase = selectedCart.subtotal >= 5000000 ? 0 : 45000;
  const discountTotal = coupon
    ? coupon.discount_type === 'percent'
      ? Math.min(selectedCart.subtotal, Math.round((selectedCart.subtotal * Number(coupon.value)) / 100))
      : coupon.discount_type === 'free_shipping'
        ? 0
        : Number(coupon.value)
    : 0;
  if (discountTotal > selectedCart.subtotal) throw new Error('Giá trị mã giảm giá không được lớn hơn giá trị đơn hàng');
  const shippingTotal = coupon?.discount_type === 'free_shipping' ? 0 : shippingBase;
  const grandTotal = selectedCart.subtotal - discountTotal + shippingTotal;
  const code = orderCode('BIDA');
  const paymentStatus = paymentMethod === 'cod' ? 'pending_cod' : 'pending';
  const paymentProvider = paymentMethod === 'vnpay' ? 'vnpay' : null;

  const inserted = await query(`INSERT INTO orders(
      order_code, user_id, customer_name, email, phone, payment_method, payment_status, payment_provider,
      payment_requested_at, subtotal, discount_total, shipping_total, grand_total, shipping_address, note,
      coupon_code, guest_checkout
    ) OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
    code,
    user.id,
    fullName,
    email,
    phone,
    paymentMethod,
    paymentStatus,
    paymentProvider,
    paymentMethod === 'vnpay' ? new Date() : null,
    selectedCart.subtotal,
    discountTotal,
    shippingTotal,
    grandTotal,
    JSON.stringify({ line1, ward, city }),
    note || null,
    coupon?.code || null,
    0
  ], tx);
  const order = inserted.rows[0];

  for (const item of selectedCart.items) {
    await query('INSERT INTO order_items(order_id, product_id, variant_id, product_name, sku, quantity, unit_price, line_total, selected_services) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      order.id,
      item.product.id,
      item.variant?.id || null,
      item.product.name,
      item.product.sku,
      item.quantity,
      item.unitPrice,
      item.lineTotal,
      JSON.stringify(item.services)
    ], tx);
    if (item.variant) await query('UPDATE product_variants SET stock = stock - $1 WHERE id = $2', [item.quantity, item.variant.id], tx);
    await query('UPDATE products SET stock_total = stock_total - $1, sold_count = sold_count + $1, updated_at = SYSUTCDATETIME() WHERE id = $2', [item.quantity, item.product.id], tx);
  }

  if (coupon) {
    await query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [coupon.id], tx);
    await notifyCouponExhaustedIfNeeded(coupon.id, tx);
  }

  await upsertAddressForUser(user.id, customer, tx);
  await createNotification({
    tx,
    userId: user.id,
    title: `Da tao don ${order.order_code}`,
    message: `Ban da dat hang thanh cong voi tong thanh toan ${Number(order.grand_total).toLocaleString('vi-VN')} đ.`
  });

  await query(`DELETE FROM cart_items
    WHERE cart_id = $1 AND id IN (${selectedCart.items.map((_, index) => `$${index + 2}`).join(',')})`,
  [cart.id, ...selectedCart.items.map((item) => item.cartItemId)], tx);
  await touchCart(cart.id, tx);

  if (paymentMethod === 'vnpay') {
    const requestId = crypto.randomUUID();
    const redirectUrl = createPaymentUrl({
      orderCode: order.order_code,
      amount: order.grand_total,
      ipAddr,
      orderInfo: `Thanh toan don hang ${order.order_code}`,
      returnUrl: payload.vnpayReturnUrl
    });
    await logPaymentTransaction({
      tx,
      orderId: order.id,
      provider: 'vnpay',
      requestId,
      txnRef: order.order_code,
      eventType: 'create',
      amount: order.grand_total,
      status: 'pending',
      rawPayload: { orderCode: order.order_code, amount: order.grand_total, ipAddr }
    });
    return {
      order,
      payment: {
        provider: 'vnpay',
        redirectUrl,
        requestId
      }
    };
  }

  return { order, payment: null };
}

async function recordVnpayReturn(req) {
  const valid = verifyVnpayPayload(req.query);
  const order = (await query('SELECT id, order_code, grand_total, payment_status FROM orders WHERE order_code = $1', [req.query.vnp_TxnRef])).rows[0];
  if (order) {
    await withTransaction(async (tx) => {
      const amount = Number(req.query.vnp_Amount || 0) / 100;
      const success = valid && isSuccessfulVnpayResponse(req.query) && Math.round(amount) === Math.round(Number(order.grand_total || 0));
      await logPaymentTransaction({
        tx,
        orderId: order.id,
        provider: 'vnpay',
        providerRef: req.query.vnp_TransactionNo || null,
        txnRef: req.query.vnp_TxnRef || null,
        eventType: 'return',
        amount,
        status: success ? 'paid' : 'gateway_failed',
        checksumValid: valid ? 1 : 0,
        responseCode: req.query.vnp_ResponseCode || null,
        transactionStatus: req.query.vnp_TransactionStatus || null,
        rawPayload: req.query
      });
      if (success && order.payment_status !== 'paid') {
        await query(`UPDATE orders
          SET payment_status = 'paid',
              payment_provider = 'vnpay',
              payment_ref = $2,
              paid_at = COALESCE(paid_at, SYSUTCDATETIME()),
              payment_failure_reason = NULL,
              updated_at = SYSUTCDATETIME()
          WHERE id = $1`, [order.id, req.query.vnp_TransactionNo || req.query.vnp_BankTranNo || null], tx);
        await awardPointsIfEligible(order.id, tx);
      }
    });
  }
  return { valid, order };
}

async function finalizeVnpayIpn(params) {
  const valid = verifyVnpayPayload(params);
  const order = (await query('SELECT * FROM orders WHERE order_code = $1', [params.vnp_TxnRef])).rows[0];
  if (!valid) {
    if (order) {
      await withTransaction(async (tx) => {
        await logPaymentTransaction({
          tx,
          orderId: order.id,
          provider: 'vnpay',
          providerRef: params.vnp_TransactionNo || null,
          txnRef: params.vnp_TxnRef || null,
          eventType: 'ipn',
          amount: Number(params.vnp_Amount || 0) / 100,
          status: 'invalid_signature',
          checksumValid: 0,
          responseCode: params.vnp_ResponseCode || null,
          transactionStatus: params.vnp_TransactionStatus || null,
          rawPayload: params
        });
      });
    }
    return { code: '97', message: 'Invalid Signature', order };
  }
  if (!order) return { code: '01', message: 'Order not found', order: null };

  const amount = Number(params.vnp_Amount || 0) / 100;
  if (Math.round(amount) !== Math.round(Number(order.grand_total || 0))) {
    await withTransaction(async (tx) => {
      await logPaymentTransaction({
        tx,
        orderId: order.id,
        provider: 'vnpay',
        providerRef: params.vnp_TransactionNo || null,
        txnRef: params.vnp_TxnRef || null,
        eventType: 'ipn',
        amount,
        status: 'invalid_amount',
        checksumValid: 1,
        responseCode: params.vnp_ResponseCode || null,
        transactionStatus: params.vnp_TransactionStatus || null,
        rawPayload: params
      });
    });
    return { code: '04', message: 'Invalid Amount', order };
  }

  const success = isSuccessfulVnpayResponse(params);
  await withTransaction(async (tx) => {
    await logPaymentTransaction({
      tx,
      orderId: order.id,
      provider: 'vnpay',
      providerRef: params.vnp_TransactionNo || null,
      txnRef: params.vnp_TxnRef || null,
      eventType: 'ipn',
      amount,
      status: success ? 'paid' : 'failed',
      checksumValid: 1,
      responseCode: params.vnp_ResponseCode || null,
      transactionStatus: params.vnp_TransactionStatus || null,
      rawPayload: params
    });

    if (success) {
      if (order.payment_status !== 'paid') {
        await query(`UPDATE orders
          SET payment_status = 'paid',
              payment_provider = 'vnpay',
              payment_ref = $2,
              paid_at = COALESCE(paid_at, SYSUTCDATETIME()),
              payment_failure_reason = NULL,
              updated_at = SYSUTCDATETIME()
          WHERE id = $1`, [order.id, params.vnp_TransactionNo || params.vnp_BankTranNo || null], tx);
        await awardPointsIfEligible(order.id, tx);
        await createNotification({ tx, userId: order.user_id, title: `Thanh toan thanh cong ${order.order_code}`, message: `Don hang ${order.order_code} da duoc thanh toan thanh cong.` });
      }
      return;
    }

    if (order.payment_status !== 'paid') {
      await query(`UPDATE orders
        SET payment_status = 'failed',
            payment_provider = 'vnpay',
            payment_ref = $2,
            payment_failure_reason = $3,
            updated_at = SYSUTCDATETIME()
        WHERE id = $1`, [order.id, params.vnp_TransactionNo || params.vnp_BankTranNo || null, `VNPay response ${params.vnp_ResponseCode || 'unknown'}`], tx);
    }
  });

  return { code: '00', message: 'Confirm Success', order };
}

async function finalizeMomoIpn(payload) {
  const valid = verifyMomoResult(payload || {});
  if (!valid) return { status: 400, body: { resultCode: 97, message: 'Invalid signature' } };
  const order = (await query('SELECT * FROM orders WHERE order_code = $1', [payload.orderId])).rows[0];
  if (!order) return { status: 404, body: { resultCode: 1, message: 'Order not found' } };
  const success = Number(payload.resultCode) === 0;
  await withTransaction(async (tx) => {
    await logPaymentTransaction({
      tx,
      orderId: order.id,
      provider: 'momo',
      providerRef: payload.transId ? String(payload.transId) : null,
      txnRef: payload.orderId || null,
      eventType: 'ipn',
      amount: Number(payload.amount || order.grand_total || 0),
      status: success ? 'paid' : 'failed',
      checksumValid: 1,
      responseCode: String(payload.resultCode || ''),
      transactionStatus: success ? '00' : String(payload.resultCode || ''),
      rawPayload: payload
    });
    if (success && order.payment_status !== 'paid') {
      await query(`UPDATE orders
        SET payment_status = 'paid',
            payment_provider = 'momo',
            payment_ref = $2,
            paid_at = COALESCE(paid_at, SYSUTCDATETIME()),
            payment_failure_reason = NULL,
            updated_at = SYSUTCDATETIME()
        WHERE id = $1`, [order.id, payload.transId ? String(payload.transId) : null], tx);
      await awardPointsIfEligible(order.id, tx);
      await createNotification({ tx, userId: order.user_id, title: `Thanh toan thanh cong ${order.order_code}`, message: `Don hang ${order.order_code} da duoc thanh toan thanh cong.` });
    }
    if (!success && order.payment_status !== 'paid') {
      await query(`UPDATE orders
        SET payment_status = 'failed',
            payment_provider = 'momo',
            payment_ref = $2,
            payment_failure_reason = $3,
            updated_at = SYSUTCDATETIME()
        WHERE id = $1`, [order.id, payload.transId ? String(payload.transId) : null, `MoMo response ${payload.resultCode}`], tx);
    }
  });
  return { status: 200, body: { message: 'success' } };
}

ordersRouter.get('/payments/vnpay/return', async (req, res) => {
  const result = await recordVnpayReturn(req);
  const paymentState = result.valid && isSuccessfulVnpayResponse(req.query) ? 'success' : 'failed';
  const code = req.query.vnp_TxnRef || '';
  return res.redirect(`${frontendBaseUrl()}/info.html?payment=${paymentState}&order=${encodeURIComponent(code)}`);
});

ordersRouter.get('/payments/vnpay/ipn', async (req, res) => {
  const result = await finalizeVnpayIpn(req.query);
  return res.json({ RspCode: result.code, Message: result.message });
});

ordersRouter.post('/payments/momo/ipn', async (req, res) => {
  const result = await finalizeMomoIpn(req.body || {});
  return res.status(result.status).json(result.body);
});

ordersRouter.post('/checkout', async (req, res) => {
  try {
    const user = await requireCheckoutUser(req);
    const result = await withTransaction((tx) => createOrderRecord({ tx, user, payload: { ...(req.body || {}), vnpayReturnUrl: vnpayReturnUrl(req) }, ipAddr: extractIp(req) }));
    return ok(res, {
      order: result.order,
      paymentMethod: result.order.payment_method,
      paymentStatus: result.order.payment_status,
      paymentUrl: result.payment?.redirectUrl || null,
      payment: result.payment
    }, 201);
  } catch (error) {
    const status = error.message.includes('đăng nhập') || error.message.includes('xác thực email') ? 401 : 400;
    return fail(res, error.message, status);
  }
});

ordersRouter.post('/:orderCode/payments/vnpay/retry', async (req, res) => {
  try {
    const user = await requireCheckoutUser(req);
    const result = await withTransaction(async (tx) => {
      const order = (await query(`SELECT * FROM orders
        WHERE order_code = $1 AND user_id = $2`, [req.params.orderCode, user.id], tx)).rows[0];
      if (!order) throw new Error('Không tìm thấy đơn hàng');
      if (order.payment_method !== 'vnpay') throw new Error('Đơn hàng này không dùng VNPAY');
      if (order.payment_status === 'paid') throw new Error('Đơn hàng này đã thanh toán thành công');
      const requestId = crypto.randomUUID();
      const redirectUrl = createPaymentUrl({
        orderCode: order.order_code,
        amount: order.grand_total,
        ipAddr: extractIp(req),
        orderInfo: `Thanh toan lai don hang ${order.order_code}`,
        returnUrl: vnpayReturnUrl(req)
      });
      await query(`UPDATE orders
        SET payment_status = 'pending',
            payment_provider = 'vnpay',
            payment_requested_at = SYSUTCDATETIME(),
            payment_failure_reason = NULL,
            updated_at = SYSUTCDATETIME()
        WHERE id = $1`, [order.id], tx);
      await logPaymentTransaction({
        tx,
        orderId: order.id,
        provider: 'vnpay',
        requestId,
        txnRef: order.order_code,
        eventType: 'retry',
        amount: order.grand_total,
        status: 'pending',
        rawPayload: { orderCode: order.order_code, retry: true }
      });
      return { order, redirectUrl };
    });
    return ok(res, {
      orderCode: result.order.order_code,
      paymentMethod: 'vnpay',
      paymentStatus: 'pending',
      paymentUrl: result.redirectUrl
    });
  } catch (error) {
    return fail(res, error.message, 400);
  }
});

ordersRouter.get('/:orderCode', async (req, res) => {
  const order = (await query(`SELECT id, order_code, user_id, customer_name, email, phone, payment_method, payment_status,
    payment_provider, payment_ref, paid_at, payment_failure_reason, order_status, subtotal, discount_total,
    shipping_total, grand_total, shipping_address, note, coupon_code, shipping_provider, tracking_code,
    created_at, updated_at
    FROM orders WHERE order_code = $1`, [req.params.orderCode])).rows[0];
  if (!order) return fail(res, 'Không tìm thấy đơn hàng', 404);
  const items = (await query('SELECT * FROM order_items WHERE order_id = $1', [order.id])).rows.map((row) => ({
    ...row,
    selected_services: parseJson(row.selected_services, [])
  }));
  return ok(res, { ...order, shipping_address: parseJson(order.shipping_address, {}), items });
});
