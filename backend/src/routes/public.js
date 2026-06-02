import { Router } from 'express';
import { query } from '../lib/db.js';
import { ok } from '../lib/http.js';

export const publicRouter = Router();

const NSO_ADMIN_SERVICE_URL = 'https://danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx';
const locationCache = {
  provinces: null,
  areasByProvince: new Map()
};

function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function bit(v) { return v === true || v === 1; }
function xmlDecode(value = '') {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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
  <soap:Body>
    <${operation} xmlns="http://tempuri.org/">
      ${payloadXml}
    </${operation}>
  </soap:Body>
</soap:Envelope>`;
  const response = await fetch(NSO_ADMIN_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"http://tempuri.org/${operation}"`
    },
    body
  });
  if (!response.ok) throw new Error(`NSO SOAP ${operation} failed: ${response.status}`);
  return response.text();
}
async function loadProvinces() {
  if (locationCache.provinces) return locationCache.provinces;
  const xml = await callNsoSoap('DanhMucTinh', `<DenNgay>${currentEffectiveDate()}</DenNgay>`);
  const rows = parseSoapRows(xml, {
    code: 'MaTinh',
    name: 'TenTinh',
    type: 'LoaiHinh'
  }).filter((row) => row.code && row.name);
  locationCache.provinces = rows;
  return rows;
}
async function loadAreasByProvince(provinceCode) {
  const key = String(provinceCode || '').trim();
  if (!key) return [];
  if (locationCache.areasByProvince.has(key)) return locationCache.areasByProvince.get(key);
  const districtXml = await callNsoSoap('DanhMucQuanHuyen', `<DenNgay>${currentEffectiveDate()}</DenNgay><Tinh>${key}</Tinh><TenTinh></TenTinh>`);
  const districts = parseSoapRows(districtXml, {
    code: 'MaQuanHuyen',
    name: 'TenQuanHuyen'
  }).filter((row) => row.code);
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
    for (const ward of wards) {
      areaMap.set(ward.code, ward);
    }
  }
  const areas = [...areaMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  locationCache.areasByProvince.set(key, areas);
  return areas;
}

async function loadRelations(productId) {
  const [images, variants, services] = await Promise.all([
    query('SELECT id, image_url, alt_text, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC', [productId]),
    query('SELECT id, code, weight, tip_size, stock, price_delta FROM product_variants WHERE product_id = $1 ORDER BY weight ASC', [productId]),
    query('SELECT id, code, name, price FROM product_services WHERE product_id = $1 ORDER BY name ASC', [productId])
  ]);
  let reviews = [];
  try {
    reviews = (await query(`SELECT TOP 20 r.id, r.rating, r.comment, r.created_at, u.full_name FROM product_reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.product_id = $1 AND r.is_visible = 1
      ORDER BY r.created_at DESC`, [productId])).rows;
  } catch {
    reviews = [];
  }
  return { images: images.rows, variants: variants.rows, services: services.rows, reviews };
}

function normalizeSuggestionRows(rows = []) {
  return rows.map((row) => ({ ...row, is_featured: bit(row.is_featured) }));
}

function normalizeSettings(value = {}) {
  const bank = {
    bankCode: value.bank?.bankCode || 'MB',
    accountNo: value.bank?.accountNo || '0909123456',
    accountName: value.bank?.accountName || 'BIDA PRO SHOP'
  };
  return {
    siteName: value.siteName || 'Bida Pro Shop', hotline: value.hotline || '0909 123 456', zalo: value.zalo || 'https://zalo.me/0339380482',
    messenger: value.messenger || 'https://www.facebook.com/share/18Wd2mrmYA/?mibextid=wwXIfr', showroom: value.showroom || '123 Nguyễn Trãi, Q.1, TP.HCM',
    shipping: value.shipping || { standard: 45000, freeFrom: 5000000 }, bank, bankQr: value.bankQr || '', mapEmbed: value.mapEmbed || '',
    warrantyPolicy: value.warrantyPolicy || 'Bảo hành theo chính sách hãng.', returnPolicy: value.returnPolicy || 'Đổi trả theo chính sách cửa hàng.',
    shippingPolicy: value.shippingPolicy || 'Đóng gói ống nhựa cứng chống gãy.'
  };
}

