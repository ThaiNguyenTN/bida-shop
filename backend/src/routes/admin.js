import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { fail, ok, parseJson, slugify } from '../lib/http.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRoles('admin', 'manager', 'warehouse', 'cskh'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productUploadDir = path.join(__dirname, '..', '..', 'uploads', 'products');
const bannerUploadDir = path.join(__dirname, '..', '..', 'uploads', 'banners');
const blogUploadDir = path.join(__dirname, '..', '..', 'uploads', 'blogs');
fs.mkdirSync(productUploadDir, { recursive: true });
fs.mkdirSync(bannerUploadDir, { recursive: true });
fs.mkdirSync(blogUploadDir, { recursive: true });

function makeUpload(destination) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destination),
      filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
        const base = slugify(path.basename(file.originalname || 'image', ext)) || 'image';
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        cb(null, `${base}-${unique}${ext}`);
      }
    }),
    fileFilter: (_req, file, cb) => {
      if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Chỉ cho phép tải lên file ảnh'));
    },
    limits: { fileSize: 8 * 1024 * 1024, files: 10 }
  });
}

const productUpload = makeUpload(productUploadDir);
const bannerUpload = makeUpload(bannerUploadDir);
const blogUpload = makeUpload(blogUploadDir);

const toBool = (v) => v === true || v === 1;
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function normalizeVariants(variants = [], fallbackTipSize = null) {
  return (Array.isArray(variants) ? variants : [])
    .map((variant, index) => ({
      code: String(variant.code || `VAR-${index + 1}`).trim(),
      weight: String(variant.weight || '').trim() || null,
      tipSize: String(variant.tipSize || fallbackTipSize || '').trim() || null,
      stock: Math.max(0, Number(variant.stock || 0)),
      priceDelta: Number(variant.priceDelta || 0)
    }))
    .filter((variant) => variant.weight || variant.tipSize || variant.stock > 0 || variant.priceDelta !== 0 || variant.code);
}

