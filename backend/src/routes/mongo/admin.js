import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { Router } from 'express';
import { ok, fail, slugify } from '../../lib/http.js';
import { connectMongo } from '../../lib/mongo.js';
import { requireAuth, requireRoles } from '../../middleware/auth.js';
import {
  Address,
  Banner,
  BlogPost,
  Coupon,
  InventoryReceipt,
  Notification,
  Order,
  OrderItem,
  Product,
  ProductImage,
  ProductReview,
  ProductService,
  ProductVariant,
  Setting,
  User,
  nextId
} from '../../models/mongo.js';

export const mongoAdminRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, '..', '..', '..', 'uploads');
const productUploadDir = path.join(uploadsRoot, 'products');
const bannerUploadDir = path.join(uploadsRoot, 'banners');
const blogUploadDir = path.join(uploadsRoot, 'blogs');
const notificationUploadDir = path.join(uploadsRoot, 'notifications');

[productUploadDir, bannerUploadDir, blogUploadDir, notificationUploadDir].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

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
const notificationUpload = makeUpload(notificationUploadDir);

mongoAdminRouter.use(async (_req, _res, next) => {
  await connectMongo();
  next();
});
mongoAdminRouter.use(requireAuth, requireRoles('admin', 'manager', 'warehouse', 'cskh'));

const toBool = (value) => value === true || value === 1;
const truthyNumber = (value) => (toBool(value) ? 1 : 0);
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const toNum = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function parseDateRange(fromRaw, toRaw) {
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - 29);
  const defaultFrom = fromDate.toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(fromRaw || '')) ? String(fromRaw) : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(toRaw || '')) ? String(toRaw) : defaultTo;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from, to, start, end };
}

function withoutMongoId(row) {
  if (!row) return row;
  const next = { ...row };
  delete next._id;
  return next;
}

function uploadedFiles(files, folder) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    url: `/uploads/${folder}/${file.filename}`,
    originalName: file.originalname,
    size: file.size
  }));
}

function parseNullableDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeVariants(variants = [], fallbackTipSize = null) {
  return (Array.isArray(variants) ? variants : [])
    .map((variant, index) => ({
      code: String(variant.code || `VAR-${index + 1}`).trim(),
      weight: String(variant.weight || '').trim(),
      tip_size: String(variant.tipSize || variant.tip_size || fallbackTipSize || '').trim(),
      stock: Math.max(0, toNum(variant.stock, 0)),
      price_delta: toNum(variant.priceDelta ?? variant.price_delta, 0)
    }))
    .filter((variant) => variant.code || variant.weight || variant.tip_size || variant.stock > 0 || variant.price_delta !== 0);
}

function normalizeServices(services = []) {
  return (Array.isArray(services) ? services : [])
    .map((service) => {
      const name = String(service?.name || '').trim();
      return {
        code: String(service?.code || slugify(name)).trim().toUpperCase(),
        name,
        price: toNum(service?.price, 0)
      };
    })
    .filter((service) => service.name);
}

