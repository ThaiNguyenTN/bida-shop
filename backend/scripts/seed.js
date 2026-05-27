import { hashPassword } from '../src/lib/auth.js';
import { query } from '../src/lib/db.js';
import { slugify } from '../src/lib/http.js';

async function upsertUser({ email, password, fullName, role, phone = null, points = 0, membershipLevel = 'Standard' }) {
  const passwordHash = await hashPassword(password);
  const exists = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (exists.rows[0]) {
    await query('UPDATE users SET password_hash = $2, full_name = $3, role = $4, phone = $5, points = $6, membership_level = $7, updated_at = SYSUTCDATETIME() WHERE email = $1', [email, passwordHash, fullName, role, phone, points, membershipLevel]);
    return exists.rows[0].id;
  }
  const result = await query('INSERT INTO users(email, password_hash, full_name, role, phone, points, membership_level) OUTPUT INSERTED.id VALUES ($1,$2,$3,$4,$5,$6,$7)', [email, passwordHash, fullName, role, phone, points, membershipLevel]);
  return result.rows[0].id;
}

async function ensureCategory(name, parentId = null, sortOrder = 0) {
  const slug = slugify(name);
  const existing = await query('SELECT id FROM categories WHERE slug = $1', [slug]);
  if (existing.rows[0]) return existing.rows[0].id;
  const result = await query('INSERT INTO categories(name, slug, parent_id, sort_order) OUTPUT INSERTED.id VALUES ($1,$2,$3,$4)', [name, slug, parentId, sortOrder]);
  return result.rows[0].id;
}