function normalizeImageUrls(imageUrls = []) {
  const urls = Array.isArray(imageUrls) ? imageUrls : [];
  return urls
    .map((value) => String(value || '').trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .map((imageUrl, index) => ({ imageUrl, sortOrder: index + 1 }));
}

function parseDateRange(fromRaw, toRaw) {
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const defaultFromDate = new Date(today);
  defaultFromDate.setDate(defaultFromDate.getDate() - 29);
  const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(fromRaw || '')) ? String(fromRaw) : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(toRaw || '')) ? String(toRaw) : defaultTo;
  const start = new Date(`${from}T00:00:00.000Z`);
  const endExclusive = new Date(`${to}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { from, to, startIso: start.toISOString(), endIso: endExclusive.toISOString() };
}
function parseNullableDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeCouponPayload(body = {}) {
  const discountType = String(body.discountType || '').trim();
  const value = discountType === 'free_shipping' ? 0 : Number(body.value || 0);
  const minOrderAmount = Number(body.minOrderAmount || 0);
  const usageLimit = body.usageLimit ? Number(body.usageLimit) : null;
  if (!body.code || !discountType) throw new Error('Thiếu mã hoặc loại giảm giá');
  if (!['percent', 'fixed', 'free_shipping'].includes(discountType)) throw new Error('Loại giảm giá không hợp lệ');
  if (!Number.isFinite(minOrderAmount) || minOrderAmount < 0) throw new Error('Đơn tối thiểu không hợp lệ');
  if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit <= 0)) throw new Error('Giới hạn dùng phải là số nguyên lớn hơn 0');
  if (discountType === 'percent' && (!Number.isFinite(value) || value <= 0 || value > 100)) throw new Error('Voucher phần trăm phải lớn hơn 0% và không được vượt quá 100%');
  if (discountType === 'fixed' && (!Number.isFinite(value) || value <= 0)) throw new Error('Giá trị voucher phải lớn hơn 0');
  if (discountType === 'fixed' && minOrderAmount > 0 && value > minOrderAmount) throw new Error('Giá trị voucher không được lớn hơn đơn tối thiểu');
  return {
    code: String(body.code || '').trim().toUpperCase(),
    discountType,
    value,
    minOrderAmount,
    usageLimit,
    active: body.active === false ? 0 : 1
  };
}


async function loadProductDetail(productId) {
  const productResult = await query(`SELECT id, slug, sku, name, brand, type, category_id, description, long_description, price, sale_price, cost, tip_size, shaft_material, joint_type, wrap_type, butt_material, stock_total, is_featured, is_active, metadata
    FROM products WHERE id = $1`, [productId]);
  const product = productResult.rows[0];
  if (!product) return null;
  const [variants, images, services] = await Promise.all([
    query('SELECT id, code, weight, tip_size, stock, price_delta FROM product_variants WHERE product_id = $1 ORDER BY created_at ASC, id ASC', [productId]),
    query('SELECT id, image_url, alt_text, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC', [productId]),
    query('SELECT id, code, name, price FROM product_services WHERE product_id = $1 ORDER BY created_at ASC, id ASC', [productId])
  ]);
  return {
    ...product,
    is_featured: toBool(product.is_featured),
    is_active: toBool(product.is_active),
    metadata: parseJson(product.metadata, {}),
    variants: variants.rows,
    images: images.rows,
    services: services.rows
  };
}

async function syncRelations(productId, body, tx) {
  const variants = normalizeVariants(body.variants, body.tipSize || null);
  const images = normalizeImageUrls(body.imageUrls);
  const services = Array.isArray(body.services) ? body.services : [];

  await query('DELETE FROM product_variants WHERE product_id = $1', [productId], tx);
  for (const variant of variants) {
    await query(
      'INSERT INTO product_variants(product_id, code, weight, tip_size, stock, price_delta) VALUES ($1,$2,$3,$4,$5,$6)',
      [productId, variant.code, variant.weight, variant.tipSize, variant.stock, variant.priceDelta],
      tx
    );
  }

  await query('DELETE FROM product_images WHERE product_id = $1', [productId], tx);
  for (const image of images) {
    await query(
      'INSERT INTO product_images(product_id, image_url, alt_text, sort_order) VALUES ($1,$2,$3,$4)',
      [productId, image.imageUrl, body.name || '', image.sortOrder],
      tx
    );
  }

  await query('DELETE FROM product_services WHERE product_id = $1', [productId], tx);
  for (const service of services) {
    if (!service?.name) continue;
    await query('INSERT INTO product_services(product_id, code, name, price) VALUES ($1,$2,$3,$4)', [productId, String(service.code || slugify(service.name)).toUpperCase(), String(service.name).trim(), toNum(service.price)], tx);
  }

  if (variants.length) {
    const nextStockTotal = variants.reduce((sum, variant) => sum + variant.stock, 0);
    await query('UPDATE products SET stock_total = $2, updated_at = SYSUTCDATETIME() WHERE id = $1', [productId, nextStockTotal], tx);
  }
}

async function createNotification({ tx = null, couponId = null, couponCode = null, userId = null, title, message }) {
  return query('INSERT INTO notifications(user_id, coupon_id, title, message, sent_at) VALUES ($1,$2,$3,$4,SYSUTCDATETIME())', [userId, couponId, title, message || couponCode || ''], tx);
}

adminRouter.get('/dashboard', async (req, res) => {
  const range = parseDateRange(req.query.from, req.query.to);
  const [totals, recentOrders, topProducts, lowStock, dailyRevenue] = await Promise.all([
    query(`SELECT
      ISNULL(SUM(CASE WHEN payment_status = 'paid' THEN grand_total ELSE 0 END),0) AS revenue,
      COUNT(*) AS orders_count,
      SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
      ISNULL(AVG(CASE WHEN payment_status = 'paid' THEN grand_total END),0) AS avg_paid_order
      FROM orders WHERE created_at >= $1 AND created_at < $2`, [range.startIso, range.endIso]),
    query(`SELECT TOP 8 id, order_code, customer_name, grand_total, order_status, payment_status, created_at
      FROM orders WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at DESC`, [range.startIso, range.endIso]),
    query(`SELECT TOP 5 oi.product_name AS name, MAX(p.brand) AS brand, SUM(oi.quantity) AS sold_count, MAX(p.stock_total) AS stock_total
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.created_at >= $1 AND o.created_at < $2
      GROUP BY oi.product_name
      ORDER BY SUM(oi.quantity) DESC, oi.product_name ASC`, [range.startIso, range.endIso]),
    query(`SELECT TOP 10 name, stock_total FROM products WHERE stock_total <= 3 ORDER BY stock_total ASC, name ASC`),
    query(`SELECT CONVERT(varchar(10), created_at, 23) AS order_date,
      ISNULL(SUM(CASE WHEN payment_status = 'paid' THEN grand_total ELSE 0 END),0) AS revenue,
      COUNT(*) AS orders_count
      FROM orders WHERE created_at >= $1 AND created_at < $2
      GROUP BY CONVERT(varchar(10), created_at, 23)
      ORDER BY order_date ASC`, [range.startIso, range.endIso])
  ]);
  return ok(res, {
    range: { from: range.from, to: range.to },
    kpis: totals.rows[0],
    recentOrders: recentOrders.rows,
    topProducts: topProducts.rows,
    alerts: lowStock.rows,
    dailyRevenue: dailyRevenue.rows
  });
});

adminRouter.post('/uploads/product-images', requireRoles('admin', 'manager', 'warehouse'), productUpload.array('images', 10), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  return ok(res, { files: files.map((file) => ({ url: `/uploads/products/${file.filename}`, originalName: file.originalname, size: file.size })) }, 201);
});
adminRouter.post('/uploads/banner-images', requireRoles('admin', 'manager'), bannerUpload.array('images', 10), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  return ok(res, { files: files.map((file) => ({ url: `/uploads/banners/${file.filename}`, originalName: file.originalname, size: file.size })) }, 201);
});
adminRouter.post('/uploads/blog-images', requireRoles('admin', 'manager'), blogUpload.array('images', 10), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  return ok(res, { files: files.map((file) => ({ url: `/uploads/blogs/${file.filename}`, originalName: file.originalname, size: file.size })) }, 201);
});

adminRouter.get('/products', async (_req, res) => {
  const result = await query(`SELECT id, slug, sku, name, brand, type, description, long_description, price, sale_price, cost, tip_size, shaft_material, joint_type, wrap_type, butt_material, stock_total, is_featured, is_active,
      (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = products.id) AS variants_count,
      (SELECT TOP 1 image_url FROM product_images pi WHERE pi.product_id = products.id ORDER BY sort_order ASC, id ASC) AS cover_image
    FROM products ORDER BY created_at DESC`);
  return ok(res, result.rows.map((r) => ({ ...r, is_featured: toBool(r.is_featured), is_active: toBool(r.is_active) })));
});

adminRouter.get('/products/:id', async (req, res) => {
  const product = await loadProductDetail(req.params.id);
  if (!product) return fail(res, 'Không tìm thấy sản phẩm', 404);
  return ok(res, product);
});

adminRouter.post('/products', requireRoles('admin', 'manager', 'warehouse'), async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.sku || !body.brand || !body.type || !body.price) return fail(res, 'Thiếu dữ liệu sản phẩm');

  const created = await withTransaction(async (tx) => {
    const slug = body.slug || slugify(body.name);
    const variants = normalizeVariants(body.variants, body.tipSize || null);
    const stockTotal = variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : Math.max(0, Number(body.stockTotal || 0));
    const inserted = await query(`INSERT INTO products(slug, sku, name, brand, type, category_id, description, long_description, price, sale_price, cost, tip_size, shaft_material, joint_type, wrap_type, butt_material, stock_total, is_featured, is_active, metadata)
      OUTPUT INSERTED.id
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, [slug, body.sku, body.name, body.brand, body.type, body.categoryId || null, body.description || '', body.longDescription || '', Number(body.price), body.salePrice || null, body.cost || null, body.tipSize || null, body.shaftMaterial || null, body.jointType || null, body.wrapType || null, body.buttMaterial || null, stockTotal, body.isFeatured ? 1 : 0, body.isActive === false ? 0 : 1, JSON.stringify(body.metadata || {})], tx);
    await syncRelations(inserted.rows[0].id, body, tx);
    return inserted.rows[0].id;
  });

  return ok(res, await loadProductDetail(created), 201);
});