function normalizeImageUrls(imageUrls = []) {
  return (Array.isArray(imageUrls) ? imageUrls : [])
    .map((value) => String(value || '').trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .map((image_url, index) => ({ image_url, sort_order: index + 1 }));
}

async function syncProductRelations(productId, body) {
  const variants = normalizeVariants(body.variants, body.tipSize || null);
  const services = normalizeServices(body.services);
  const images = normalizeImageUrls(body.imageUrls);

  await Promise.all([
    ProductVariant.deleteMany({ product_id: productId }),
    ProductService.deleteMany({ product_id: productId }),
    ProductImage.deleteMany({ product_id: productId })
  ]);

  const [variantRows, serviceRows, imageRows] = await Promise.all([
    Promise.all(variants.map(async (variant) => ({ id: await nextId('product_variants'), product_id: productId, ...variant }))),
    Promise.all(services.map(async (service) => ({ id: await nextId('product_services'), product_id: productId, ...service }))),
    Promise.all(images.map(async (image) => ({ id: await nextId('product_images'), product_id: productId, alt_text: String(body.name || ''), ...image })))
  ]);

  await Promise.all([
    variantRows.length ? ProductVariant.insertMany(variantRows) : Promise.resolve(),
    serviceRows.length ? ProductService.insertMany(serviceRows) : Promise.resolve(),
    imageRows.length ? ProductImage.insertMany(imageRows) : Promise.resolve()
  ]);

  if (variants.length) {
    await Product.updateOne({ id: productId }, { $set: { stock_total: variants.reduce((sum, variant) => sum + variant.stock, 0) } });
  }
}

function productPayload(body = {}, existing = {}) {
  const name = String(body.name || existing.name || '').trim();
  return {
    slug: String(body.slug || existing.slug || slugify(name)).trim(),
    sku: String(body.sku || existing.sku || '').trim(),
    name,
    brand: String(body.brand || existing.brand || '').trim(),
    type: String(body.type || existing.type || '').trim(),
    category_id: body.categoryId ?? existing.category_id ?? null,
    description: String(body.description ?? existing.description ?? ''),
    long_description: String(body.longDescription ?? existing.long_description ?? ''),
    price: toNum(body.price ?? existing.price, 0),
    sale_price: body.salePrice === '' || body.salePrice == null ? null : toNum(body.salePrice, null),
    cost: body.cost === '' || body.cost == null ? existing.cost ?? null : toNum(body.cost, null),
    tip_size: String(body.tipSize ?? existing.tip_size ?? ''),
    shaft_material: String(body.shaftMaterial ?? existing.shaft_material ?? ''),
    joint_type: String(body.jointType ?? existing.joint_type ?? ''),
    wrap_type: String(body.wrapType ?? existing.wrap_type ?? ''),
    butt_material: String(body.buttMaterial ?? existing.butt_material ?? ''),
    stock_total: Math.max(0, toNum(body.stockTotal ?? existing.stock_total, 0)),
    is_featured: truthyNumber(body.isFeatured),
    is_active: body.isActive === false ? 0 : 1,
    metadata: body.metadata || existing.metadata || {},
    updated_at: new Date()
  };
}

function normalizeProduct(row, extras = {}) {
  return withoutMongoId({
    ...row,
    is_featured: toBool(row.is_featured),
    is_active: toBool(row.is_active),
    ...extras
  });
}

async function productDetail(productId) {
  const id = Number(productId);
  const product = await Product.findOne({ id }).lean();
  if (!product) return null;
  const [variants, images, services] = await Promise.all([
    ProductVariant.find({ product_id: id }).sort({ created_at: 1, id: 1 }).lean(),
    ProductImage.find({ product_id: id }).sort({ sort_order: 1, id: 1 }).lean(),
    ProductService.find({ product_id: id }).sort({ created_at: 1, id: 1 }).lean()
  ]);
  return normalizeProduct(product, {
    variants: variants.map(withoutMongoId),
    images: images.map(withoutMongoId),
    services: services.map(withoutMongoId)
  });
}

mongoAdminRouter.get('/dashboard', async (req, res) => {
  const range = parseDateRange(req.query.from, req.query.to);
  const orders = await Order.find({ created_at: { $gte: range.start, $lt: range.end } }).sort({ created_at: -1 }).lean();
  const paidOrders = orders.filter((order) => order.payment_status === 'paid');
  const revenue = paidOrders.reduce((sum, order) => sum + Number(order.grand_total || 0), 0);

  const [topItems, lowStock] = await Promise.all([
    OrderItem.aggregate([
      { $group: { _id: '$product_id', name: { $first: '$product_name' }, sold_count: { $sum: '$quantity' } } },
      { $sort: { sold_count: -1, name: 1 } },
      { $limit: 5 }
    ]),
    Product.find({ stock_total: { $lte: 3 } }).sort({ stock_total: 1, name: 1 }).limit(10).lean()
  ]);

  const products = await Product.find({ id: { $in: topItems.map((item) => item._id) } }).lean();
  const productMap = new Map(products.map((product) => [product.id, product]));
  const dailyMap = new Map();
  for (const order of orders) {
    const key = dayKey(order.created_at);
    const current = dailyMap.get(key) || { order_date: key, orders_count: 0, revenue: 0 };
    current.orders_count += 1;
    if (order.payment_status === 'paid') current.revenue += Number(order.grand_total || 0);
    dailyMap.set(key, current);
  }

  return ok(res, {
    range: { from: range.from, to: range.to },
    kpis: {
      revenue,
      orders_count: orders.length,
      paid_orders: paidOrders.length,
      avg_paid_order: paidOrders.length ? Math.round(revenue / paidOrders.length) : 0
    },
    recentOrders: orders.slice(0, 8).map(withoutMongoId),
    topProducts: topItems.map((item) => {
      const product = productMap.get(item._id) || {};
      return { name: item.name, brand: product.brand || '', sold_count: item.sold_count, stock_total: product.stock_total || 0 };
    }),
    alerts: lowStock.map((product) => ({ name: product.name, stock_total: product.stock_total })),
    dailyRevenue: [...dailyMap.values()].sort((a, b) => a.order_date.localeCompare(b.order_date))
  });
});

mongoAdminRouter.post('/uploads/product-images', requireRoles('admin', 'manager', 'warehouse'), productUpload.array('images', 10), async (req, res) => {
  return ok(res, { files: uploadedFiles(req.files, 'products') }, 201);
});

mongoAdminRouter.post('/uploads/banner-images', requireRoles('admin', 'manager'), bannerUpload.array('images', 10), async (req, res) => {
  return ok(res, { files: uploadedFiles(req.files, 'banners') }, 201);
});

mongoAdminRouter.post('/uploads/blog-images', requireRoles('admin', 'manager'), blogUpload.array('images', 10), async (req, res) => {
  return ok(res, { files: uploadedFiles(req.files, 'blogs') }, 201);
});

mongoAdminRouter.post('/uploads/notification-images', requireRoles('admin', 'manager', 'cskh'), notificationUpload.array('images', 10), async (req, res) => {
  return ok(res, { files: uploadedFiles(req.files, 'notifications') }, 201);
});

mongoAdminRouter.get('/products', async (_req, res) => {
  const [products, imageRows, variantCounts] = await Promise.all([
    Product.find({}).sort({ created_at: -1 }).lean(),
    ProductImage.find({}).sort({ sort_order: 1, id: 1 }).lean(),
    ProductVariant.aggregate([{ $group: { _id: '$product_id', count: { $sum: 1 } } }])
  ]);
  const coverMap = new Map();
  for (const image of imageRows) {
    if (!coverMap.has(image.product_id)) coverMap.set(image.product_id, image.image_url);
  }
  const variantMap = new Map(variantCounts.map((row) => [row._id, row.count]));
  return ok(res, products.map((product) => normalizeProduct(product, {
    variants_count: variantMap.get(product.id) || 0,
    cover_image: coverMap.get(product.id) || ''
  })));
});

mongoAdminRouter.get('/products/:id', async (req, res) => {
  const product = await productDetail(req.params.id);
  if (!product) return fail(res, 'Không tìm thấy sản phẩm', 404);
  return ok(res, product);
});

mongoAdminRouter.post('/products', requireRoles('admin', 'manager', 'warehouse'), async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.sku || !body.brand || !body.type || !body.price) return fail(res, 'Thiếu dữ liệu sản phẩm');

  const id = await nextId('products');
  const payload = productPayload(body);
  const product = await Product.create({
    id,
    ...payload,
    slug: payload.slug || slugify(payload.name),
    created_at: new Date()
  });
  await syncProductRelations(id, body);
  return ok(res, await productDetail(product.id), 201);
});

