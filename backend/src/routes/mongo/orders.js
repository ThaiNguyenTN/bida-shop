import { Router } from 'express';
import { fail, ok, orderCode } from '../../lib/http.js';
import { connectMongo } from '../../lib/mongo.js';
import { requireAuth } from '../../middleware/auth.js';
import { createPaymentUrl } from '../../services/payments/vnpay.js';
import {
  Address,
  Cart,
  CartItem,
  Coupon,
  Order,
  OrderItem,
  Product,
  ProductService,
  ProductVariant,
  nextId
} from '../../models/mongo.js';

export const mongoOrdersRouter = Router();

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}
function parseServices(value) {
  if (Array.isArray(value)) return value.map(String);
  try { return JSON.parse(value || '[]').map(String); } catch { return []; }
}
function validateCustomer(customer = {}) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer.email || '').trim())) return 'Vui lòng nhập email hợp lệ.';
  if (!String(customer.fullName || '').trim()) return 'Vui lòng nhập họ tên.';
  const phone = normalizePhone(customer.phone);
  if (!/^0\d{9}$/.test(phone)) return 'Số điện thoại phải gồm đúng 10 số và bắt đầu bằng 0.';
  if (!String(customer.address?.line1 || '').trim() || !String(customer.address?.ward || '').trim() || !String(customer.address?.city || '').trim()) return 'Vui lòng nhập địa chỉ giao hàng đầy đủ.';
  return null;
}
async function getActiveCart(userId) {
  return Cart.findOne({ user_id: userId, status: 'active' }).lean();
}
function requiresVerifiedEmail(user) {
  return String(user?.role || '').toLowerCase() === 'customer' && !Number(user?.email_verified);
}
async function evaluateCoupon(code, subtotal) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return { coupon: null, discount: 0 };
  const coupon = await Coupon.findOne({ code: normalized, active: 1 }).lean();
  if (!coupon) throw new Error('Voucher không tồn tại hoặc đã ngừng hoạt động.');
  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) throw new Error('Voucher chưa đến thời gian sử dụng.');
  if (coupon.ends_at && new Date(coupon.ends_at) < now) throw new Error('Voucher đã hết hạn.');
  if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) throw new Error('Voucher đã hết lượt sử dụng.');
  if (subtotal < Number(coupon.min_order_amount || 0)) throw new Error('Đơn hàng chưa đạt giá trị tối thiểu của voucher.');
  const discount = coupon.discount_type === 'percent'
    ? Math.min(subtotal, Math.round(subtotal * Number(coupon.value || 0) / 100))
    : Math.min(subtotal, Number(coupon.value || 0));
  return { coupon, discount };
}
async function ensureAddress(userId, customer) {
  const address = customer.address || {};
  const exists = await Address.findOne({ user_id: userId, line1: address.line1, ward: address.ward, city: address.city });
  if (exists) return;
  await Address.updateMany({ user_id: userId }, { $set: { is_default: 0 } });
  await Address.create({
    id: await nextId('addresses'),
    user_id: userId,
    label: 'Địa chỉ giao hàng',
    recipient_name: customer.fullName,
    phone: normalizePhone(customer.phone),
    line1: address.line1,
    ward: address.ward,
    district: '',
    city: address.city,
    is_default: 1
  });
}
async function buildCheckoutLines(cartId) {
  const cartItems = await CartItem.find({ cart_id: cartId, is_selected: 1 }).lean();
  if (!cartItems.length) throw new Error('Chọn ít nhất 1 sản phẩm để thanh toán.');
  const productIds = [...new Set(cartItems.map((item) => item.product_id))];
  const variantIds = [...new Set(cartItems.map((item) => item.variant_id).filter(Boolean))];
  const [products, variants, services] = await Promise.all([
    Product.find({ id: { $in: productIds }, is_active: 1 }).lean(),
    ProductVariant.find({ id: { $in: variantIds } }).lean(),
    ProductService.find({ product_id: { $in: productIds } }).lean()
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const variantMap = new Map(variants.map((v) => [v.id, v]));
  return cartItems.map((item) => {
    const product = productMap.get(item.product_id);
    if (!product) throw new Error('Có sản phẩm trong giỏ không còn khả dụng.');
    const variant = item.variant_id ? variantMap.get(item.variant_id) : null;
    if (item.variant_id && !variant) throw new Error('Có biến thể trong giỏ không còn khả dụng.');
    if (variant && Number(variant.stock || 0) < Number(item.quantity)) throw new Error(`Sản phẩm ${product.name} không đủ tồn kho.`);
    if (!variant && Number(product.stock_total || 0) < Number(item.quantity)) throw new Error(`Sản phẩm ${product.name} không đủ tồn kho.`);
    const selectedCodes = parseServices(item.selected_services);
    const selectedServices = services.filter((service) => service.product_id === product.id && selectedCodes.includes(service.code));
    const unitPrice = Number(product.sale_price || product.price || 0) + Number(variant?.price_delta || 0) + selectedServices.reduce((sum, s) => sum + Number(s.price || 0), 0);
    return {
      cartItem: item,
      product,
      variant,
      selectedServices,
      quantity: Number(item.quantity || 1),
      unitPrice,
      lineTotal: unitPrice * Number(item.quantity || 1)
    };
  });
}

mongoOrdersRouter.use(async (_req, _res, next) => {
  await connectMongo();
  next();
});

mongoOrdersRouter.post('/checkout', requireAuth, async (req, res) => {
  try {
    if (requiresVerifiedEmail(req.user)) return fail(res, 'Vui lòng xác thực email trước khi thanh toán', 401);
    const validationError = validateCustomer(req.body?.customer || {});
    if (validationError) return fail(res, validationError, 400);
    const orderEmail = String(req.body?.customer?.email || '').trim().toLowerCase();
    if (orderEmail !== String(req.user.email || '').trim().toLowerCase()) return fail(res, 'Email đặt hàng phải trùng với email tài khoản đã xác thực', 400);
    const cart = await getActiveCart(req.user.id);
    if (!cart) return fail(res, 'Giỏ hàng đang trống.', 400);
    const lines = await buildCheckoutLines(cart.id);
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const { coupon, discount } = await evaluateCoupon(req.body?.couponCode, subtotal);
    const shipping = lines.length ? 45000 : 0;
    const grandTotal = Math.max(0, subtotal - discount + shipping);
    const code = orderCode();
    const order = await Order.create({
      id: await nextId('orders'),
      order_code: code,
      user_id: req.user.id,
      customer_name: String(req.body.customer.fullName || '').trim(),
      email: String(req.body.customer.email || req.user.email || '').trim(),
      phone: normalizePhone(req.body.customer.phone),
      payment_method: req.body.paymentMethod || 'cod',
      payment_status: 'pending',
      order_status: 'received',
      subtotal,
      discount_total: discount,
      shipping_total: shipping,
      grand_total: grandTotal,
      shipping_address: req.body.customer.address,
      note: String(req.body.note || '').trim(),
      coupon_code: coupon?.code || '',
      guest_checkout: 0
    });
    for (const line of lines) {
      await OrderItem.create({
        id: await nextId('order_items'),
        order_id: order.id,
        product_id: line.product.id,
        variant_id: line.variant?.id || null,
        product_name: line.product.name,
        sku: line.product.sku,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        line_total: line.lineTotal,
        selected_services: line.selectedServices.map((service) => ({ code: service.code, name: service.name, price: service.price }))
      });
      if (line.variant) await ProductVariant.updateOne({ id: line.variant.id }, { $inc: { stock: -line.quantity } });
      await Product.updateOne({ id: line.product.id }, { $inc: { stock_total: -line.quantity, sold_count: line.quantity }, $set: { updated_at: new Date() } });
    }
    if (coupon) await Coupon.updateOne({ id: coupon.id }, { $inc: { used_count: 1 } });
    await CartItem.deleteMany({ cart_id: cart.id, is_selected: 1 });
    await Cart.updateOne({ id: cart.id }, { $set: { updated_at: new Date() } });
    await ensureAddress(req.user.id, req.body.customer);
    const result = { order };
    if (order.payment_method === 'vnpay') {
      result.paymentUrl = createPaymentUrl({ orderCode: order.order_code, amount: order.grand_total, ipAddr: req.ip, orderInfo: `Thanh toan ${order.order_code}` });
    }
    return ok(res, result, 201);
  } catch (error) {
    return fail(res, error.message, 400);
  }
});

mongoOrdersRouter.get('/:orderCode', async (req, res) => {
  const order = await Order.findOne({ order_code: req.params.orderCode }).lean();
  if (!order) return fail(res, 'Không tìm thấy đơn hàng', 404);
  const items = await OrderItem.find({ order_id: order.id }).lean();
  return ok(res, { ...order, items });
});