adminRouter.put('/products/:id', requireRoles('admin', 'manager', 'warehouse'), async (req, res) => {
  const body = req.body || {};
  const existing = await loadProductDetail(req.params.id);
  if (!existing) return fail(res, 'Không tìm thấy sản phẩm', 404);
  await withTransaction(async (tx) => {
    const variants = normalizeVariants(body.variants, body.tipSize || existing.tip_size || null);
    const stockTotal = variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : Math.max(0, Number(body.stockTotal ?? existing.stock_total ?? 0));
    await query(`UPDATE products SET
      slug = $2,
      sku = $3,
      name = $4,
      brand = $5,
      type = $6,
      category_id = $7,
      description = $8,
      long_description = $9,
      price = $10,
      sale_price = $11,
      cost = $12,
      tip_size = $13,
      shaft_material = $14,
      joint_type = $15,
      wrap_type = $16,
      butt_material = $17,
      stock_total = $18,
      is_featured = $19,
      is_active = $20,
      metadata = $21,
      updated_at = SYSUTCDATETIME()
      WHERE id = $1`, [req.params.id, body.slug || slugify(body.name || existing.name), body.sku || existing.sku, body.name || existing.name, body.brand || existing.brand, body.type || existing.type, body.categoryId || existing.category_id || null, body.description ?? existing.description ?? '', body.longDescription ?? existing.long_description ?? '', Number(body.price ?? existing.price), body.salePrice ?? existing.sale_price ?? null, body.cost ?? existing.cost ?? null, body.tipSize ?? existing.tip_size ?? null, body.shaftMaterial ?? existing.shaft_material ?? null, body.jointType ?? existing.joint_type ?? null, body.wrapType ?? existing.wrap_type ?? null, body.buttMaterial ?? existing.butt_material ?? null, stockTotal, body.isFeatured ? 1 : 0, body.isActive === false ? 0 : 1, JSON.stringify(body.metadata || parseJson(existing.metadata, {}))], tx);
    await syncRelations(req.params.id, { ...existing, ...body }, tx);
  });
  return ok(res, await loadProductDetail(req.params.id));
});