mongoAdminRouter.put('/products/:id', requireRoles('admin', 'manager', 'warehouse'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await Product.findOne({ id }).lean();
  if (!existing) return fail(res, 'Không tìm thấy sản phẩm', 404);

  await Product.updateOne({ id }, { $set: productPayload(req.body || {}, existing) });
  await syncProductRelations(id, { ...existing, ...(req.body || {}) });
  return ok(res, await productDetail(id));
});

mongoAdminRouter.get('/orders', async (_req, res) => {
  const orders = await Order.find({}).sort({ created_at: -1 }).limit(200).lean();
  return ok(res, orders.map(withoutMongoId));
});

mongoAdminRouter.get('/customers', async (_req, res) => {
  const [customers, addresses, orders] = await Promise.all([
    User.find({ role: 'customer' }).sort({ created_at: -1 }).lean(),
    Address.find({}).sort({ is_default: -1, id: 1 }).lean(),
    Order.find({ user_id: { $ne: null } }).lean()
  ]);
  const addressMap = new Map();
  for (const address of addresses) {
    if (!addressMap.has(address.user_id)) addressMap.set(address.user_id, withoutMongoId(address));
  }
  const orderMap = new Map();
  for (const order of orders) {
    const current = orderMap.get(order.user_id) || { orders_count: 0, paid_revenue: 0, last_order_at: null };
    current.orders_count += 1;
    if (order.payment_status === 'paid') current.paid_revenue += Number(order.grand_total || 0);
    if (!current.last_order_at || new Date(order.created_at) > new Date(current.last_order_at)) current.last_order_at = order.created_at;
    orderMap.set(order.user_id, current);
  }
  return ok(res, customers.map((customer) => {
    const primaryAddress = addressMap.get(customer.id);
    return withoutMongoId({
    ...customer,
    fullName: customer.full_name,
    customer_tag: customer.customer_tag || 'new',
    primary_address: primaryAddress
      ? [primaryAddress.line1, primaryAddress.ward || primaryAddress.district || '', primaryAddress.city]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join(', ')
      : '',
    ...(orderMap.get(customer.id) || { orders_count: 0, paid_revenue: 0, last_order_at: null })
    });
  }));
});

