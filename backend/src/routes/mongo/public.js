import { Router } from 'express';
import { ok } from '../../lib/http.js';
import { connectMongo } from '../../lib/mongo.js';
import {
  Banner,
  BlogPost,
  Category,
  Coupon,
  Product,
  ProductImage,
  ProductReview,
  ProductService,
  ProductVariant,
  Setting,
  User
} from '../../models/mongo.js';

export const mongoPublicRouter = Router();

const NSO_ADMIN_SERVICE_URL = 'https://danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx';
const locationCache = { provinces: null, areasByProvince: new Map() };

function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function bit(v) { return v === true || v === 1; }
function cleanDoc(row) {
  if (!row) return row;
  const next = { ...row };
  delete next._id;
  return next;
}
function xmlDecode(value = '') {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function extractTag(xml, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return xmlDecode(match?.[1] || '');
}
function parseSoapRows(xml = '', fieldMap = {}) {
  return [...String(xml || '').matchAll(/<TABLE\b[^>]*>([\s\S]*?)<\/TABLE>/gi)].map((match) => {
    const rowXml = match[1] || '';
    return Object.fromEntries(Object.entries(fieldMap).map(([key, tag]) => [key, extractTag(rowXml, tag)]));
  });
}
function currentEffectiveDate() {
  return new Date().toISOString().slice(0, 10);
}
async function callNsoSoap(operation, payloadXml) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><${operation} xmlns="http://tempuri.org/">${payloadXml}</${operation}></soap:Body>
</soap:Envelope>`;
  const response = await fetch(NSO_ADMIN_SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"http://tempuri.org/${operation}"` },
    body
  });
  if (!response.ok) throw new Error(`NSO SOAP ${operation} failed: ${response.status}`);
  return response.text();
}
async function loadProvinces() {
  if (locationCache.provinces) return locationCache.provinces;
  const xml = await callNsoSoap('DanhMucTinh', `<DenNgay>${currentEffectiveDate()}</DenNgay>`);
  const rows = parseSoapRows(xml, { code: 'MaTinh', name: 'TenTinh', type: 'LoaiHinh' }).filter((row) => row.code && row.name);
  locationCache.provinces = rows;
  return rows;
}
async function loadAreasByProvince(provinceCode) {
  const key = String(provinceCode || '').trim();
  if (!key) return [];
  if (locationCache.areasByProvince.has(key)) return locationCache.areasByProvince.get(key);
  const districtXml = await callNsoSoap('DanhMucQuanHuyen', `<DenNgay>${currentEffectiveDate()}</DenNgay><Tinh>${key}</Tinh><TenTinh></TenTinh>`);
  const districts = parseSoapRows(districtXml, { code: 'MaQuanHuyen', name: 'TenQuanHuyen' }).filter((row) => row.code);
  const areaMap = new Map();
  for (const district of districts) {
    const wardXml = await callNsoSoap('DanhMucPhuongXa', `<DenNgay>${currentEffectiveDate()}</DenNgay><Tinh>${key}</Tinh><TenTinh></TenTinh><QuanHuyen>${district.code}</QuanHuyen><TenQuanHuyen></TenQuanHuyen>`);
    const wards = parseSoapRows(wardXml, {
      code: 'MaPhuongXa',
      name: 'TenPhuongXa',
      type: 'LoaiHinh',
      districtCode: 'MaQuanHuyen',
      districtName: 'TenQuanHuyen'
    }).filter((row) => row.code && row.name);
    wards.forEach((ward) => areaMap.set(ward.code, ward));
  }
  const areas = [...areaMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  locationCache.areasByProvince.set(key, areas);
  return areas;
}

async function loadRelations(productId) {
  const [images, variants, services, reviews] = await Promise.all([
    ProductImage.find({ product_id: productId }).sort({ sort_order: 1, id: 1 }).lean(),
    ProductVariant.find({ product_id: productId }).sort({ weight: 1, id: 1 }).lean(),
    ProductService.find({ product_id: productId }).sort({ name: 1, id: 1 }).lean(),
    ProductReview.find({ product_id: productId, is_visible: 1 }).sort({ created_at: -1 }).limit(20).lean()
  ]);
  const users = reviews.length ? await User.find({ id: { $in: reviews.map((r) => r.user_id) } }, { id: 1, full_name: 1 }).lean() : [];
  const userMap = new Map(users.map((user) => [user.id, user]));
  return {
    images: images.map(cleanDoc),
    variants: variants.map(cleanDoc),
    services: services.map(cleanDoc),
    reviews: reviews.map((review) => cleanDoc({ ...review, full_name: userMap.get(review.user_id)?.full_name || 'Khách hàng' }))
  };
}

function normalizeSettings(value = {}) {
  const bank = {
    bankCode: value.bank?.bankCode || 'MB',
    accountNo: value.bank?.accountNo || '0909123456',
    accountName: value.bank?.accountName || 'BIDA PRO SHOP'
  };
  return {
    siteName: value.siteName || 'Bida Pro Shop',
    hotline: value.hotline || '0909 123 456',
    zalo: value.zalo || 'https://zalo.me/0339380482',
    messenger: value.messenger || 'https://www.facebook.com/share/18Wd2mrmYA/?mibextid=wwXIfr',
    showroom: value.showroom || '123 Nguyễn Trãi, Q.1, TP.HCM',
    shipping: value.shipping || { standard: 45000, freeFrom: 5000000 },
    bank,
    bankQr: value.bankQr || '',
    mapEmbed: value.mapEmbed || '',
    warrantyPolicy: value.warrantyPolicy || 'Bảo hành theo chính sách hãng.',
    returnPolicy: value.returnPolicy || 'Đổi trả theo chính sách cửa hàng.',
    shippingPolicy: value.shippingPolicy || 'Đóng gói ống nhựa cứng chống gãy.'
  };
}

mongoPublicRouter.use(async (_req, _res, next) => {
  await connectMongo();
  next();
});

mongoPublicRouter.get('/health', (_req, res) => ok(res, { status: 'ok', db: 'mongodb' }));
mongoPublicRouter.get('/settings', async (_req, res) => {
  const row = await Setting.findOne({ setting_key: 'general' }).lean();
  return ok(res, normalizeSettings(row?.setting_value || {}));
});
mongoPublicRouter.get('/categories', async (_req, res) => ok(res, (await Category.find({}).sort({ sort_order: 1, name: 1 }).lean()).map(cleanDoc)));
mongoPublicRouter.get('/banners', async (_req, res) => ok(res, (await Banner.find({ active: 1 }).sort({ sort_order: 1, id: 1 }).lean()).map(cleanDoc)));
mongoPublicRouter.get('/blog-posts', async (_req, res) => ok(res, (await BlogPost.find({ active: 1 }).sort({ published_at: -1, created_at: -1 }).limit(12).lean()).map(cleanDoc)));
mongoPublicRouter.get('/coupons', async (_req, res) => ok(res, (await Coupon.find({ active: 1 }).sort({ created_at: -1 }).lean()).map(cleanDoc)));
mongoPublicRouter.get('/locations/provinces', async (req, res) => {
  const keyword = String(req.query.q || '').trim().toLowerCase();
  const rows = await loadProvinces();
  return ok(res, keyword ? rows.filter((row) => `${row.name} ${row.type || ''}`.toLowerCase().includes(keyword)) : rows);
});
mongoPublicRouter.get('/locations/areas', async (req, res) => {
  const provinceCode = String(req.query.provinceCode || '').trim();
  if (!provinceCode) return ok(res, []);
  const keyword = String(req.query.q || '').trim().toLowerCase();
  const rows = await loadAreasByProvince(provinceCode);
  return ok(res, keyword ? rows.filter((row) => `${row.name} ${row.type || ''} ${row.districtName || ''}`.toLowerCase().includes(keyword)) : rows);
});

mongoPublicRouter.get('/products', async (req, res) => {
  const filter = { is_active: 1 };
  if (req.query.brand) filter.brand = req.query.brand;
  if (req.query.joint) filter.joint_type = req.query.joint;
  if (req.query.shaftMaterial) filter.shaft_material = req.query.shaftMaterial;
  if (req.query.wrap) filter.wrap_type = req.query.wrap;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.category) {
    const category = await Category.findOne({ slug: String(req.query.category) }).lean();
    filter.category_id = category?.id || -1;
  }
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { brand: rx }, { sku: rx }];
  }
  const priceExpr = [];
  if (req.query.minPrice) priceExpr.push({ $gte: [{ $ifNull: ['$sale_price', '$price'] }, n(req.query.minPrice)] });
  if (req.query.maxPrice) priceExpr.push({ $lte: [{ $ifNull: ['$sale_price', '$price'] }, n(req.query.maxPrice)] });
  if (priceExpr.length) filter.$expr = priceExpr.length === 1 ? priceExpr[0] : { $and: priceExpr };
  const sortMap = {
    price_asc: { effective_price: 1 },
    price_desc: { effective_price: -1 },
    best_selling: { sold_count: -1 },
    top_rated: { rating: -1 }
  };
  const sort = sortMap[req.query.sort] || { is_featured: -1, created_at: -1 };
  const rows = await Product.aggregate([
    { $match: filter },
    { $addFields: { effective_price: { $ifNull: ['$sale_price', '$price'] } } },
    { $sort: sort },
    { $limit: 48 },
    { $lookup: { from: 'categories', localField: 'category_id', foreignField: 'id', as: 'category' } },
    { $lookup: { from: 'product_images', localField: 'id', foreignField: 'product_id', as: 'images' } }
  ]);
  return ok(res, rows.map((row) => {
    const image = [...(row.images || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0))[0];
    return cleanDoc({
      ...row,
      category_name: row.category?.[0]?.name || null,
      category_slug: row.category?.[0]?.slug || null,
      cover_image: image?.image_url || '',
      is_featured: bit(row.is_featured)
    });
  }));
});