adminRouter.patch('/products/:id/visibility', requireRoles('admin', 'manager'), async (req, res) => {
  await query('UPDATE products SET is_active = $2, updated_at = SYSUTCDATETIME() WHERE id = $1', [req.params.id, req.body?.isActive ? 1 : 0]);
  return ok(res, { id: Number(req.params.id), isActive: Boolean(req.body?.isActive) });
});

adminRouter.post('/inventory/restock', requireRoles('admin', 'manager', 'warehouse'), async (req, res) => {
  const { productId, variantId, quantity, note } = req.body || {};
  const addQty = Math.max(1, Number(quantity || 0));
  if (!productId || !addQty) return fail(res, 'Thiếu sản phẩm hoặc số lượng nhập', 400);
  await withTransaction(async (tx) => {
    if (variantId) {
      await query('UPDATE product_variants SET stock = stock + $2 WHERE id = $1', [variantId, addQty], tx);
    }
    await query('UPDATE products SET stock_total = stock_total + $2, updated_at = SYSUTCDATETIME() WHERE id = $1', [productId, addQty], tx);
    await query('INSERT INTO inventory_receipts(product_id, variant_id, quantity, note, created_by) VALUES ($1,$2,$3,$4,$5)', [productId, variantId || null, addQty, note || null, req.user.id], tx);
  });
  return ok(res, { success: true });
});

adminRouter.get('/orders', async (_req, res) => ok(res, (await query(`SELECT TOP 100 id, order_code, customer_name, phone, grand_total, order_status, payment_status, created_at,
  shipping_provider, tracking_code, note FROM orders ORDER BY created_at DESC`)).rows));
