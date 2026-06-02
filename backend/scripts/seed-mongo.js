import { hashPassword } from '../src/lib/auth.js';
import { connectMongo, mongoose } from '../src/lib/mongo.js';
import {
  Address,
  Banner,
  BlogPost,
  Category,
  Coupon,
  Product,
  ProductImage,
  ProductService,
  ProductVariant,
  Setting,
  User,
  Wishlist,
  nextId
} from '../src/models/mongo.js';
import { slugify } from '../src/lib/http.js';

await connectMongo();

async function upsertBy(Model, filter, payload, counterName) {
  const existing = await Model.findOne(filter);
  if (existing) {
    Object.assign(existing, payload, { updated_at: new Date() });
    await existing.save();
    return existing;
  }
  return Model.create({ id: await nextId(counterName), ...payload });
}

async function upsertUser({ email, password, fullName, role, phone = '', points = 0, membershipLevel = 'Member' }) {
  const verified = role !== 'customer' ? 1 : 1;
  return upsertBy(User, { email }, {
    email,
    password_hash: await hashPassword(password),
    full_name: fullName,
    role,
    phone,
    points,
    membership_level: membershipLevel,
    customer_tag: role === 'customer' ? 'new' : 'vip',
    email_verified: verified,
    email_verified_at: verified ? new Date() : null,
    email_verification_status: verified ? 'verified' : 'pending',
    is_active: 1
  }, 'users');
}

async function ensureCategory(name, sortOrder) {
  return upsertBy(Category, { slug: slugify(name) }, {
    name,
    slug: slugify(name),
    parent_id: null,
    sort_order: sortOrder
  }, 'categories');
}

async function seedProduct(category, product, variants = [], services = [], images = []) {
  const row = await upsertBy(Product, { sku: product.sku }, {
    slug: product.slug,
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    type: product.type,
    category_id: category.id,
    description: product.description,
    long_description: product.longDescription || product.description,
    price: product.price,
    sale_price: product.salePrice ?? null,
    cost: product.cost ?? null,
    tip_size: product.tipSize || '',
    shaft_material: product.shaftMaterial || '',
    joint_type: product.jointType || '',
    wrap_type: product.wrapType || '',
    butt_material: product.buttMaterial || '',
    stock_total: product.stockTotal || 0,
    rating: product.rating || 0,
    review_count: product.reviewCount || 0,
    sold_count: product.soldCount || 0,
    is_featured: product.isFeatured ? 1 : 0,
    is_active: 1,
    metadata: product.metadata || {}
  }, 'products');
  await ProductVariant.deleteMany({ product_id: row.id });
  await ProductService.deleteMany({ product_id: row.id });
  await ProductImage.deleteMany({ product_id: row.id });
  for (const variant of variants) {
    await ProductVariant.create({ id: await nextId('product_variants'), product_id: row.id, code: variant.code, weight: variant.weight, tip_size: variant.tipSize, stock: variant.stock, price_delta: variant.priceDelta || 0 });
  }
  for (const service of services) {
    await ProductService.create({ id: await nextId('product_services'), product_id: row.id, code: service.code, name: service.name, price: service.price });
  }
  for (const image of images) {
    await ProductImage.create({ id: await nextId('product_images'), product_id: row.id, image_url: image.url, alt_text: image.alt || row.name, sort_order: image.sortOrder || 0 });
  }
  return row;
}

const admin = await upsertUser({ email: 'admin@bidaproshop.vn', password: 'admin123', fullName: 'Admin Bida', role: 'admin', membershipLevel: 'VIP' });
await upsertUser({ email: 'manager@bidaproshop.vn', password: 'manager123', fullName: 'Quản lý cửa hàng', role: 'manager', membershipLevel: 'VIP' });
await upsertUser({ email: 'kho@bidaproshop.vn', password: 'kho123', fullName: 'Nhân viên kho', role: 'warehouse' });
await upsertUser({ email: 'cskh@bidaproshop.vn', password: 'cskh123', fullName: 'Nhân viên CSKH', role: 'cskh' });
const customer = await upsertUser({ email: 'khach1@example.com', password: 'Customer@123', fullName: 'Nguyễn Văn A', role: 'customer', phone: '0909000001', points: 1200, membershipLevel: 'VIP' });

const pool = await ensureCategory('Gậy Pool', 1);
const carom = await ensureCategory('Gậy Carom', 2);
const breakCue = await ensureCategory('Gậy Phá/Nhảy', 3);
const accessories = await ensureCategory('Phụ kiện', 4);

const p1 = await seedProduct(pool, {
  slug: 'predator-bk-rush-wrapless',
  sku: 'PRED-BKR-11',
  name: 'Predator BK Rush Wrapless',
  brand: 'Predator',
  type: 'Pool',
  description: 'Mẫu cơ hiệu năng cao cho người chơi muốn lực ra ổn định.',
  price: 23800000,
  salePrice: 22600000,
  tipSize: '12.9mm',
  shaftMaterial: 'Carbon composite',
  jointType: 'Uni-loc',
  wrapType: 'Wrapless',
  buttMaterial: 'Composite',
  stockTotal: 3,
  rating: 4.8,
  reviewCount: 7,
  soldCount: 22,
  isFeatured: true
}, [{ code: 'BKR-19', weight: '19oz', tipSize: '12.9mm', stock: 1 }, { code: 'BKR-195', weight: '19.5oz', tipSize: '12.9mm', stock: 2 }], [{ code: 'tip-break-hard', name: 'Thay tip break phenolic', price: 420000 }], [{ url: '/uploads/products/maxresdefault-1776301936827-o0rfur.jpg', sortOrder: 1 }]);