mongoAdminRouter.get('/customers/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [customer, addresses, orders, reviews, notifications] = await Promise.all([
    User.findOne({ id, role: 'customer' }).lean(),
    Address.find({ user_id: id }).sort({ is_default: -1, id: 1 }).lean(),
    Order.find({ user_id: id }).sort({ created_at: -1 }).lean(),
    ProductReview.find({ user_id: id }).sort({ created_at: -1 }).limit(20).lean(),
    Notification.find({ user_id: id }).sort({ sent_at: -1 }).limit(20).lean()
  ]);
  if (!customer) return fail(res, 'Không tìm thấy khách hàng', 404);
  const [items, products] = await Promise.all([
    orders.length ? OrderItem.find({ order_id: { $in: orders.map((order) => order.id) } }).lean() : [],
    reviews.length ? Product.find({ id: { $in: reviews.map((review) => review.product_id) } }).lean() : []
  ]);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const paidOrders = orders.filter((order) => order.payment_status === 'paid');
  const user = withoutMongoId({
    ...customer,
    customer_tag: customer.customer_tag || 'new',
    orders_count: orders.length,
    paid_revenue: paidOrders.reduce((sum, order) => sum + Number(order.grand_total || 0), 0)
  });
  return ok(res, {
    user,
    addresses: addresses.map(withoutMongoId),
    reviews: reviews.map((review) => withoutMongoId({
      ...review,
      product_name: productMap.get(review.product_id)?.name || ''
    })),
    notifications: notifications.map(withoutMongoId),
    orders: orders.map((order) => withoutMongoId({
      ...order,
      items: items.filter((item) => item.order_id === order.id).map(withoutMongoId)
    }))
  });
});

mongoAdminRouter.get('/settings/general', async (_req, res) => {
  const setting = await Setting.findOne({ setting_key: 'general' }).lean();
  return ok(res, setting?.setting_value || {});
});

mongoAdminRouter.get('/coupons', async (_req, res) => {
  const coupons = await Coupon.find({}).sort({ created_at: -1 }).lean();
  return ok(res, coupons.map((coupon) => withoutMongoId({ ...coupon, active: toBool(coupon.active) })));
});