adminRouter.patch('/orders/:id/status', requireRoles('admin', 'manager', 'warehouse', 'cskh'), async (req, res) => {
  const current = await query('SELECT id, order_code, user_id, order_status, payment_status, tracking_code, shipping_provider, grand_total, rewarded_points FROM orders WHERE id = $1', [req.params.id]);
  if (!current.rows[0]) return fail(res, 'Không tìm thấy đơn hàng', 404);
  const row = current.rows[0];
  const body = req.body || {};
  const nextOrderStatus = body.orderStatus || row.order_status;
  const nextPaymentStatus = body.paymentStatus || row.payment_status;
  await withTransaction(async (tx) => {
    await query('UPDATE orders SET order_status=$2, payment_status=$3, tracking_code=$4, shipping_provider=$5, updated_at=SYSUTCDATETIME() WHERE id=$1', [req.params.id, nextOrderStatus, nextPaymentStatus, body.trackingCode || row.tracking_code, body.shippingProvider || row.shipping_provider], tx);
    if (row.user_id && row.payment_status !== 'paid' && nextPaymentStatus === 'paid' && Number(row.rewarded_points || 0) === 0) {
      const points = Math.floor(Number(row.grand_total || 0) / 1000);
      if (points > 0) {
        await query(`UPDATE users SET points = points + $2,
          membership_level = CASE WHEN points + $2 >= 50000 THEN 'VIP' WHEN points + $2 >= 10000 THEN 'Silver' ELSE membership_level END,
          updated_at = SYSUTCDATETIME() WHERE id = $1`, [row.user_id, points], tx);
        await query('UPDATE orders SET rewarded_points = $2 WHERE id = $1', [req.params.id, points], tx);
        await createNotification({ tx, userId: row.user_id, title: 'Đã cộng điểm tích lũy', message: `Đơn ${row.order_code} đã cộng ${points} điểm vào tài khoản của bạn.` });
      }
    }
    if (row.user_id && row.order_status !== 'completed' && nextOrderStatus === 'completed') {
      await createNotification({ tx, userId: row.user_id, title: `Đơn ${row.order_code} đã hoàn thành`, message: `Đơn hàng ${row.order_code} đã hoàn thành. Cảm ơn bạn đã mua sắm.` });
    }
  });
  const updated = await query('SELECT id, order_code, order_status, payment_status, tracking_code, shipping_provider FROM orders WHERE id = $1', [req.params.id]);
  return ok(res, updated.rows[0]);
});

adminRouter.get('/customers', async (_req, res) => {
  const result = await query(`SELECT u.id, u.email, u.full_name, u.phone, u.membership_level, u.points,
      ISNULL(u.customer_tag,'new') AS customer_tag,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count,
      (SELECT ISNULL(SUM(o.grand_total),0) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid') AS paid_revenue,
      (SELECT TOP 1 line1 + ISNULL(', ' + district,'') + ISNULL(', ' + city,'') FROM addresses a WHERE a.user_id = u.id ORDER BY is_default DESC, created_at DESC) AS primary_address
    FROM users u WHERE u.role = 'customer' ORDER BY paid_revenue DESC, u.created_at DESC`);
  return ok(res, result.rows);
});