mongoPublicRouter.get('/products/:slug', async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, is_active: 1 }).lean();
  if (!product) return res.status(404).json({ ok: false, message: 'Product not found' });
  const category = product.category_id ? await Category.findOne({ id: product.category_id }).lean() : null;
  const relations = await loadRelations(product.id);
  const relatedFilter = { id: { $ne: product.id }, is_active: 1, $or: [{ brand: product.brand }, { type: product.type }] };
  let suggestions = await Product.find(relatedFilter).sort({ sold_count: -1, rating: -1, created_at: -1 }).limit(6).lean();
  if (suggestions.length < 6) {
    const excluded = [product.id, ...suggestions.map((item) => item.id)];
    const fallback = await Product.find({ id: { $nin: excluded }, is_active: 1 }).sort({ is_featured: -1, sold_count: -1, rating: -1, created_at: -1 }).limit(6 - suggestions.length).lean();
    suggestions = [...suggestions, ...fallback];
  }
  const suggestionImages = await ProductImage.find({ product_id: { $in: suggestions.map((item) => item.id) } }).sort({ sort_order: 1, id: 1 }).lean();
  const imageMap = new Map();
  suggestionImages.forEach((img) => { if (!imageMap.has(img.product_id)) imageMap.set(img.product_id, img.image_url); });
  const normalizedSuggestions = suggestions.map((item) => cleanDoc({ ...item, cover_image: imageMap.get(item.id) || '', is_featured: bit(item.is_featured) }));
  return ok(res, cleanDoc({
    ...product,
    category_name: category?.name || null,
    category_slug: category?.slug || null,
    is_featured: bit(product.is_featured),
    is_active: bit(product.is_active),
    ...relations,
    related: normalizedSuggestions,
    collaborativeSuggestions: normalizedSuggestions.slice(0, 4)
  }));
});