await seedProduct(pool, {
  slug: 'mezz-ignite-wavy-122',
  sku: 'MEZZ-IGN-WAVY-02',
  name: 'Mezz Ignite Shaft Wavy Joint',
  brand: 'Mezz',
  type: 'Pool',
  description: 'Ngọn Ignite nổi tiếng về độ truyền lực mượt và độ chính xác cao.',
  price: 17600000,
  salePrice: null,
  tipSize: '12.2mm',
  shaftMaterial: 'Phủ Carbon',
  jointType: 'Wavy',
  wrapType: 'Leather',
  buttMaterial: 'Maple tuyển chọn',
  stockTotal: 4,
  rating: 4.8,
  reviewCount: 11,
  soldCount: 41,
  isFeatured: true
}, [{ code: 'IGN-19-122', weight: '19oz', tipSize: '12.2mm', stock: 2 }], [{ code: 'kamui-clear', name: 'Thay đầu cơ Kamui Clear', price: 650000 }], [{ url: '/uploads/products/mezz-ignite-shaft-wavy-joint-1634497609-9d02a03a-progressive-1776303306123-tg6ern.jpg', sortOrder: 1 }]);

await seedProduct(accessories, {
  slug: 'taom-v10-chalk-blue',
  sku: 'TAOM-V10-BLUE',
  name: 'Taom V10 Chalk Blue',
  brand: 'Taom',
  type: 'Accessory',
  description: 'Lơ cao cấp bám tốt, ít bẩn bi.',
  price: 640000,
  stockTotal: 20,
  rating: 4.7,
  reviewCount: 9,
  soldCount: 33,
  isFeatured: true
}, [], [], [{ url: '/uploads/products/taom-v10-1776303135825-m7vhdg.jpg', sortOrder: 1 }]);

await seedProduct(carom, {
  slug: 'dragon-lux-full-carbon-carom',
  sku: 'DRAGON-LUX-10',
  name: 'Dragon Lux Full Carbon Carom',
  brand: 'Dragon',
  type: 'Carom',
  description: 'Cơ carom full carbon cho cảm giác hiện đại và ổn định.',
  price: 18900000,
  salePrice: 17600000,
  tipSize: '11.8mm',
  shaftMaterial: 'Full Carbon',
  jointType: 'Uni-loc',
  stockTotal: 4,
  rating: 4.8,
  reviewCount: 9,
  soldCount: 18,
  isFeatured: true
}, [{ code: 'DRG-LUX-185', weight: '18.5oz', tipSize: '11.8mm', stock: 2 }], [{ code: 'carbon-care', name: 'Combo vệ sinh ngọn carbon', price: 250000 }], [{ url: '/uploads/products/co-bida-dragon-lux-full-carbon-600x600-1776302288388-4kxfvr.webp', sortOrder: 1 }]);

await upsertBy(Coupon, { code: 'BIDA500' }, { code: 'BIDA500', discount_type: 'fixed', value: 500000, min_order_amount: 5000000, usage_limit: 100, used_count: 0, active: 1 }, 'coupons');

await Banner.deleteMany({});
await Banner.create([
  { id: await nextId('banners'), title: 'Bộ sưu tập Carbon mới', subtitle: 'Dòng carbon cho người chơi nâng cấp', image_url: 'https://images.unsplash.com/photo-1514894786521-74d3f1d9b8aa?auto=format&fit=crop&w=1600&q=80', href: 'products.html?type=Pool', sort_order: 1, active: 1 },
  { id: await nextId('banners'), title: 'Combo phá nhảy', subtitle: 'Cơ phá và phụ kiện thi đấu', image_url: 'https://images.unsplash.com/photo-1511884642898-4c92249e20b6?auto=format&fit=crop&w=1600&q=80', href: 'products.html?type=Break/Jump', sort_order: 2, active: 1 }
]);

await BlogPost.deleteMany({});
await BlogPost.create([
  { id: await nextId('blog_posts'), slug: 'chon-gay-bida-cho-nguoi-moi', title: 'Cách chọn gậy bida cho người mới', excerpt: 'Những yếu tố cần quan tâm khi mua cây đầu tiên.', content: 'Ưu tiên trọng lượng dễ làm quen, tip size phổ thông và thương hiệu có hậu mãi tốt.', cover_image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80', active: 1, published_at: new Date() }
]);

await upsertBy(Setting, { setting_key: 'general' }, {
  setting_key: 'general',
  setting_value: {
    siteName: 'Bida Pro Shop',
    hotline: '0909 123 456',
    zalo: 'https://zalo.me/0339380482',
    messenger: 'https://www.facebook.com/share/18Wd2mrmYA/?mibextid=wwXIfr',
    showroom: '123 Nguyễn Trãi, Q.1, TP.HCM',
    shipping: { standard: 45000, freeFrom: 5000000 },
    warrantyPolicy: 'Bảo hành cong vênh ngọn và lỗi ren theo chính sách hãng.',
    returnPolicy: 'Đổi trả theo điều kiện sản phẩm và thời gian quy định.',
    shippingPolicy: 'Đóng gói bằng ống nhựa cứng chống gãy, có bảo hiểm vận chuyển.'
  }
}, 'settings');

await Wishlist.deleteMany({ user_id: customer.id });
await Wishlist.create({ id: await nextId('wishlists'), user_id: customer.id, product_id: p1.id });
await Address.deleteMany({ user_id: customer.id });
await Address.create({ id: await nextId('addresses'), user_id: customer.id, label: 'Nhà riêng', recipient_name: 'Nguyễn Văn A', phone: '0909000001', line1: '12 Lê Lợi', ward: 'Phường Sài Gòn', city: 'TP.HCM', is_default: 1 });

console.log(`MongoDB seed complete. Admin user id: ${admin.id}`);
await mongoose.disconnect();