adminRouter.get('/customers/:id', async (req, res) => {
  const user = (await query(`SELECT id, email, full_name, phone, membership_level, points, ISNULL(customer_tag,'new') AS customer_tag, created_at,
    (SELECT ISNULL(SUM(grand_total),0) FROM orders WHERE user_id = users.id AND payment_status = 'paid') AS paid_revenue,
    (SELECT COUNT(*) FROM orders WHERE user_id = users.id) AS orders_count
    FROM users WHERE id = $1 AND role='customer'`, [req.params.id])).rows[0];
  if (!user) return fail(res, 'Không tìm thấy khách hàng', 404);
  const [addresses, orders, reviews, notifications] = await Promise.all([
    query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [req.params.id]),
    query(`SELECT TOP 30 o.id, o.order_code, o.created_at, o.grand_total, o.order_status, o.payment_status,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
      FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [req.params.id]),
    query(`SELECT TOP 20 r.id, r.rating, r.comment, r.created_at, p.name AS product_name
      FROM product_reviews r JOIN products p ON p.id = r.product_id WHERE r.user_id = $1 ORDER BY r.created_at DESC`, [req.params.id]),
    query(`SELECT TOP 20 id, title, message, sent_at FROM notifications WHERE user_id = $1 ORDER BY sent_at DESC`, [req.params.id])
  ]);
  const orderIds = orders.rows.map((o) => o.id);
  const items = orderIds.length ? await query(`SELECT oi.order_id, oi.product_name, oi.quantity, oi.unit_price, oi.line_total
      FROM order_items oi WHERE oi.order_id IN (${orderIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY oi.order_id DESC`, orderIds) : { rows: [] };
  return ok(res, { user, addresses: addresses.rows, orders: orders.rows.map((order) => ({ ...order, items: items.rows.filter((x) => x.order_id === order.id) })), reviews: reviews.rows, notifications: notifications.rows });
});

adminRouter.patch('/customers/:id/tag', requireRoles('admin', 'manager', 'cskh'), async (req, res) => {
  const tag = String(req.body?.customerTag || 'new').trim();
  await query('UPDATE users SET customer_tag = $2, membership_level = CASE WHEN $2 = \'vip\' THEN \'VIP\' WHEN $2 = \'wholesale\' THEN \'Wholesale\' ELSE membership_level END, updated_at = SYSUTCDATETIME() WHERE id = $1', [req.params.id, tag]);
  return ok(res, { id: Number(req.params.id), customerTag: tag });
});

adminRouter.get('/coupons', async (_req, res) => ok(res, (await query('SELECT * FROM coupons ORDER BY created_at DESC')).rows));

adminRouter.get('/coupons/:id/recipients', async (req, res) => {
  const coupon = (await query('SELECT * FROM coupons WHERE id = $1', [req.params.id])).rows[0];
  if (!coupon) return fail(res, 'Không tìm thấy voucher', 404);

  const recipients = await query(`SELECT
      u.id,
      u.full_name,
      u.email,
      u.phone,
      u.points,
      u.membership_level,
      ISNULL(u.customer_tag, 'new') AS customer_tag,
      COUNT(n.id) AS received_count,
      MIN(n.sent_at) AS first_sent_at,
      MAX(n.sent_at) AS last_sent_at,
      SUM(CASE WHEN n.is_read = 1 THEN 1 ELSE 0 END) AS read_count
    FROM notifications n
    INNER JOIN users u ON u.id = n.user_id
    WHERE n.coupon_id = $1
    GROUP BY u.id, u.full_name, u.email, u.phone, u.points, u.membership_level, u.customer_tag
    ORDER BY MAX(n.sent_at) DESC`, [req.params.id]);

  const usage = await query(`SELECT
      o.user_id,
      COUNT(*) AS used_count,
      ISNULL(SUM(o.grand_total), 0) AS used_revenue,
      ISNULL(SUM(o.discount_total), 0) AS discount_total,
      MAX(o.created_at) AS last_used_at
    FROM orders o
    WHERE o.user_id IS NOT NULL AND UPPER(o.coupon_code) = UPPER($1)
    GROUP BY o.user_id`, [coupon.code]);

  const usageByUser = new Map(usage.rows.map((row) => [Number(row.user_id), row]));
  const rows = recipients.rows.map((row) => {
    const used = usageByUser.get(Number(row.id)) || {};
    return {
      ...row,
      received_count: Number(row.received_count || 0),
      read_count: Number(row.read_count || 0),
      used_count: Number(used.used_count || 0),
      used_revenue: Number(used.used_revenue || 0),
      discount_total: Number(used.discount_total || 0),
      last_used_at: used.last_used_at || null
    };
  });

  const usageFromNonRecipients = usage.rows
    .filter((row) => !recipients.rows.some((recipient) => Number(recipient.id) === Number(row.user_id)))
    .reduce((sum, row) => sum + Number(row.used_count || 0), 0);

  return ok(res, {
    coupon,
    summary: {
      recipient_count: rows.length,
      received_notifications: rows.reduce((sum, row) => sum + Number(row.received_count || 0), 0),
      read_notifications: rows.reduce((sum, row) => sum + Number(row.read_count || 0), 0),
      used_count: usage.rows.reduce((sum, row) => sum + Number(row.used_count || 0), 0),
      used_by_recipients: rows.reduce((sum, row) => sum + Number(row.used_count || 0), 0),
      usage_from_non_recipients: usageFromNonRecipients,
      used_revenue: usage.rows.reduce((sum, row) => sum + Number(row.used_revenue || 0), 0),
      discount_total: usage.rows.reduce((sum, row) => sum + Number(row.discount_total || 0), 0)
    },
    recipients: rows
  });
});

adminRouter.post('/coupons', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  let couponPayload;
  try {
    couponPayload = normalizeCouponPayload(body);
  } catch (error) {
    return fail(res, error.message, 400);
  }
  const startsAt = parseNullableDateTime(body.startsAt);
  const endsAt = parseNullableDateTime(body.endsAt);
  if (body.startsAt && !startsAt) return fail(res, 'Ngày bắt đầu không hợp lệ', 400);
  if (body.endsAt && !endsAt) return fail(res, 'Ngày kết thúc không hợp lệ', 400);
  if (startsAt && endsAt && startsAt > endsAt) return fail(res, 'Ngày kết thúc phải sau ngày bắt đầu', 400);
  const result = await query('INSERT INTO coupons(code, discount_type, value, min_order_amount, usage_limit, starts_at, ends_at, active) OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [couponPayload.code, couponPayload.discountType, couponPayload.value, couponPayload.minOrderAmount, couponPayload.usageLimit, startsAt, endsAt, couponPayload.active]);
  return ok(res, result.rows[0], 201);
});
adminRouter.put('/coupons/:id', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  let couponPayload;
  try {
    couponPayload = normalizeCouponPayload(body);
  } catch (error) {
    return fail(res, error.message, 400);
  }
  const startsAt = parseNullableDateTime(body.startsAt);
  const endsAt = parseNullableDateTime(body.endsAt);
  if (body.startsAt && !startsAt) return fail(res, 'Ngày bắt đầu không hợp lệ', 400);
  if (body.endsAt && !endsAt) return fail(res, 'Ngày kết thúc không hợp lệ', 400);
  if (startsAt && endsAt && startsAt > endsAt) return fail(res, 'Ngày kết thúc phải sau ngày bắt đầu', 400);
  await query('UPDATE coupons SET code=$2, discount_type=$3, value=$4, min_order_amount=$5, usage_limit=$6, starts_at=$7, ends_at=$8, active=$9 WHERE id = $1', [req.params.id, couponPayload.code, couponPayload.discountType, couponPayload.value, couponPayload.minOrderAmount, couponPayload.usageLimit, startsAt, endsAt, couponPayload.active]);
  const row = (await query('SELECT * FROM coupons WHERE id = $1', [req.params.id])).rows[0];
  return ok(res, row);
});
adminRouter.post('/coupons/:id/notify', requireRoles('admin', 'manager', 'cskh'), async (req, res) => {
  const coupon = (await query('SELECT * FROM coupons WHERE id = $1', [req.params.id])).rows[0];
  if (!coupon) return fail(res, 'Không tìm thấy voucher', 404);
  const audience = String(req.body?.audience || 'vip');
  const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(Number).filter(Boolean) : [];
  const minPoints = Math.max(0, Number(req.body?.minPoints || 0));
  let customers = [];
  if (audience === 'selected') {
    if (!userIds.length) return fail(res, 'Hãy nhập ID khách hàng', 400);
    customers = (await query(`SELECT id FROM users WHERE role='customer' AND id IN (${userIds.map((_, i) => `$${i + 1}`).join(',')})`, userIds)).rows;
  } else if (audience === 'vip') {
    customers = (await query(`SELECT id FROM users WHERE role='customer' AND (ISNULL(customer_tag,'new')='vip' OR membership_level='VIP')`)).rows;
  } else if (audience === 'points') {
    customers = (await query("SELECT id FROM users WHERE role='customer' AND points >= $1", [minPoints])).rows;
  } else {
    customers = (await query(`SELECT id FROM users WHERE role='customer'`)).rows;
  }
  await withTransaction(async (tx) => {
    for (const customer of customers) {
      await createNotification({ tx, userId: customer.id, couponId: coupon.id, couponCode: coupon.code, title: `Voucher ${coupon.code}`, message: req.body?.message || `Bạn nhận được voucher ${coupon.code}` });
    }
  });
  return ok(res, { sent: customers.length });
});

adminRouter.get('/content/banners', async (_req, res) => ok(res, (await query('SELECT * FROM banners ORDER BY sort_order ASC, created_at DESC')).rows));
adminRouter.post('/content/banners', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  const result = await query('INSERT INTO banners(title, subtitle, image_url, href, sort_order, active) OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6)', [body.title || '', body.subtitle || '', body.imageUrl || '', body.href || '', body.sortOrder || 0, body.active === false ? 0 : 1]);
  return ok(res, result.rows[0], 201);
});
adminRouter.put('/content/banners/:id', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  await query('UPDATE banners SET title=$2, subtitle=$3, image_url=$4, href=$5, sort_order=$6, active=$7 WHERE id = $1', [req.params.id, body.title || '', body.subtitle || '', body.imageUrl || '', body.href || '', body.sortOrder || 0, body.active === false ? 0 : 1]);
  return ok(res, (await query('SELECT * FROM banners WHERE id = $1', [req.params.id])).rows[0]);
});

adminRouter.get('/content/posts', async (_req, res) => ok(res, (await query('SELECT * FROM blog_posts ORDER BY published_at DESC, created_at DESC')).rows));
adminRouter.post('/content/posts', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  const slug = body.slug || slugify(body.title || 'blog-post');
  const publishedAt = body.publishedAt ? parseNullableDateTime(body.publishedAt) : new Date();
  if (body.publishedAt && !publishedAt) return fail(res, 'Ngày đăng không hợp lệ', 400);
  const result = await query('INSERT INTO blog_posts(slug, title, excerpt, content, cover_image, active, published_at) OUTPUT INSERTED.* VALUES ($1,$2,$3,$4,$5,$6,$7)', [slug, body.title || '', body.excerpt || '', body.content || '', body.coverImage || '', body.active === false ? 0 : 1, publishedAt]);
  return ok(res, result.rows[0], 201);
});
adminRouter.put('/content/posts/:id', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  const slug = body.slug || slugify(body.title || 'blog-post');
  const publishedAt = body.publishedAt ? parseNullableDateTime(body.publishedAt) : new Date();
  if (body.publishedAt && !publishedAt) return fail(res, 'Ngày đăng không hợp lệ', 400);
  await query('UPDATE blog_posts SET slug=$2, title=$3, excerpt=$4, content=$5, cover_image=$6, active=$7, published_at=$8 WHERE id = $1', [req.params.id, slug, body.title || '', body.excerpt || '', body.content || '', body.coverImage || '', body.active === false ? 0 : 1, publishedAt]);
  return ok(res, (await query('SELECT * FROM blog_posts WHERE id = $1', [req.params.id])).rows[0]);
});

adminRouter.get('/reviews', async (_req, res) => {
  const reviews = await query(`SELECT TOP 100 r.id, r.rating, r.comment, r.created_at, r.is_visible, u.full_name, u.email, p.name AS product_name, p.id AS product_id
    FROM product_reviews r
    JOIN users u ON u.id = r.user_id
    JOIN products p ON p.id = r.product_id
    ORDER BY r.created_at DESC`);
  return ok(res, reviews.rows.map((r) => ({ ...r, is_visible: toBool(r.is_visible) })));
});
adminRouter.patch('/reviews/:id/visibility', requireRoles('admin', 'manager', 'cskh'), async (req, res) => {
  await query('UPDATE product_reviews SET is_visible = $2 WHERE id = $1', [req.params.id, req.body?.isVisible ? 1 : 0]);
  return ok(res, { id: Number(req.params.id), isVisible: Boolean(req.body?.isVisible) });
});

adminRouter.get('/settings/general', async (_req, res) => {
  const result = await query('SELECT setting_value FROM settings WHERE setting_key = $1', ['general']);
  return ok(res, parseJson(result.rows[0]?.setting_value, {}));
});
adminRouter.put('/settings/general', requireRoles('admin', 'manager'), async (req, res) => {
  const exists = await query('SELECT id FROM settings WHERE setting_key = $1', ['general']);
  if (exists.rows[0]) await query('UPDATE settings SET setting_value = $2, updated_at = SYSUTCDATETIME() WHERE setting_key = $1', ['general', JSON.stringify(req.body || {})]);
  else await query('INSERT INTO settings(setting_key, setting_value) VALUES ($1,$2)', ['general', JSON.stringify(req.body || {})]);
  return ok(res, req.body || {});
});
