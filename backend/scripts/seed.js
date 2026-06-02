import { hashPassword } from '../src/lib/auth.js';
import { query } from '../src/lib/db.js';
import { slugify } from '../src/lib/http.js';

async function upsertUser({ email, password, fullName, role, phone = null, points = 0, membershipLevel = 'Standard' }) {
  const passwordHash = await hashPassword(password);
  const exists = await query('SELECT id FROM users WHERE email = $1', [email]);
  const isVerified = role !== 'customer' ? 1 : 0;
  const verificationStatus = role !== 'customer' ? 'verified' : 'pending';
  if (exists.rows[0]) {
    try {
      await query(`UPDATE users SET password_hash = $2, full_name = $3, role = $4, phone = $5, points = $6, membership_level = $7,
        email_verified = $8, email_verified_at = CASE WHEN $8 = 1 THEN COALESCE(email_verified_at, SYSUTCDATETIME()) ELSE email_verified_at END,
        email_verification_status = $9, updated_at = SYSUTCDATETIME() WHERE email = $1`, [email, passwordHash, fullName, role, phone, points, membershipLevel, isVerified, verificationStatus]);
    } catch {
      await query('UPDATE users SET password_hash = $2, full_name = $3, role = $4, phone = $5, points = $6, membership_level = $7, updated_at = SYSUTCDATETIME() WHERE email = $1', [email, passwordHash, fullName, role, phone, points, membershipLevel]);
    }
    return exists.rows[0].id;
  }
  let result;
  try {
    result = await query(`INSERT INTO users(email, password_hash, full_name, role, phone, points, membership_level, email_verified, email_verified_at, email_verification_status)
      OUTPUT INSERTED.id VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8 = 1 THEN SYSUTCDATETIME() ELSE NULL END,$9)`, [email, passwordHash, fullName, role, phone, points, membershipLevel, isVerified, verificationStatus]);
  } catch {
    result = await query('INSERT INTO users(email, password_hash, full_name, role, phone, points, membership_level) OUTPUT INSERTED.id VALUES ($1,$2,$3,$4,$5,$6,$7)', [email, passwordHash, fullName, role, phone, points, membershipLevel]);
  }
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

const productUpload = (file) => `/uploads/products/${file}`;
const bannerUpload = (file) => `/uploads/banners/${file}`;

await seedProduct(poolCat, {
  slug: 'predator-aspire-carbon-124', sku: 'PRED-ASP-CARB-01', name: 'Predator Aspire Carbon 12.4', brand: 'Predator', type: 'Pool',
  description: 'Gậy pool carbon cho cảm giác chắc tay, ổn định, phù hợp nâng cấp từ ngọn gỗ.',
  longDescription: 'Mẫu carbon tầm trung cao với độ lệch thấp, phản hồi đều và dễ kiểm soát khi chơi english.',
  price: 22900000, salePrice: 21500000, cost: 18500000, tipSize: '12.4mm', shaftMaterial: '100% Carbon', jointType: 'Uni-loc', wrapType: 'Linen', buttMaterial: 'Maple + Composite', stockTotal: 7, rating: 4.9, reviewCount: 17, soldCount: 58, isFeatured: true
}, [{ code: 'ASP-19-124', weight: '19oz', tipSize: '12.4mm', stock: 3 },{ code: 'ASP-195-124', weight: '19.5oz', tipSize: '12.4mm', stock: 2 },{ code: 'ASP-20-124', weight: '20oz', tipSize: '12.4mm', stock: 2 }], [{ code: 'kamui-clear', name: 'Thay đầu cơ Kamui Clear', price: 650000 }, { code: 'engrave', name: 'Khắc tên lên chuôi', price: 180000 }], [{ url: productUpload('predur35h-group-1776301697997-mr2uuy.png'), alt: 'Predator Aspire Carbon', sortOrder: 1 }, { url: productUpload('predator-p3-revo-bocote-leather-wrap-radial-8-inch-qr-extender-detail-1776303029042-sphel0.jpg'), alt: 'Chi tiết joint Predator', sortOrder: 2 }]);

await seedProduct(poolCat, {
  slug: 'mezz-ignite-wavy-122', sku: 'MEZZ-IGN-WAVY-02', name: 'Mezz Ignite Wavy 12.2', brand: 'Mezz', type: 'Pool',
  description: 'Cấu hình cao cấp với ngọn Ignite nổi tiếng về độ truyền lực mượt và độ chính xác cao.',
  longDescription: 'Phù hợp người chơi nâng cao cần độ mềm vừa đủ ở đầu ngọn nhưng vẫn giữ được sự ổn định khi đánh xa bi.',
  price: 32500000, salePrice: 29900000, cost: 27800000, tipSize: '12.2mm', shaftMaterial: 'Phủ Carbon', jointType: 'Wavy', wrapType: 'Leather', buttMaterial: 'Maple tuyển chọn', stockTotal: 4, rating: 4.8, reviewCount: 11, soldCount: 41, isFeatured: true
}, [{ code: 'IGN-19-122', weight: '19oz', tipSize: '12.2mm', stock: 1 }, { code: 'IGN-195-122', weight: '19.5oz', tipSize: '12.2mm', stock: 2 }, { code: 'IGN-20-122', weight: '20oz', tipSize: '12.2mm', stock: 1 }], [{ code: 'kamui-clear', name: 'Thay đầu cơ Kamui Clear', price: 650000 }, { code: 'wrap-da', name: 'Đổi tay cầm da premium', price: 1200000 }], [{ url: productUpload('mezz-ignite-shaft-wavy-joint-1634497609-9d02a03a-progressive-1776303306123-tg6ern.jpg'), alt: 'Mezz Ignite', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'peri-black-break-jump', sku: 'PERI-BJ-04', name: 'Peri Black Break Jump', brand: 'Peri', type: 'Break/Jump',
  description: 'Gậy phá/nhảy 2 khúc cho lực truyền tốt, ren chắc, phù hợp người cần combo linh hoạt.',
  longDescription: 'Mẫu Peri Black hướng tới người chơi cần lực phá bi mạnh nhưng vẫn dễ kiểm soát khi nhảy ngắn.',
  price: 11600000, salePrice: 10800000, cost: 9200000, tipSize: '13.0mm', shaftMaterial: 'Gỗ ghép', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Maple', stockTotal: 6, rating: 4.6, reviewCount: 9, soldCount: 27, isFeatured: true
}, [{ code: 'PERI-BJ-19', weight: '19oz', tipSize: '13mm', stock: 2 }, { code: 'PERI-BJ-20', weight: '20oz', tipSize: '13mm', stock: 4 }], [{ code: 'tip-break', name: 'Thay tip phá cứng', price: 350000 }], [{ url: bannerUpload('co-pha-nhay-1776303840426-m5ouap.jpg'), alt: 'Peri Break Jump', sortOrder: 1 }]);

await seedProduct(poolCat, {
  slug: 'predator-p3-revo-bocote-wrapless', sku: 'PRED-P3-REVO-05', name: 'Predator P3 REVO Bocote Wrapless', brand: 'Predator', type: 'Pool',
  description: 'Mẫu P3 REVO Bocote wrapless cho người chơi thích cảm giác truyền lực trực diện và độ lệch thấp.',
  longDescription: 'Thân cơ bocote phối REVO carbon tạo cảm giác cứng chắc, dễ kiểm soát lực và spin khi thi đấu lẫn luyện tập dài buổi.',
  price: 46800000, salePrice: 43900000, cost: 39500000, tipSize: '12.4mm', shaftMaterial: 'REVO Carbon', jointType: 'Uni-loc', wrapType: 'Wrapless', buttMaterial: 'Bocote', stockTotal: 3, rating: 4.9, reviewCount: 8, soldCount: 19, isFeatured: true
}, [{ code: 'P3RW-19', weight: '19oz', tipSize: '12.4mm', stock: 1 }, { code: 'P3RW-195', weight: '19.5oz', tipSize: '12.4mm', stock: 1 }, { code: 'P3RW-20', weight: '20oz', tipSize: '12.4mm', stock: 1 }], [{ code: 'extender-8', name: 'QR Extender 8 inch', price: 1900000 }, { code: 'kamui-ath', name: 'Thay tip Kamui Athlete', price: 780000 }], [{ url: productUpload('predator-p3-revo-bocote-wrapless-uni-loc-1536x864-1776303192413-ujfyg1.jpg'), alt: 'Predator P3 REVO Bocote Wrapless', sortOrder: 1 }]);

await seedProduct(poolCat, {
  slug: 'predator-p3-revo-bocote-leather-wrap', sku: 'PRED-P3-RAD-06', name: 'Predator P3 REVO Bocote Leather Wrap', brand: 'Predator', type: 'Pool',
  description: 'Biến thể tay cầm da của dòng P3 REVO Bocote, bám tay tốt và rất hợp với người chơi cần độ ổn định cao.',
  longDescription: 'Mẫu cơ pool cao cấp với phần tay cầm da, thân bocote và ngọn REVO cho quỹ đạo bi sạch, lực ra đều, phù hợp thi đấu.',
  price: 47900000, salePrice: 44900000, cost: 40600000, tipSize: '12.4mm', shaftMaterial: 'REVO Carbon', jointType: 'Radial', wrapType: 'Leather', buttMaterial: 'Bocote', stockTotal: 2, rating: 4.9, reviewCount: 6, soldCount: 13, isFeatured: false
}, [{ code: 'P3RL-19', weight: '19oz', tipSize: '12.4mm', stock: 1 }, { code: 'P3RL-195', weight: '19.5oz', tipSize: '12.4mm', stock: 1 }], [{ code: 'extender-8', name: 'QR Extender 8 inch', price: 1900000 }], [{ url: productUpload('predator-p3-revo-bocote-leather-wrap-radial-8-inch-qr-extender-detail-1776303029042-sphel0.jpg'), alt: 'Predator P3 REVO Bocote Leather Wrap', sortOrder: 1 }]);

await seedProduct(caromCat, {
  slug: 'adam-carom-classic-c4', sku: 'ADAM-CAROM-07', name: 'Adam Carom Classic C4', brand: 'Adam', type: 'Carom',
  description: 'Cơ carom truyền thống của Adam với độ cân bằng ổn định, dễ làm quen cho người chơi libre và 3 băng.',
  longDescription: 'Adam Carom Classic C4 hướng tới cảm giác đánh đầm tay, thân cơ chắc và phản hồi rõ khi vào ép phê vừa phải.',
  price: 12800000, salePrice: 11900000, cost: 9800000, tipSize: '11.8mm', shaftMaterial: 'Maple tuyển chọn', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Maple', stockTotal: 5, rating: 4.6, reviewCount: 7, soldCount: 21, isFeatured: false
}, [{ code: 'ADAM-C4-185', weight: '18.5oz', tipSize: '11.8mm', stock: 2 }, { code: 'ADAM-C4-19', weight: '19oz', tipSize: '11.8mm', stock: 3 }], [{ code: 'tip-carom-soft', name: 'Thay tip carom mềm', price: 320000 }], [{ url: productUpload('adam-1776302107586-w3xwkc.jpg'), alt: 'Adam Carom Classic C4', sortOrder: 1 }]);

await seedProduct(caromCat, {
  slug: 'buffalo-dominator-iii-carom', sku: 'BUFF-DOM-08', name: 'Buffalo Dominator III Carom', brand: 'Buffalo', type: 'Carom',
  description: 'Dòng cơ carom cân bằng tốt của Buffalo, hợp người chơi cần lực đánh dứt khoát và đầu cơ ổn định.',
  longDescription: 'Buffalo Dominator III được nhiều người chơi carom chọn ở tầm trung nhờ thân cơ cứng vừa phải, truyền lực nhanh và dễ giữ line bi.',
  price: 14600000, salePrice: 13800000, cost: 11200000, tipSize: '11.8mm', shaftMaterial: 'Maple', jointType: 'Quick Release', wrapType: 'Wrapless', buttMaterial: 'Maple', stockTotal: 4, rating: 4.7, reviewCount: 10, soldCount: 25, isFeatured: false
}, [{ code: 'BUF-D3-185', weight: '18.5oz', tipSize: '11.8mm', stock: 2 }, { code: 'BUF-D3-19', weight: '19oz', tipSize: '11.8mm', stock: 2 }], [{ code: 'tip-carom-medium', name: 'Thay tip carom trung bình', price: 360000 }], [{ url: productUpload('buffalo-dominator-iii-naranja-maza-y-flecha-1776302153350-rsj14d.webp'), alt: 'Buffalo Dominator III', sortOrder: 1 }]);

await seedProduct(caromCat, {
  slug: 'mit-black-arrow-4-carom', sku: 'MIT-ARROW4-09', name: 'MIT Black Arrow 4 Carom', brand: 'MIT', type: 'Carom',
  description: 'Cơ carom MIT Black Arrow 4 với thiết kế hiện đại, hợp người chơi thích cảm giác đánh bén và nhả bi rõ.',
  longDescription: 'Black Arrow 4 thiên về tốc độ truyền lực nhanh, độ rung thấp ở thân cơ và khả năng giữ hướng tốt cho 3 băng.',
  price: 16800000, salePrice: 15500000, cost: 12900000, tipSize: '11.9mm', shaftMaterial: 'Maple xử lý chống cong', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Composite + Maple', stockTotal: 3, rating: 4.7, reviewCount: 5, soldCount: 14, isFeatured: false
}, [{ code: 'MIT-BA4-185', weight: '18.5oz', tipSize: '11.9mm', stock: 1 }, { code: 'MIT-BA4-19', weight: '19oz', tipSize: '11.9mm', stock: 2 }], [{ code: 'tip-carom-hard', name: 'Thay tip carom cứng', price: 380000 }], [{ url: productUpload('mit-balck-arrow-4-1776302058940-7vnsnx.webp'), alt: 'MIT Black Arrow 4', sortOrder: 1 }]);

await seedProduct(caromCat, {
  slug: 'dragon-lux-full-carbon-carom', sku: 'DRAGON-LUX-10', name: 'Dragon Lux Full Carbon Carom', brand: 'Dragon', type: 'Carom',
  description: 'Cơ carom full carbon cho cảm giác hiện đại, ít lệch và dễ vệ sinh sau mỗi buổi chơi.',
  longDescription: 'Dragon Lux Full Carbon dành cho người chơi muốn chuyển từ cơ gỗ sang chất liệu carbon để có độ ổn định cao hơn khi đánh đều lực.',
  price: 18900000, salePrice: 17600000, cost: 14800000, tipSize: '11.8mm', shaftMaterial: 'Full Carbon', jointType: 'Uni-loc', wrapType: 'Wrapless', buttMaterial: 'Carbon composite', stockTotal: 4, rating: 4.8, reviewCount: 9, soldCount: 18, isFeatured: true
}, [{ code: 'DRG-LUX-185', weight: '18.5oz', tipSize: '11.8mm', stock: 2 }, { code: 'DRG-LUX-19', weight: '19oz', tipSize: '11.8mm', stock: 2 }], [{ code: 'carbon-care', name: 'Combo vệ sinh ngọn carbon', price: 250000 }], [{ url: productUpload('co-bida-dragon-lux-full-carbon-600x600-1776302288388-4kxfvr.webp'), alt: 'Dragon Lux Full Carbon', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'predator-bk-rush-wrapless', sku: 'PRED-BKR-11', name: 'Predator BK Rush Wrapless', brand: 'Predator', type: 'Break/Jump',
  description: 'Mẫu cơ phá thiên lực của Predator, rất phù hợp cho người muốn tốc độ đầu bi cao và độ ổn định tốt.',
  longDescription: 'BK Rush Wrapless cho cảm giác đánh gọn tay, lực truyền thẳng và đầu cơ cứng để tối ưu các cú phá mạnh.',
  price: 23800000, salePrice: 22600000, cost: 19800000, tipSize: '12.9mm', shaftMaterial: 'Carbon composite', jointType: 'Uni-loc', wrapType: 'Wrapless', buttMaterial: 'Composite', stockTotal: 3, rating: 4.8, reviewCount: 7, soldCount: 22, isFeatured: true
}, [{ code: 'BKR-19', weight: '19oz', tipSize: '12.9mm', stock: 1 }, { code: 'BKR-195', weight: '19.5oz', tipSize: '12.9mm', stock: 2 }], [{ code: 'tip-break-hard', name: 'Thay tip break phenolic', price: 420000 }], [{ url: productUpload('maxresdefault-1776301936827-o0rfur.jpg'), alt: 'Predator BK Rush Wrapless', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'cuetec-breach-break-cue', sku: 'CUETEC-BREACH-12', name: 'Cuetec Breach Break Cue', brand: 'Cuetec', type: 'Break/Jump',
  description: 'Cơ phá Cuetec Breach với độ hoàn thiện cao, lực phá mạnh và âm thanh tiếp xúc rất đanh.',
  longDescription: 'Cuetec Breach là lựa chọn phổ biến với người chơi pool hiện đại cần một cây phá ổn định, bền và ít bảo dưỡng.',
  price: 19800000, salePrice: 18600000, cost: 15900000, tipSize: '13.0mm', shaftMaterial: 'Carbon composite', jointType: '3/8x14', wrapType: 'Sport Grip', buttMaterial: 'Composite', stockTotal: 4, rating: 4.7, reviewCount: 6, soldCount: 17, isFeatured: false
}, [{ code: 'BREACH-19', weight: '19oz', tipSize: '13mm', stock: 2 }, { code: 'BREACH-20', weight: '20oz', tipSize: '13mm', stock: 2 }], [{ code: 'tip-break-hard', name: 'Thay tip break phenolic', price: 420000 }], [{ url: productUpload('bfa512d198aae6460c669c4cdf733735-jpg-720x720q80-1776301923329-pvhfdm.jpg'), alt: 'Cuetec Breach Break Cue', sortOrder: 1 }]);

await seedProduct(accCat, {
  slug: 'mezz-ignite-shaft-wavy-joint', sku: 'MEZZ-SHAFT-13', name: 'Mezz Ignite Shaft Wavy Joint', brand: 'Mezz', type: 'Accessory',
  description: 'Ngọn carbon rời Mezz Ignite cho ren Wavy, lựa chọn nâng cấp phổ biến cho người chơi pool nâng cao.',
  longDescription: 'Ignite Shaft nổi bật ở độ truyền lực mượt, giảm độ lệch và phản hồi đồng đều khi chơi ép phê nhiều.',
  price: 18900000, salePrice: 17600000, cost: 15200000, tipSize: '12.2mm', shaftMaterial: 'Carbon', jointType: 'Wavy', wrapType: null, buttMaterial: null, stockTotal: 5, rating: 4.9, reviewCount: 12, soldCount: 31, isFeatured: true
}, [{ code: 'IGN-SFT-122', weight: 'N/A', tipSize: '12.2mm', stock: 5 }], [{ code: 'tip-replacement', name: 'Lắp tip theo yêu cầu', price: 250000 }], [{ url: productUpload('mezz-ignite-shaft-wavy-joint-1634497609-9d02a03a-progressive-1776303306123-tg6ern.jpg'), alt: 'Mezz Ignite Shaft Wavy Joint', sortOrder: 1 }]);

await seedProduct(accCat, {
  slug: 'cuetec-cynergy-shaft-125-3-8x10', sku: 'CYNERGY-125-14', name: 'Cuetec Cynergy Shaft 12.5 3/8x10', brand: 'Cuetec', type: 'Accessory',
  description: 'Ngọn carbon Cuetec Cynergy 12.5 cho ren 3/8x10, hợp người chơi cần cảm giác carbon dễ thuần.',
  longDescription: 'Cynergy 12.5 nổi tiếng nhờ cảm giác mềm vừa, tiếng chạm bi êm và khả năng giữ line tốt khi đánh tiếng.',
  price: 15200000, salePrice: 14300000, cost: 12100000, tipSize: '12.5mm', shaftMaterial: 'Carbon', jointType: '3/8x10', wrapType: null, buttMaterial: null, stockTotal: 6, rating: 4.8, reviewCount: 9, soldCount: 24, isFeatured: false
}, [{ code: 'CYN-125', weight: 'N/A', tipSize: '12.5mm', stock: 6 }], [{ code: 'tip-replacement', name: 'Lắp tip theo yêu cầu', price: 250000 }], [{ url: productUpload('cuetec-cynergy-12-5-carbon-fiber-shaft-3-8-x-10-1776302344271-fz3sri.jpg'), alt: 'Cuetec Cynergy Shaft 12.5', sortOrder: 1 }]);

await seedProduct(accCat, {
  slug: 'how-standard-tip-medium', sku: 'HOW-TIP-15', name: 'How Standard Tip Medium', brand: 'How', type: 'Accessory',
  description: 'Đầu cơ How Standard độ cứng medium, bám phấn tốt và lên tiếng ổn định.',
  longDescription: 'How Standard Tip là lựa chọn quen thuộc với người chơi pool lẫn carom khi cần một đầu cơ ổn định, dễ kiểm soát và bền.',
  price: 320000, salePrice: 290000, cost: 190000, tipSize: '14mm', shaftMaterial: 'Pig Skin', jointType: null, wrapType: null, buttMaterial: null, stockTotal: 30, rating: 4.8, reviewCount: 26, soldCount: 95, isFeatured: false
}, [{ code: 'HOW-14M', weight: 'N/A', tipSize: '14mm', stock: 30 }], [{ code: 'install-tip', name: 'Công thay đầu cơ', price: 120000 }], [{ url: productUpload('how-standard-tip-dau-co-dau-tay-1536x1536-1776303102935-k2si67.png'), alt: 'How Standard Tip Medium', sortOrder: 1 }]);

await seedProduct(accCat, {
  slug: 'taom-v10-chalk-blue', sku: 'TAOM-V10-16', name: 'Taom V10 Chalk Blue', brand: 'Taom', type: 'Accessory',
  description: 'Phấn lơ Taom V10 bám tip tốt, ít bụi và rất được ưa chuộng trong thi đấu.',
  longDescription: 'Taom V10 giúp người chơi giảm miss-cue, hạn chế bụi trên bàn và giữ đầu cơ sạch hơn so với nhiều loại phấn phổ thông.',
  price: 690000, salePrice: 640000, cost: 470000, tipSize: null, shaftMaterial: null, jointType: null, wrapType: null, buttMaterial: null, stockTotal: 25, rating: 4.9, reviewCount: 31, soldCount: 112, isFeatured: true
}, [{ code: 'TAOM-V10', weight: 'N/A', tipSize: null, stock: 25 }], [], [{ url: productUpload('taom-v10-1776303135825-m7vhdg.jpg'), alt: 'Taom V10 Chalk Blue', sortOrder: 1 }]);

await seedProduct(accCat, {
  slug: 'kamui-glove-black', sku: 'KAMUI-GLOVE-17', name: 'Kamui Glove Black', brand: 'Kamui', type: 'Accessory',
  description: 'Găng tay bida Kamui 3 ngón cho cú ra cơ mượt và ổn định khi chơi lâu.',
  longDescription: 'Bao tay Kamui giúp giảm ma sát tay với cơ, đặc biệt hiệu quả ở môi trường nóng ẩm hoặc khi chơi nhiều tiếng liên tục.',
  price: 420000, salePrice: 390000, cost: 260000, tipSize: null, shaftMaterial: null, jointType: null, wrapType: null, buttMaterial: null, stockTotal: 18, rating: 4.7, reviewCount: 14, soldCount: 53, isFeatured: false
}, [{ code: 'KAMUI-G-M', weight: 'Size M', tipSize: null, stock: 8 }, { code: 'KAMUI-G-L', weight: 'Size L', tipSize: null, stock: 10 }], [], [{ url: productUpload('tay-kamui-1776301590753-vfngzf.jpg'), alt: 'Kamui Glove Black', sortOrder: 1 }]);

await seedProduct(accCat, {
  slug: 'microfiber-carbon-cloth', sku: 'CLOTH-CARBON-18', name: 'Khăn Lau Ngọn Carbon Microfiber', brand: 'Bida Pro', type: 'Accessory',
  description: 'Khăn microfiber chuyên dùng để vệ sinh ngọn carbon và thân cơ sau khi chơi.',
  longDescription: 'Loại khăn mềm, ít xơ vải, giúp lau sạch bụi phấn và mồ hôi mà không làm xước bề mặt carbon.',
  price: 95000, salePrice: 79000, cost: 45000, tipSize: null, shaftMaterial: 'Microfiber', jointType: null, wrapType: null, buttMaterial: null, stockTotal: 40, rating: 4.6, reviewCount: 11, soldCount: 67, isFeatured: false
}, [{ code: 'CLOTH-01', weight: '30x30cm', tipSize: null, stock: 40 }], [], [{ url: productUpload('khan-1776302945564-8ev4bl.webp'), alt: 'Khăn Lau Ngọn Carbon Microfiber', sortOrder: 1 }]);

await seedProduct(accCat, {
  slug: 'multi-tip-tool-pro', sku: 'TIP-TOOL-19', name: 'Dụng Cụ Sửa Đầu Cơ Pro', brand: 'Bida Pro', type: 'Accessory',
  description: 'Bộ dụng cụ sửa đầu cơ đa năng để scuff, shape và vệ sinh tip trong một món.',
  longDescription: 'Phù hợp người chơi mang theo khi thi đấu hoặc luyện tập, giúp duy trì bề mặt tip ổn định và sạch bụi phấn.',
  price: 210000, salePrice: 179000, cost: 110000, tipSize: null, shaftMaterial: 'Alloy', jointType: null, wrapType: null, buttMaterial: null, stockTotal: 22, rating: 4.5, reviewCount: 10, soldCount: 44, isFeatured: false
}, [{ code: 'TIP-TOOL-STD', weight: 'N/A', tipSize: null, stock: 22 }], [], [{ url: productUpload('dung-cu-1776302695864-fa1f9x.jpg'), alt: 'Dụng Cụ Sửa Đầu Cơ Pro', sortOrder: 1 }]);

await seedProduct(accCat, {
  slug: 'bao-co-pbh-bt4-850', sku: 'CASE-PBH-20', name: 'Bao Cơ PBH BT4-850', brand: 'PBH', type: 'Accessory',
  description: 'Bao cơ nhiều ngăn cho 4 chuôi 8 ngọn, phù hợp người chơi di chuyển hoặc mang nhiều cấu hình cơ.',
  longDescription: 'PBH BT4-850 có khoang chứa rộng, form cứng vừa phải, dây đeo êm vai và ngăn phụ kiện lớn cho tip, găng tay, phấn lơ.',
  price: 1580000, salePrice: 1420000, cost: 1130000, tipSize: null, shaftMaterial: null, jointType: null, wrapType: null, buttMaterial: 'Canvas + EVA', stockTotal: 9, rating: 4.7, reviewCount: 8, soldCount: 23, isFeatured: false
}, [{ code: 'PBH-BT4-850', weight: '4x8', tipSize: null, stock: 9 }], [], [{ url: productUpload('pbh-bt4-850-768x-1776303232217-etnahd.webp'), alt: 'Bao Cơ PBH BT4-850', sortOrder: 1 }]);

await seedProduct(poolCat, {
  slug: 'cuetec-avid-chroma-blue', sku: 'CUETEC-AVID-21', name: 'Cuetec Avid Chroma Blue', brand: 'Cuetec', type: 'Pool',
  description: 'Cây pool tầm trung rất dễ chơi với cảm giác cân bằng tốt, hợp người mới nâng cấp lên cấu hình ổn định hơn.',
  longDescription: 'Avid Chroma Blue giữ được độ đằm tay đặc trưng của Cuetec, ra cơ mượt và đủ ổn định để luyện tiếng dài hạn.',
  price: 10800000, salePrice: 9950000, cost: 8200000, tipSize: '12.5mm', shaftMaterial: 'Avid composite', jointType: '3/8x14', wrapType: 'Linen', buttMaterial: 'Maple', stockTotal: 5, rating: 4.6, reviewCount: 9, soldCount: 28, isFeatured: false
}, [{ code: 'AVID-19', weight: '19oz', tipSize: '12.5mm', stock: 2 }, { code: 'AVID-195', weight: '19.5oz', tipSize: '12.5mm', stock: 2 }, { code: 'AVID-20', weight: '20oz', tipSize: '12.5mm', stock: 1 }], [{ code: 'tip-replacement', name: 'Lắp tip theo yêu cầu', price: 250000 }], [{ url: productUpload('vn-11134207-7ras8-m3pcbgca4m9o2e-1776302421778-t33kbw.jpg'), alt: 'Cuetec Avid Chroma Blue', sortOrder: 1 }]);

await seedProduct(poolCat, {
  slug: 'pechauer-jp-series-ebony', sku: 'PECHAUER-JP-22', name: 'Pechauer JP Series Ebony', brand: 'Pechauer', type: 'Pool',
  description: 'Mẫu cơ Pechauer cân bằng đẹp, thân ebony sang tay và hợp người chơi thích phản hồi chắc nhưng không quá cứng.',
  longDescription: 'JP Series Ebony mang phong cách truyền thống Mỹ với độ hoàn thiện cao, lực ra rõ và dễ vào bi giữa bàn.',
  price: 26800000, salePrice: 24900000, cost: 21400000, tipSize: '12.75mm', shaftMaterial: 'Maple Pro Taper', jointType: 'Pechauer Speed', wrapType: 'Leather', buttMaterial: 'Ebony', stockTotal: 3, rating: 4.8, reviewCount: 7, soldCount: 16, isFeatured: false
}, [{ code: 'PECH-JP-19', weight: '19oz', tipSize: '12.75mm', stock: 1 }, { code: 'PECH-JP-195', weight: '19.5oz', tipSize: '12.75mm', stock: 1 }, { code: 'PECH-JP-20', weight: '20oz', tipSize: '12.75mm', stock: 1 }], [{ code: 'engrave', name: 'Khắc tên lên chuôi', price: 180000 }], [{ url: productUpload('oip-1-1776303344288-d33xt9.jpg'), alt: 'Pechauer JP Series Ebony', sortOrder: 1 }]);

await seedProduct(poolCat, {
  slug: 'viking-valhalla-va950', sku: 'VIKING-VAL-23', name: 'Viking Valhalla VA950', brand: 'Viking', type: 'Pool',
  description: 'Dòng cơ pool dễ tiếp cận của Viking, phù hợp người chơi phong trào cần một cây bền, dễ thuần và đẹp mắt.',
  longDescription: 'Valhalla VA950 ưu tiên độ ổn định, thân cơ không quá nặng, tay cầm vừa vặn cho các buổi luyện tập dài.',
  price: 8900000, salePrice: 8150000, cost: 6500000, tipSize: '13mm', shaftMaterial: 'Maple', jointType: 'Quick Release', wrapType: 'Irish Linen', buttMaterial: 'Hard Rock Maple', stockTotal: 6, rating: 4.5, reviewCount: 12, soldCount: 35, isFeatured: false
}, [{ code: 'VAL-19', weight: '19oz', tipSize: '13mm', stock: 2 }, { code: 'VAL-195', weight: '19.5oz', tipSize: '13mm', stock: 2 }, { code: 'VAL-20', weight: '20oz', tipSize: '13mm', stock: 2 }], [{ code: 'kamui-black-soft', name: 'Nâng cấp tip Kamui Black Soft', price: 720000 }], [{ url: productUpload('oip-1776302384156-gsw20k.jpg'), alt: 'Viking Valhalla VA950', sortOrder: 1 }]);

await seedProduct(poolCat, {
  slug: 'fury-carbon-sneaky-pete', sku: 'FURY-CARBON-24', name: 'Fury Carbon Sneaky Pete', brand: 'Fury', type: 'Pool',
  description: 'Sneaky Pete phong cách tối giản nhưng dùng ngọn carbon, hợp người thích cảm giác hiện đại với ngoại hình cổ điển.',
  longDescription: 'Fury Carbon Sneaky Pete cho cú ra cơ thẳng, ít lệch và rất hợp với người chơi pool cần cấu hình carbon ở tầm giá dễ vào.',
  price: 15800000, salePrice: 14600000, cost: 12100000, tipSize: '12.4mm', shaftMaterial: 'Carbon', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Maple', stockTotal: 4, rating: 4.7, reviewCount: 8, soldCount: 20, isFeatured: false
}, [{ code: 'FURY-SP-19', weight: '19oz', tipSize: '12.4mm', stock: 2 }, { code: 'FURY-SP-195', weight: '19.5oz', tipSize: '12.4mm', stock: 1 }, { code: 'FURY-SP-20', weight: '20oz', tipSize: '12.4mm', stock: 1 }], [{ code: 'carbon-care', name: 'Combo vệ sinh ngọn carbon', price: 250000 }], [{ url: productUpload('vn-11134207-7r98o-ltv6vnpipyq517-1776302990996-h13o6s.jpg'), alt: 'Fury Carbon Sneaky Pete', sortOrder: 1 }]);

await seedProduct(caromCat, {
  slug: 'longoni-s2-carom', sku: 'LONGONI-S2-25', name: 'Longoni S2 Carom', brand: 'Longoni', type: 'Carom',
  description: 'Mẫu cơ carom Longoni với cảm giác truyền thống Ý, hợp người chơi 3 băng cần độ phản hồi rõ ở thân cơ.',
  longDescription: 'Longoni S2 cho cảm giác đánh gọn, vào ép phê rõ và giữ line tốt ở những cú cân băng lực vừa đến mạnh.',
  price: 21500000, salePrice: 19900000, cost: 16900000, tipSize: '11.8mm', shaftMaterial: 'Maple tuyển chọn', jointType: 'VP2', wrapType: 'Wrapless', buttMaterial: 'Ebony + Maple', stockTotal: 3, rating: 4.8, reviewCount: 6, soldCount: 15, isFeatured: false
}, [{ code: 'LONG-S2-185', weight: '18.5oz', tipSize: '11.8mm', stock: 1 }, { code: 'LONG-S2-19', weight: '19oz', tipSize: '11.8mm', stock: 2 }], [{ code: 'tip-carom-medium', name: 'Thay tip carom trung bình', price: 360000 }], [{ url: productUpload('adam-1776302107586-w3xwkc.jpg'), alt: 'Longoni S2 Carom', sortOrder: 1 }]);

await seedProduct(caromCat, {
  slug: 'gabriels-imperator-carom', sku: 'GABRIELS-IMP-26', name: 'Gabriels Imperator Carom', brand: 'Gabriels', type: 'Carom',
  description: 'Gabriels Imperator hướng tới người chơi carom nâng cao cần độ ổn định, cân bằng chuẩn và lực ra sạch.',
  longDescription: 'Mẫu cơ này phù hợp người chơi đánh kỹ thuật nhiều băng, yêu cầu thân cơ ít rung và phản hồi đầu cơ rõ ràng.',
  price: 23800000, salePrice: 22100000, cost: 18200000, tipSize: '11.7mm', shaftMaterial: 'Maple', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Exotic Wood', stockTotal: 2, rating: 4.8, reviewCount: 4, soldCount: 11, isFeatured: false
}, [{ code: 'GAB-IMP-185', weight: '18.5oz', tipSize: '11.7mm', stock: 1 }, { code: 'GAB-IMP-19', weight: '19oz', tipSize: '11.7mm', stock: 1 }], [{ code: 'tip-carom-hard', name: 'Thay tip carom cứng', price: 380000 }], [{ url: productUpload('buffalo-dominator-iii-naranja-maza-y-flecha-1776302153350-rsj14d.webp'), alt: 'Gabriels Imperator Carom', sortOrder: 1 }]);

await seedProduct(caromCat, {
  slug: 'molinari-carbon-core-carom', sku: 'MOLINARI-CC-27', name: 'Molinari Carbon Core Carom', brand: 'Molinari', type: 'Carom',
  description: 'Cơ carom lõi carbon cho người chơi thích sự ổn định của công nghệ mới nhưng vẫn giữ cảm giác đánh kiểm soát.',
  longDescription: 'Carbon Core Carom mang lại độ thẳng tốt, giảm rung và hỗ trợ người chơi đều lực hơn trong các tình huống 3 băng khó.',
  price: 19800000, salePrice: 18600000, cost: 15400000, tipSize: '11.8mm', shaftMaterial: 'Carbon Core Maple', jointType: 'Uni-loc', wrapType: 'Wrapless', buttMaterial: 'Composite + Maple', stockTotal: 4, rating: 4.7, reviewCount: 5, soldCount: 13, isFeatured: false
}, [{ code: 'MOL-CC-185', weight: '18.5oz', tipSize: '11.8mm', stock: 2 }, { code: 'MOL-CC-19', weight: '19oz', tipSize: '11.8mm', stock: 2 }], [{ code: 'carbon-care', name: 'Combo vệ sinh ngọn carbon', price: 250000 }], [{ url: productUpload('co-bida-dragon-lux-full-carbon-600x600-1776302288388-4kxfvr.webp'), alt: 'Molinari Carbon Core Carom', sortOrder: 1 }]);

await seedProduct(caromCat, {
  slug: 'ton-kinh-khoi-legend-carom', sku: 'TKK-LEGEND-28', name: 'Tôn Kính Khôi Legend Carom', brand: 'TKK', type: 'Carom',
  description: 'Mẫu cơ carom được ưa chuộng tại thị trường Việt Nam nhờ cảm giác đầm và độ ổn định tốt ở tầm giá dễ tiếp cận.',
  longDescription: 'Legend Carom hợp với người chơi cần một cấu hình thực chiến, dễ làm quen và đủ ổn định để luyện 3 băng dài hạn.',
  price: 14200000, salePrice: 13300000, cost: 10900000, tipSize: '11.8mm', shaftMaterial: 'Maple', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Maple + Composite', stockTotal: 5, rating: 4.6, reviewCount: 7, soldCount: 22, isFeatured: false
}, [{ code: 'TKK-LEG-185', weight: '18.5oz', tipSize: '11.8mm', stock: 2 }, { code: 'TKK-LEG-19', weight: '19oz', tipSize: '11.8mm', stock: 3 }], [{ code: 'tip-carom-soft', name: 'Thay tip carom mềm', price: 320000 }], [{ url: productUpload('mit-balck-arrow-4-1776302058940-7vnsnx.webp'), alt: 'Tôn Kính Khôi Legend Carom', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'mezz-power-break-kai', sku: 'MEZZ-PBK-29', name: 'Mezz Power Break Kai', brand: 'Mezz', type: 'Break/Jump',
  description: 'Cơ phá nổi tiếng của Mezz với độ hoàn thiện rất cao, lực phá đầm và hướng bi đầu ổn định.',
  longDescription: 'Power Break Kai phù hợp người chơi thích cú phá nặng tay, tiếng chạm chắc và cảm giác điều bi đầu tốt hơn sau phá.',
  price: 20500000, salePrice: 19400000, cost: 16600000, tipSize: '12.9mm', shaftMaterial: 'Maple cứng', jointType: 'Deep Impact', wrapType: 'Irish Linen', buttMaterial: 'Maple', stockTotal: 3, rating: 4.8, reviewCount: 6, soldCount: 18, isFeatured: false
}, [{ code: 'PBK-19', weight: '19oz', tipSize: '12.9mm', stock: 1 }, { code: 'PBK-195', weight: '19.5oz', tipSize: '12.9mm', stock: 1 }, { code: 'PBK-20', weight: '20oz', tipSize: '12.9mm', stock: 1 }], [{ code: 'tip-break-hard', name: 'Thay tip break phenolic', price: 420000 }], [{ url: productUpload('bfa512d198aae6460c669c4cdf733735-jpg-720x720q80-1776301875964-2u8ixb.jpg'), alt: 'Mezz Power Break Kai', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'jflowers-break-jump-jf-bj', sku: 'JFLOWERS-BJ-30', name: 'JFlowers Break Jump JF-BJ', brand: 'JFlowers', type: 'Break/Jump',
  description: 'Cây break/jump 2 trong 1 cho người chơi cần một cấu hình đa năng, cứng đầu cơ và dễ thao tác.',
  longDescription: 'JF-BJ cho lực phá tốt ở tầm giá vừa phải, đồng thời đủ linh hoạt để xử lý các cú nhảy ngắn trong trận đấu.',
  price: 12800000, salePrice: 11900000, cost: 9600000, tipSize: '13mm', shaftMaterial: 'Maple ép cứng', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Maple', stockTotal: 5, rating: 4.6, reviewCount: 8, soldCount: 24, isFeatured: false
}, [{ code: 'JFBJ-19', weight: '19oz', tipSize: '13mm', stock: 2 }, { code: 'JFBJ-20', weight: '20oz', tipSize: '13mm', stock: 3 }], [{ code: 'tip-break-hard', name: 'Thay tip break phenolic', price: 420000 }], [{ url: productUpload('ka-p-lo-1776302820559-9ejntz.jpg'), alt: 'JFlowers Break Jump JF-BJ', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'fury-breaker-carbon-pro', sku: 'FURY-BREAK-31', name: 'Fury Breaker Carbon Pro', brand: 'Fury', type: 'Break/Jump',
  description: 'Cơ phá carbon cho người chơi thích cảm giác nhanh, đầu bi đi khỏe và ít rung sau va chạm mạnh.',
  longDescription: 'Breaker Carbon Pro hướng tới các cú phá chủ động, phù hợp người chơi pool muốn chuyển từ cơ gỗ sang cảm giác cứng hiện đại.',
  price: 15200000, salePrice: 14300000, cost: 11700000, tipSize: '12.9mm', shaftMaterial: 'Carbon', jointType: 'Quick Release', wrapType: 'Sport Grip', buttMaterial: 'Composite', stockTotal: 4, rating: 4.5, reviewCount: 5, soldCount: 14, isFeatured: false
}, [{ code: 'FBCP-19', weight: '19oz', tipSize: '12.9mm', stock: 2 }, { code: 'FBCP-20', weight: '20oz', tipSize: '12.9mm', stock: 2 }], [{ code: 'carbon-care', name: 'Combo vệ sinh ngọn carbon', price: 250000 }], [{ url: productUpload('maxresdefault-1776301936827-o0rfur.jpg'), alt: 'Fury Breaker Carbon Pro', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'peri-jump-cue-xj', sku: 'PERI-JUMP-32', name: 'Peri Jump Cue XJ', brand: 'Peri', type: 'Break/Jump',
  description: 'Cơ nhảy chuyên dụng của Peri với trọng lượng gọn và phần đầu tối ưu cho cú jump tầm ngắn đến trung bình.',
  longDescription: 'Jump Cue XJ sinh ra cho người chơi cần một cây nhảy riêng, kiểm soát tốt góc nhảy và độ vọt ở khoảng cách ngắn.',
  price: 7600000, salePrice: 6990000, cost: 5400000, tipSize: '13.5mm', shaftMaterial: 'Maple cứng', jointType: 'Radial', wrapType: 'Wrapless', buttMaterial: 'Maple', stockTotal: 4, rating: 4.5, reviewCount: 6, soldCount: 19, isFeatured: false
}, [{ code: 'PERI-XJ', weight: 'N/A', tipSize: '13.5mm', stock: 4 }], [{ code: 'tip-jump', name: 'Thay tip jump chuyên dụng', price: 310000 }], [{ url: bannerUpload('co-pha-nhay-1776303840426-m5ouap.jpg'), alt: 'Peri Jump Cue XJ', sortOrder: 1 }]);

await seedProduct(breakCat, {
  slug: 'bk-rush-plus-sport-grip', sku: 'PRED-BKR-33', name: 'Predator BK Rush Plus Sport Grip', brand: 'Predator', type: 'Break/Jump',
  description: 'Biến thể sport grip của BK Rush, tăng độ bám tay khi phá mạnh liên tục trong điều kiện nóng ẩm.',
  longDescription: 'BK Rush Plus Sport Grip cho cảm giác kiểm soát tốt hơn ở tay sau, hợp người chơi thi đấu cần cú phá uy lực và lặp lại ổn định.',
  price: 24900000, salePrice: 23600000, cost: 20600000, tipSize: '12.9mm', shaftMaterial: 'Carbon composite', jointType: 'Uni-loc', wrapType: 'Sport Grip', buttMaterial: 'Composite', stockTotal: 2, rating: 4.8, reviewCount: 4, soldCount: 10, isFeatured: false
}, [{ code: 'BKRP-19', weight: '19oz', tipSize: '12.9mm', stock: 1 }, { code: 'BKRP-195', weight: '19.5oz', tipSize: '12.9mm', stock: 1 }], [{ code: 'tip-break-hard', name: 'Thay tip break phenolic', price: 420000 }], [{ url: productUpload('predator-p3-revo-bocote-wrapless-uni-loc-1536x864-1776303192413-ujfyg1.jpg'), alt: 'Predator BK Rush Plus Sport Grip', sortOrder: 1 }]);

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