async function seedProduct(categoryId, product, variants = [], services = [], images = []) {
  const existing = await query('SELECT id FROM products WHERE sku = $1', [product.sku]);
  let productId;
  if (existing.rows[0]) {
    productId = existing.rows[0].id;
    await query(`UPDATE products SET slug=$2,name=$3,brand=$4,type=$5,category_id=$6,description=$7,long_description=$8,price=$9,sale_price=$10,cost=$11,tip_size=$12,shaft_material=$13,joint_type=$14,wrap_type=$15,butt_material=$16,stock_total=$17,rating=$18,review_count=$19,sold_count=$20,is_featured=$21,metadata=$22,updated_at=SYSUTCDATETIME() WHERE sku=$1`, [product.sku, product.slug, product.name, product.brand, product.type, categoryId, product.description, product.longDescription, product.price, product.salePrice, product.cost, product.tipSize, product.shaftMaterial, product.jointType, product.wrapType, product.buttMaterial, product.stockTotal, product.rating, product.reviewCount, product.soldCount, product.isFeatured ? 1 : 0, JSON.stringify(product.metadata || {})]);
    await query('DELETE FROM product_variants WHERE product_id = $1', [productId]);
    await query('DELETE FROM product_services WHERE product_id = $1', [productId]);
    await query('DELETE FROM product_images WHERE product_id = $1', [productId]);
  } else {
    const inserted = await query(`INSERT INTO products(slug, sku, name, brand, type, category_id, description, long_description, price, sale_price, cost, tip_size, shaft_material, joint_type, wrap_type, butt_material, stock_total, rating, review_count, sold_count, is_featured, metadata)
      OUTPUT INSERTED.id VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, [product.slug, product.sku, product.name, product.brand, product.type, categoryId, product.description, product.longDescription, product.price, product.salePrice, product.cost, product.tipSize, product.shaftMaterial, product.jointType, product.wrapType, product.buttMaterial, product.stockTotal, product.rating, product.reviewCount, product.soldCount, product.isFeatured ? 1 : 0, JSON.stringify(product.metadata || {})]);
    productId = inserted.rows[0].id;
  }

  for (const variant of variants) {
    await query('INSERT INTO product_variants(product_id, code, weight, tip_size, stock, price_delta) VALUES ($1,$2,$3,$4,$5,$6)', [productId, variant.code, variant.weight, variant.tipSize, variant.stock, variant.priceDelta || 0]);
  }
  for (const service of services) {
    await query('INSERT INTO product_services(product_id, code, name, price) VALUES ($1,$2,$3,$4)', [productId, service.code, service.name, service.price]);
  }
  for (const image of images) {
    await query('INSERT INTO product_images(product_id, image_url, alt_text, sort_order) VALUES ($1,$2,$3,$4)', [productId, image.url, image.alt || null, image.sortOrder || 0]);
  }
}

await upsertUser({ email: 'admin@bidaproshop.vn', password: 'admin123', fullName: 'Admin Bida', role: 'admin', membershipLevel: 'VIP' });
await upsertUser({ email: 'manager@bidaproshop.vn', password: 'manager123', fullName: 'Quản lý cửa hàng', role: 'manager', membershipLevel: 'VIP' });
await upsertUser({ email: 'kho@bidaproshop.vn', password: 'kho123', fullName: 'Nhân viên kho', role: 'warehouse' });
await upsertUser({ email: 'cskh@bidaproshop.vn', password: 'cskh123', fullName: 'Nhân viên CSKH', role: 'cskh' });
await upsertUser({ email: 'khach1@example.com', password: '123456', fullName: 'Nguyễn Văn A', role: 'customer', phone: '0909000001', points: 1200, membershipLevel: 'VIP' });

const poolCat = await ensureCategory('Gậy Pool', null, 1);
const caromCat = await ensureCategory('Gậy Carom', null, 2);
const breakCat = await ensureCategory('Gậy Phá/Nhảy', null, 3);
const accCat = await ensureCategory('Phụ kiện', null, 4);

await seedProduct(poolCat, {
  slug: 'predator-aspire-carbon-124', sku: 'PRED-ASP-CARB-01', name: 'Predator Aspire Carbon 12.4', brand: 'Predator', type: 'Pool',
  description: 'Gậy pool carbon cho cảm giác chắc tay, ổn định, phù hợp nâng cấp từ ngọn gỗ.',
  longDescription: 'Mẫu carbon tầm trung cao với độ lệch thấp, phản hồi đều và dễ kiểm soát khi chơi english.',
  price: 22900000, salePrice: 21500000, cost: 18500000, tipSize: '12.4mm', shaftMaterial: '100% Carbon', jointType: 'Uni-loc', wrapType: 'Linen', buttMaterial: 'Maple + Composite', stockTotal: 7, rating: 4.9, reviewCount: 17, soldCount: 58, isFeatured: true
}, [{ code: 'ASP-19-124', weight: '19oz', tipSize: '12.4mm', stock: 3 },{ code: 'ASP-195-124', weight: '19.5oz', tipSize: '12.4mm', stock: 2 },{ code: 'ASP-20-124', weight: '20oz', tipSize: '12.4mm', stock: 2 }], [{ code: 'kamui-clear', name: 'Thay đầu cơ Kamui Clear', price: 650000 }, { code: 'engrave', name: 'Khắc tên lên chuôi', price: 180000 }], [{ url: 'https://images.unsplash.com/photo-1514894786521-74d3f1d9b8aa?auto=format&fit=crop&w=1200&q=80', alt: 'Predator Aspire Carbon', sortOrder: 1 }, { url: 'https://images.unsplash.com/photo-1508098682722-e99c643e7485?auto=format&fit=crop&w=1200&q=80', alt: 'Joint Uni-loc', sortOrder: 2 }]);

await seedProduct(poolCat, {
  slug: 'mezz-ignite-wavy-122', sku: 'MEZZ-IGN-WAVY-02', name: 'Mezz Ignite Wavy 12.2', brand: 'Mezz', type: 'Pool',
  description: 'Cấu hình cao cấp với ngọn Ignite nổi tiếng về độ truyền lực mượt và độ chính xác cao.',
  longDescription: 'Phù hợp người chơi nâng cao cần độ mềm vừa đủ ở đầu ngọn nhưng vẫn giữ được sự ổn định khi đánh xa bi.',
  price: 32500000, salePrice: 29900000, cost: 27800000, tipSize: '12.2mm', shaftMaterial: 'Phủ Carbon', jointType: 'Wavy', wrapType: 'Leather', buttMaterial: 'Maple tuyển chọn', stockTotal: 4, rating: 4.8, reviewCount: 11, soldCount: 41, isFeatured: true
}, [{ code: 'IGN-19-122', weight: '19oz', tipSize: '12.2mm', stock: 1 }, { code: 'IGN-195-122', weight: '19.5oz', tipSize: '12.2mm', stock: 2 }, { code: 'IGN-20-122', weight: '20oz', tipSize: '12.2mm', stock: 1 }], [{ code: 'kamui-clear', name: 'Thay đầu cơ Kamui Clear', price: 650000 }, { code: 'wrap-da', name: 'Đổi tay cầm da premium', price: 1200000 }], [{ url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80', alt: 'Mezz Ignite', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'peri-black-break-jump', sku: 'PERI-BJ-04', name: 'Peri Black Break Jump', brand: 'Peri', type: 'Break/Jump',
  description: 'Gậy phá/nhảy 2 khúc cho lực truyền tốt, ren chắc, phù hợp người cần combo linh hoạt.',
  longDescription: 'Mẫu Peri Black hướng tới người chơi cần lực phá bi mạnh nhưng vẫn dễ kiểm soát khi nhảy ngắn.',
  price: 11600000, salePrice: 10800000, cost: 9200000, tipSize: '13.0mm', shaftMaterial: 'Gỗ ghép', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Maple', stockTotal: 6, rating: 4.6, reviewCount: 9, soldCount: 27, isFeatured: true
}, [{ code: 'PERI-BJ-19', weight: '19oz', tipSize: '13mm', stock: 2 }, { code: 'PERI-BJ-20', weight: '20oz', tipSize: '13mm', stock: 4 }], [{ code: 'tip-break', name: 'Thay tip phá cứng', price: 350000 }], [{ url: 'https://images.unsplash.com/photo-1511884642898-4c92249e20b6?auto=format&fit=crop&w=1200&q=80', alt: 'Peri Break Jump', sortOrder: 1 }]);

const coupon = await query('SELECT id FROM coupons WHERE code = $1', ['BIDA500']);
if (!coupon.rows[0]) await query('INSERT INTO coupons(code, discount_type, value, min_order_amount, usage_limit, active) VALUES ($1,$2,$3,$4,$5,$6)', ['BIDA500', 'fixed', 500000, 5000000, 100, 1]);

await query('DELETE FROM banners');
await query('INSERT INTO banners(title, subtitle, image_url, href, sort_order, active) VALUES ($1,$2,$3,$4,$5,$6)', ['Bộ sưu tập Carbon mới', 'Dòng carbon flagship cho người chơi nâng cấp', 'https://images.unsplash.com/photo-1514894786521-74d3f1d9b8aa?auto=format&fit=crop&w=1600&q=80', 'products.html?type=Pool', 1, 1]);
await query('INSERT INTO banners(title, subtitle, image_url, href, sort_order, active) VALUES ($1,$2,$3,$4,$5,$6)', ['Combo phá nhảy', 'Peri và phụ kiện cho người chơi thi đấu', 'https://images.unsplash.com/photo-1511884642898-4c92249e20b6?auto=format&fit=crop&w=1600&q=80', 'products.html?type=Break/Jump', 2, 1]);

await query('DELETE FROM blog_posts');
await query('INSERT INTO blog_posts(slug, title, excerpt, content, cover_image, active, published_at) VALUES ($1,$2,$3,$4,$5,$6,SYSUTCDATETIME())', ['chon-gay-bida-cho-nguoi-moi', 'Cách chọn gậy bida cho người mới', 'Những yếu tố cần quan tâm khi mua cây đầu tiên.', 'Ưu tiên trọng lượng dễ làm quen, tip size phổ thông và thương hiệu có hậu mãi tốt.', 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80', 1]);
await query('INSERT INTO blog_posts(slug, title, excerpt, content, cover_image, active, published_at) VALUES ($1,$2,$3,$4,$5,$6,SYSUTCDATETIME())', ['bao-quan-ngon-carbon', 'Cách bảo quản ngọn carbon', 'Các bước vệ sinh và giữ bề mặt carbon bền đẹp.', 'Lau sạch sau khi chơi, dùng khăn mềm và tránh va chạm mạnh ở tip.', 'https://images.unsplash.com/photo-1514894786521-74d3f1d9b8aa?auto=format&fit=crop&w=1200&q=80', 1]);

await query('DELETE FROM settings');
await query('INSERT INTO settings(setting_key, setting_value) VALUES ($1,$2)', ['general', JSON.stringify({ siteName: 'Bida Pro Shop', hotline: '0909 123 456', zalo: 'https://zalo.me/0339380482', messenger: 'https://www.facebook.com/share/18Wd2mrmYA/?mibextid=wwXIfr', showroom: '123 Nguyễn Trãi, Q.1, TP.HCM', shipping: { standard: 45000, freeFrom: 5000000 }, bankQr: '', mapEmbed: '', warrantyPolicy: 'Bảo hành cong vênh ngọn và lỗi ren theo chính sách hãng.', returnPolicy: 'Đổi trả theo điều kiện sản phẩm và thời gian quy định.', shippingPolicy: 'Đóng gói bằng ống nhựa cứng chống gãy, có bảo hiểm vận chuyển.' })]);

const customer = await query('SELECT id FROM users WHERE email = $1', ['khach1@example.com']);
if (customer.rows[0]) {
  const pid = await query('SELECT TOP 1 id FROM products ORDER BY id ASC');
  if (pid.rows[0]) {
    await query('DELETE FROM wishlists WHERE user_id = $1', [customer.rows[0].id]);
    await query('INSERT INTO wishlists(user_id, product_id) VALUES ($1,$2)', [customer.rows[0].id, pid.rows[0].id]);
    await query('DELETE FROM addresses WHERE user_id = $1', [customer.rows[0].id]);
    await query('INSERT INTO addresses(user_id, label, recipient_name, phone, line1, district, city, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [customer.rows[0].id, 'Nhà riêng', 'Nguyễn Văn A', '0909000001', '12 Lê Lợi', 'Quận 1', 'TP.HCM', 1]);
  }
}

console.log('SQL Server seed complete');
process.exit(0);