mongoAdminRouter.get('/content/banners', async (_req, res) => {
  const banners = await Banner.find({}).sort({ sort_order: 1, id: 1 }).lean();
  return ok(res, banners.map((banner) => withoutMongoId({ ...banner, active: toBool(banner.active) })));
});

mongoAdminRouter.post('/content/banners', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  const banner = await Banner.create({
    id: await nextId('banners'),
    title: String(body.title || ''),
    subtitle: String(body.subtitle || ''),
    image_url: String(body.imageUrl || ''),
    href: String(body.href || ''),
    sort_order: toNum(body.sortOrder, 0),
    active: body.active === false ? 0 : 1,
    created_at: new Date()
  });
  return ok(res, withoutMongoId({ ...banner.toObject(), active: toBool(banner.active) }), 201);
});

mongoAdminRouter.put('/content/banners/:id', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  const banner = await Banner.findOneAndUpdate(
    { id: Number(req.params.id) },
    {
      $set: {
        title: String(body.title || ''),
        subtitle: String(body.subtitle || ''),
        image_url: String(body.imageUrl || ''),
        href: String(body.href || ''),
        sort_order: toNum(body.sortOrder, 0),
        active: body.active === false ? 0 : 1
      }
    },
    { returnDocument: 'after' }
  ).lean();
  if (!banner) return fail(res, 'Không tìm thấy banner', 404);
  return ok(res, withoutMongoId({ ...banner, active: toBool(banner.active) }));
});

mongoAdminRouter.get('/content/posts', async (_req, res) => {
  const posts = await BlogPost.find({}).sort({ published_at: -1, created_at: -1 }).lean();
  return ok(res, posts.map((post) => withoutMongoId({ ...post, active: toBool(post.active) })));
});

mongoAdminRouter.post('/content/posts', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  const publishedAt = body.publishedAt ? parseNullableDateTime(body.publishedAt) : new Date();
  if (body.publishedAt && !publishedAt) return fail(res, 'Ngày đăng không hợp lệ', 400);
  const post = await BlogPost.create({
    id: await nextId('blog_posts'),
    slug: String(body.slug || slugify(body.title || 'blog-post')),
    title: String(body.title || ''),
    excerpt: String(body.excerpt || ''),
    content: String(body.content || ''),
    cover_image: String(body.coverImage || ''),
    active: body.active === false ? 0 : 1,
    published_at: publishedAt,
    created_at: new Date()
  });
  return ok(res, withoutMongoId({ ...post.toObject(), active: toBool(post.active) }), 201);
});

mongoAdminRouter.put('/content/posts/:id', requireRoles('admin', 'manager'), async (req, res) => {
  const body = req.body || {};
  const publishedAt = body.publishedAt ? parseNullableDateTime(body.publishedAt) : new Date();
  if (body.publishedAt && !publishedAt) return fail(res, 'Ngày đăng không hợp lệ', 400);
  const post = await BlogPost.findOneAndUpdate(
    { id: Number(req.params.id) },
    {
      $set: {
        slug: String(body.slug || slugify(body.title || 'blog-post')),
        title: String(body.title || ''),
        excerpt: String(body.excerpt || ''),
        content: String(body.content || ''),
        cover_image: String(body.coverImage || ''),
        active: body.active === false ? 0 : 1,
        published_at: publishedAt
      }
    },
    { returnDocument: 'after' }
  ).lean();
  if (!post) return fail(res, 'Không tìm thấy bài viết', 404);
  return ok(res, withoutMongoId({ ...post, active: toBool(post.active) }));
});