publicRouter.get('/health', (_req, res) => ok(res, { status: 'ok' }));
publicRouter.get('/settings', async (_req, res) => {
  const result = await query('SELECT setting_value FROM settings WHERE setting_key = $1', ['general']);
  const value = result.rows[0]?.setting_value ? JSON.parse(result.rows[0].setting_value) : {};
  return ok(res, normalizeSettings(value));
});
publicRouter.get('/categories', async (_req, res) => ok(res, (await query('SELECT id, name, slug, parent_id, sort_order FROM categories ORDER BY sort_order ASC, name ASC')).rows));
publicRouter.get('/banners', async (_req, res) => ok(res, (await query('SELECT id, title, subtitle, image_url, href, sort_order FROM banners WHERE active = 1 ORDER BY sort_order ASC')).rows));
publicRouter.get('/blog-posts', async (_req, res) => ok(res, (await query('SELECT TOP 12 id, slug, title, excerpt, cover_image, published_at, content FROM blog_posts WHERE active = 1 ORDER BY published_at DESC, created_at DESC')).rows));
publicRouter.get('/coupons', async (_req, res) => ok(res, (await query('SELECT id, code, discount_type, value, min_order_amount, usage_limit, used_count, starts_at, ends_at FROM coupons WHERE active = 1 ORDER BY created_at DESC')).rows));
publicRouter.get('/locations/provinces', async (req, res) => {
  const keyword = String(req.query.q || '').trim().toLowerCase();
  const rows = await loadProvinces();
  const filtered = keyword
    ? rows.filter((row) => `${row.name} ${row.type || ''}`.toLowerCase().includes(keyword))
    : rows;
  return ok(res, filtered);
});
publicRouter.get('/locations/areas', async (req, res) => {
  const provinceCode = String(req.query.provinceCode || '').trim();
  if (!provinceCode) return ok(res, []);
  const keyword = String(req.query.q || '').trim().toLowerCase();
  const rows = await loadAreasByProvince(provinceCode);
  const filtered = keyword
    ? rows.filter((row) => `${row.name} ${row.type || ''} ${row.districtName || ''}`.toLowerCase().includes(keyword))
    : rows;
  return ok(res, filtered);
});

publicRouter.get('/products', async (req, res) => {
  let sql = `SELECT TOP 48 p.id, p.slug, p.sku, p.name, p.brand, p.type, p.description, p.price, p.sale_price,
           p.tip_size, p.shaft_material, p.joint_type, p.wrap_type, p.stock_total, p.rating, p.review_count,
           p.sold_count, p.is_featured, c.name AS category_name, c.slug AS category_slug,
           (SELECT TOP 1 image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC) AS cover_image
    FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1`;
  const params = [];
  const add = (clause, value) => { params.push(value); sql += ` AND ${clause.replace('?', `$${params.length}`)}`; };
  if (req.query.brand) add('p.brand = ?', req.query.brand);
  if (req.query.joint) add('p.joint_type = ?', req.query.joint);
  if (req.query.shaftMaterial) add('p.shaft_material = ?', req.query.shaftMaterial);
  if (req.query.wrap) add('p.wrap_type = ?', req.query.wrap);
  if (req.query.category) add('c.slug = ?', req.query.category);
  if (req.query.type) add('p.type = ?', req.query.type);
  if (req.query.minPrice) add('ISNULL(p.sale_price, p.price) >= ?', n(req.query.minPrice));
  if (req.query.maxPrice) add('ISNULL(p.sale_price, p.price) <= ?', n(req.query.maxPrice));
  if (req.query.q) {
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    sql += ` AND (p.name LIKE $${params.length - 2} OR p.brand LIKE $${params.length - 1} OR p.sku LIKE $${params.length})`;
  }
  let orderBy = 'p.is_featured DESC, p.created_at DESC';
  if (req.query.sort === 'price_asc') orderBy = 'ISNULL(p.sale_price, p.price) ASC';
  if (req.query.sort === 'price_desc') orderBy = 'ISNULL(p.sale_price, p.price) DESC';
  if (req.query.sort === 'best_selling') orderBy = 'p.sold_count DESC';
  if (req.query.sort === 'top_rated') orderBy = 'p.rating DESC';
  sql += ` ORDER BY ${orderBy}`;
  const result = await query(sql, params);
  return ok(res, result.rows.map((r) => ({ ...r, is_featured: bit(r.is_featured) })));
});

publicRouter.get('/products/:slug', async (req, res) => {
  const result = await query(`SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.slug = $1 AND p.is_active = 1`, [req.params.slug]);
  const product = result.rows[0];
  if (!product) return res.status(404).json({ ok: false, message: 'Product not found' });
  const relations = await loadRelations(product.id);
  const baseSuggestionSelect = `SELECT TOP 6
      p.id, p.slug, p.name, p.brand, p.type, p.joint_type, p.price, p.sale_price,
      p.stock_total, p.rating, p.review_count, p.sold_count, p.is_featured,
      (SELECT TOP 1 image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC, id ASC) AS cover_image
    FROM products p
    WHERE p.id <> $1 AND p.is_active = 1`;
  const related = normalizeSuggestionRows((await query(`${baseSuggestionSelect}
      AND (p.brand = $2 OR p.type = $3)
      ORDER BY p.sold_count DESC, p.rating DESC, p.created_at DESC`, [product.id, product.brand, product.type])).rows);
  let suggestions = [...related];
  if (suggestions.length < 6) {
    const excludedIds = [product.id, ...suggestions.map((item) => item.id)];
    const fallback = normalizeSuggestionRows((await query(`${baseSuggestionSelect}
      AND p.id NOT IN (${excludedIds.map((_, index) => `$${index + 2}`).join(',')})
      ORDER BY p.is_featured DESC, p.sold_count DESC, p.rating DESC, p.created_at DESC`, [product.id, ...excludedIds])).rows);
    suggestions = [...suggestions, ...fallback].slice(0, 6);
  }
  return ok(res, {
    ...product,
    is_featured: bit(product.is_featured),
    is_active: bit(product.is_active),
    ...relations,
    related: suggestions,
    collaborativeSuggestions: suggestions.slice(0, 4)
  });
});