mongoAdminRouter.get('/reviews', async (_req, res) => {
  const reviews = await ProductReview.find({}).sort({ created_at: -1 }).limit(200).lean();
  const [users, products] = await Promise.all([
    User.find({ id: { $in: reviews.map((review) => review.user_id) } }).lean(),
    Product.find({ id: { $in: reviews.map((review) => review.product_id) } }).lean()
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const productMap = new Map(products.map((product) => [product.id, product]));
  return ok(res, reviews.map((review) => {
    const user = userMap.get(review.user_id) || {};
    const product = productMap.get(review.product_id) || {};
    return withoutMongoId({
      ...review,
      full_name: user.full_name || user.email || '',
      email: user.email || '',
      product_name: product.name || '',
      is_visible: toBool(review.is_visible)
    });
  }));
});

mongoAdminRouter.patch('/orders/:id/status', requireRoles('admin', 'manager', 'warehouse', 'cskh'), async (req, res) => {
  const order = await Order.findOneAndUpdate(
    { id: Number(req.params.id) },
    {
      $set: {
        order_status: String(req.body?.orderStatus || 'received'),
        payment_status: String(req.body?.paymentStatus || 'pending'),
        tracking_code: String(req.body?.trackingCode || ''),
        updated_at: new Date()
      }
    },
    { returnDocument: 'after' }
  ).lean();
  if (!order) return fail(res, 'Không tìm thấy đơn hàng', 404);
  return ok(res, withoutMongoId(order));
});

mongoAdminRouter.patch('/customers/:id/tag', requireRoles('admin', 'manager', 'cskh'), async (req, res) => {
  const tag = String(req.body?.customerTag || 'new');
  const user = await User.findOneAndUpdate(
    { id: Number(req.params.id), role: 'customer' },
    { $set: { customer_tag: tag, updated_at: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  if (!user) return fail(res, 'Không tìm thấy khách hàng', 404);
  return ok(res, withoutMongoId(user));
});

mongoAdminRouter.put('/settings/general', requireRoles('admin', 'manager'), async (req, res) => {
  const setting = await Setting.findOneAndUpdate(
    { setting_key: 'general' },
    { $set: { setting_value: req.body || {}, updated_at: new Date() }, $setOnInsert: { id: await nextId('settings') } },
    { upsert: true, returnDocument: 'after' }
  ).lean();
  return ok(res, setting.setting_value || {});
});

mongoAdminRouter.patch('/products/:id/visibility', requireRoles('admin', 'manager'), async (req, res) => {
  const product = await Product.findOneAndUpdate(
    { id: Number(req.params.id) },
    { $set: { is_active: truthyNumber(req.body?.isActive), updated_at: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  if (!product) return fail(res, 'Không tìm thấy sản phẩm', 404);
  return ok(res, normalizeProduct(product));
});

mongoAdminRouter.patch('/reviews/:id/visibility', requireRoles('admin', 'manager', 'cskh'), async (req, res) => {
  const review = await ProductReview.findOneAndUpdate(
    { id: Number(req.params.id) },
    { $set: { is_visible: truthyNumber(req.body?.isVisible), updated_at: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  if (!review) return fail(res, 'Không tìm thấy đánh giá', 404);
  return ok(res, withoutMongoId({ ...review, is_visible: toBool(review.is_visible) }));
});

mongoAdminRouter.post('/inventory/restock', requireRoles('admin', 'manager', 'warehouse'), async (req, res) => {
  const productId = Number(req.body?.productId);
  const variantId = req.body?.variantId ? Number(req.body.variantId) : null;
  const quantity = Math.max(0, Number(req.body?.quantity || 0));
  if (!productId || !quantity) return fail(res, 'Dữ liệu nhập kho không hợp lệ');

  if (variantId) {
    await ProductVariant.updateOne({ id: variantId, product_id: productId }, { $inc: { stock: quantity } });
  }
  const product = await Product.findOneAndUpdate(
    { id: productId },
    { $inc: { stock_total: quantity }, $set: { updated_at: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  if (!product) return fail(res, 'Không tìm thấy sản phẩm', 404);
  await InventoryReceipt.create({
    id: await nextId('inventory_receipts'),
    product_id: productId,
    variant_id: variantId,
    quantity,
    note: String(req.body?.note || ''),
    created_by: req.user?.id || null
  });
  return ok(res, normalizeProduct(product));
});
