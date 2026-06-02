import { connectMongo, mongoose } from '../src/lib/mongo.js';
import {
  Category,
  Product,
  ProductImage,
  ProductService,
  ProductVariant,
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

async function ensureCategory(name, sortOrder) {
  return upsertBy(Category, { slug: slugify(name) }, {
    name,
    slug: slugify(name),
    parent_id: null,
    sort_order: sortOrder
  }, 'categories');
}

async function seedProduct(category, product, variants = [], services = [], imageUrls = []) {
  const row = await upsertBy(Product, { sku: product.sku }, {
    slug: product.slug || slugify(product.name),
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
    stock_total: product.stockTotal || variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0),
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
    await ProductVariant.create({
      id: await nextId('product_variants'),
      product_id: row.id,
      code: variant.code,
      weight: variant.weight || '',
      tip_size: variant.tipSize || product.tipSize || '',
      stock: Number(variant.stock || 0),
      price_delta: Number(variant.priceDelta || 0)
    });
  }
  for (const service of services) {
    await ProductService.create({
      id: await nextId('product_services'),
      product_id: row.id,
      code: service.code,
      name: service.name,
      price: Number(service.price || 0)
    });
  }
  for (const [index, url] of imageUrls.entries()) {
    await ProductImage.create({
      id: await nextId('product_images'),
      product_id: row.id,
      image_url: url,
      alt_text: row.name,
      sort_order: index + 1
    });
  }
  return row;
}

const categories = {
  pool: await ensureCategory('Gậy Pool', 1),
  carom: await ensureCategory('Gậy Carom', 2),
  breakJump: await ensureCategory('Gậy Phá/Nhảy', 3),
  accessories: await ensureCategory('Phụ kiện', 4)
};

const standardCueServices = [
  { code: 'kamui-clear', name: 'Thay đầu cơ Kamui Clear', price: 650000 },
  { code: 'engrave-name', name: 'Khắc tên lên chuôi', price: 180000 },
  { code: 'shaft-clean', name: 'Vệ sinh và phủ bảo vệ ngọn', price: 250000 }
];

const breakCueServices = [
  { code: 'tip-break-hard', name: 'Thay tip break phenolic', price: 420000 },
  { code: 'weight-balance', name: 'Cân chỉnh trọng lượng', price: 220000 }
];

const products = [
  {
    category: 'pool',
    product: {
      sku: 'PRED-P3-REVO-BOCOTE',
      name: 'Predator P3 Revo Bocote Wrapless',
      brand: 'Predator',
      type: 'Pool',
      description: 'Cơ pool cao cấp với ngọn Revo carbon, thân Bocote nổi vân và độ ổn định cao.',
      price: 47500000,
      salePrice: 45900000,
      tipSize: '12.4mm',
      shaftMaterial: 'Revo Carbon',
      jointType: 'Uni-loc',
      wrapType: 'Wrapless',
      buttMaterial: 'Bocote',
      stockTotal: 3,
      rating: 4.9,
      reviewCount: 14,
      soldCount: 19,
      isFeatured: true
    },
    variants: [
      { code: 'P3-184', weight: '18.4oz', stock: 1 },
      { code: 'P3-190', weight: '19oz', stock: 2 }
    ],
    services: standardCueServices,
    images: [
      '/uploads/products/predator-p3-revo-bocote-wrapless-uni-loc-1536x864-1776303192413-ujfyg1.jpg',
      '/uploads/products/predator-p3-revo-bocote-leather-wrap-radial-8-inch-qr-extender-detail-1776303029042-sphel0.jpg'
    ]
  },
  {
    category: 'pool',
    product: {
      sku: 'CUETEC-CYNERGY-125',
      name: 'Cuetec Cynergy 12.5 Carbon Shaft',
      brand: 'Cuetec',
      type: 'Pool',
      description: 'Ngọn carbon Cynergy 12.5mm cho cú đánh mượt, kiểm soát bi cái tốt.',
      price: 13900000,
      salePrice: 13200000,
      tipSize: '12.5mm',
      shaftMaterial: 'Carbon Fiber',
      jointType: '3/8x10',
      stockTotal: 6,
      rating: 4.7,
      reviewCount: 18,
      soldCount: 52,
      isFeatured: true
    },
    variants: [
      { code: 'CYN-38X10', weight: 'Shaft only', stock: 3 },
      { code: 'CYN-UNI', weight: 'Uni-loc', stock: 3 }
    ],
    services: standardCueServices.slice(0, 2),
    images: ['/uploads/products/cuetec-cynergy-12-5-carbon-fiber-shaft-3-8-x-10-1776302344271-fz3sri.jpg']
  },
  {
    category: 'pool',
    product: {
      sku: 'MIT-BLACK-ARROW-4',
      name: 'Mit Black Arrow 4 Pool Cue',
      brand: 'Mit',
      type: 'Pool',
      description: 'Mẫu cơ pool tầm trung, thiết kế đen mạnh mẽ, phù hợp tập luyện và thi đấu phong trào.',
      price: 6800000,
      salePrice: 6200000,
      tipSize: '12.75mm',
      shaftMaterial: 'Maple',
      jointType: 'Radial',
      wrapType: 'Irish Linen',
      buttMaterial: 'Maple',
      stockTotal: 8,
      rating: 4.5,
      reviewCount: 10,
      soldCount: 36,
      isFeatured: false
    },
    variants: [
      { code: 'MBA4-19', weight: '19oz', stock: 4 },
      { code: 'MBA4-195', weight: '19.5oz', stock: 4 }
    ],
    services: standardCueServices,
    images: ['/uploads/products/mit-balck-arrow-4-1776302058940-7vnsnx.webp']
  },
  {
    category: 'pool',
    product: {
      sku: 'ADAM-MUSASHI-AC01',
      name: 'Adam Musashi Classic Pool Cue',
      brand: 'Adam',
      type: 'Pool',
      description: 'Cơ Adam phong cách cổ điển, thân maple chắc tay, dễ kiểm soát lực.',
      price: 9200000,
      salePrice: 8750000,
      tipSize: '12.8mm',
      shaftMaterial: 'Hard Maple',
      jointType: '5/16x14',
      wrapType: 'Leather',
      buttMaterial: 'Maple',
      stockTotal: 5,
      rating: 4.6,
      reviewCount: 8,
      soldCount: 24,
      isFeatured: false
    },
    variants: [
      { code: 'ADM-185', weight: '18.5oz', stock: 2 },
      { code: 'ADM-19', weight: '19oz', stock: 3 }
    ],
    services: standardCueServices,
    images: ['/uploads/products/adam-1776302107586-w3xwkc.jpg']
  },
  {
    category: 'breakJump',
    product: {
      sku: 'BUFF-DOM-III-ORG',
      name: 'Buffalo Dominator III Break Cue Orange',
      brand: 'Buffalo',
      type: 'Break/Jump',
      description: 'Cơ phá Buffalo Dominator III cho lực phá mạnh, đầu cứng và thân cam nổi bật.',
      price: 7600000,
      salePrice: 7200000,
      tipSize: '13mm',
      shaftMaterial: 'Maple',
      jointType: 'Quick Release',
      wrapType: 'Sport Grip',
      buttMaterial: 'Composite',
      stockTotal: 5,
      rating: 4.6,
      reviewCount: 12,
      soldCount: 31,
      isFeatured: true
    },
    variants: [
      { code: 'BUFF-19', weight: '19oz', stock: 2 },
      { code: 'BUFF-20', weight: '20oz', stock: 3 }
    ],
    services: breakCueServices,
    images: ['/uploads/products/buffalo-dominator-iii-naranja-maza-y-flecha-1776302153350-rsj14d.webp']
  },
  {
    category: 'breakJump',
    product: {
      sku: 'PRED-UR35-H',
      name: 'Predator Urbain 3x5 Hard Case',
      brand: 'Predator',
      type: 'Accessory',
      description: 'Bao cơ Predator 3x5 dạng hộp cứng, bảo vệ tốt cho cơ thi đấu.',
      price: 6100000,
      salePrice: 5790000,
      stockTotal: 7,
      rating: 4.7,
      reviewCount: 13,
      soldCount: 27,
      isFeatured: false
    },
    variants: [],
    services: [],
    images: ['/uploads/products/predur35h-group-1776301697997-mr2uuy.png']
  },
  {
    category: 'carom',
    product: {
      sku: 'DRAGON-SAMURAI-CARBON',
      name: 'Dragon Samurai Carbon Carom',
      brand: 'Dragon',
      type: 'Carom',
      description: 'Cơ carom carbon cân bằng, phù hợp người chơi ba băng cần độ ổn định cao.',
      price: 14600000,
      salePrice: 13900000,
      tipSize: '11.8mm',
      shaftMaterial: 'Carbon',
      jointType: 'Wood Joint',
      wrapType: 'Wrapless',
      buttMaterial: 'Ebony',
      stockTotal: 4,
      rating: 4.8,
      reviewCount: 9,
      soldCount: 20,
      isFeatured: true
    },
    variants: [
      { code: 'DSC-185', weight: '18.5oz', stock: 2 },
      { code: 'DSC-19', weight: '19oz', stock: 2 }
    ],
    services: standardCueServices,
    images: ['/uploads/products/co-bida-dragon-lux-full-carbon-600x600-1776302288388-4kxfvr.webp']
  },
  {
    category: 'carom',
    product: {
      sku: 'HANBAT-PLUS-CR01',
      name: 'Hanbat Plus Carom Cue',
      brand: 'Hanbat',
      type: 'Carom',
      description: 'Cơ carom Hanbat Plus với cảm giác đánh đầm, hợp người chơi kiểm soát bi.',
      price: 11800000,
      salePrice: 10900000,
      tipSize: '11.5mm',
      shaftMaterial: 'Maple',
      jointType: 'Wood Joint',
      wrapType: 'Wrapless',
      buttMaterial: 'Maple',
      stockTotal: 5,
      rating: 4.5,
      reviewCount: 7,
      soldCount: 18,
      isFeatured: false
    },
    variants: [
      { code: 'HBP-18', weight: '18oz', stock: 2 },
      { code: 'HBP-185', weight: '18.5oz', stock: 3 }
    ],
    services: standardCueServices.slice(0, 2),
    images: ['/uploads/products/oip-1776302384156-gsw20k.jpg']
  },
  {
    category: 'carom',
    product: {
      sku: 'LONGONI-S20-CRB',
      name: 'Longoni S20 Carbon Carom Shaft',
      brand: 'Longoni',
      type: 'Carom',
      description: 'Ngọn carbon carom Longoni S20 cho cú masse và ép phê ổn định.',
      price: 15400000,
      salePrice: null,
      tipSize: '11.8mm',
      shaftMaterial: 'Carbon',
      jointType: 'Longoni VP2',
      stockTotal: 3,
      rating: 4.8,
      reviewCount: 6,
      soldCount: 15,
      isFeatured: false
    },
    variants: [
      { code: 'S20-VP2', weight: 'Shaft only', stock: 3 }
    ],
    services: standardCueServices.slice(0, 1),
    images: ['/uploads/products/oip-1-1776303344288-d33xt9.jpg']
  },
  {
    category: 'accessories',
    product: {
      sku: 'TAOM-PYRO-GREEN',
      name: 'Taom Pyro Chalk Green',
      brand: 'Taom',
      type: 'Accessory',
      description: 'Lơ Taom Pyro xanh, độ bám cao, ít dính bẩn trên bi và nỉ.',
      price: 590000,
      salePrice: 550000,
      stockTotal: 24,
      rating: 4.7,
      reviewCount: 20,
      soldCount: 76,
      isFeatured: true
    },
    variants: [],
    services: [],
    images: ['/uploads/products/taom-1776302506732-yg293f.jpg']
  },
  {
    category: 'accessories',
    product: {
      sku: 'KAMUI-GLOVE-BLK',
      name: 'Kamui Billiard Glove Black',
      brand: 'Kamui',
      type: 'Accessory',
      description: 'Găng tay Kamui màu đen, vải co giãn, giảm ma sát khi ra cơ.',
      price: 420000,
      salePrice: 390000,
      stockTotal: 30,
      rating: 4.6,
      reviewCount: 17,
      soldCount: 82,
      isFeatured: false
    },
    variants: [
      { code: 'KAM-S', weight: 'Size S', stock: 8 },
      { code: 'KAM-M', weight: 'Size M', stock: 12 },
      { code: 'KAM-L', weight: 'Size L', stock: 10 }
    ],
    services: [],
    images: ['/uploads/products/tay-kamui-1776301590753-vfngzf.jpg']
  },
  {
    category: 'accessories',
    product: {
      sku: 'KAMUI-CLEAR-BLACK-M',
      name: 'Kamui Clear Black Tip Medium',
      brand: 'Kamui',
      type: 'Accessory',
      description: 'Đầu cơ Kamui Clear Black Medium, kiểm soát tốt và độ bền cao.',
      price: 520000,
      salePrice: null,
      stockTotal: 18,
      rating: 4.8,
      reviewCount: 22,
      soldCount: 90,
      isFeatured: true
    },
    variants: [
      { code: 'KCB-M', weight: 'Medium', stock: 10 },
      { code: 'KCB-H', weight: 'Hard', stock: 8 }
    ],
    services: [],
    images: ['/uploads/products/how-standard-tip-dau-co-dau-tay-1536x1536-1776303102935-k2si67.png']
  },
  {
    category: 'accessories',
    product: {
      sku: 'PERI-BH-BT4-CASE',
      name: 'Peri PBH-BT4 Cue Case',
      brand: 'Peri',
      type: 'Accessory',
      description: 'Bao cơ Peri PBH-BT4 gọn nhẹ, đựng cơ và phụ kiện hằng ngày.',
      price: 2450000,
      salePrice: 2190000,
      stockTotal: 9,
      rating: 4.5,
      reviewCount: 8,
      soldCount: 25,
      isFeatured: false
    },
    variants: [],
    services: [],
    images: ['/uploads/products/pbh-bt4-850-768x-1776303232217-etnahd.webp']
  },
  {
    category: 'accessories',
    product: {
      sku: 'CUE-TOOL-KIT-01',
      name: 'Billiard Cue Maintenance Tool Kit',
      brand: 'Bida Pro',
      type: 'Accessory',
      description: 'Bộ dụng cụ bảo dưỡng cơ gồm shaper, burnisher, khăn lau và hộp đựng.',
      price: 890000,
      salePrice: 790000,
      stockTotal: 16,
      rating: 4.4,
      reviewCount: 11,
      soldCount: 47,
      isFeatured: false
    },
    variants: [],
    services: [],
    images: [
      '/uploads/products/dung-cu-1776302695864-fa1f9x.jpg',
      '/uploads/products/ka-p-lo-1776302820559-9ejntz.jpg'
    ]
  },
  {
    category: 'accessories',
    product: {
      sku: 'MICROFIBER-CLOTH-BP',
      name: 'Microfiber Cue Cleaning Cloth',
      brand: 'Bida Pro',
      type: 'Accessory',
      description: 'Khăn microfiber lau cơ và ngọn carbon, mềm, sạch bụi và dễ giặt.',
      price: 120000,
      salePrice: 99000,
      stockTotal: 50,
      rating: 4.3,
      reviewCount: 13,
      soldCount: 120,
      isFeatured: false
    },
    variants: [
      { code: 'CLOTH-GRAY', weight: 'Xám', stock: 25 },
      { code: 'CLOTH-BLACK', weight: 'Đen', stock: 25 }
    ],
    services: [],
    images: ['/uploads/products/khan-1776302945564-8ev4bl.webp']
  },
  {
    category: 'accessories',
    product: {
      sku: 'CUE-EXTENSION-UNI',
      name: 'Universal Cue Extension 8 Inch',
      brand: 'Bida Pro',
      type: 'Accessory',
      description: 'Extension 8 inch lắp nhanh, hỗ trợ các cú đánh xa và bi khó.',
      price: 1350000,
      salePrice: 1250000,
      stockTotal: 11,
      rating: 4.5,
      reviewCount: 9,
      soldCount: 29,
      isFeatured: false
    },
    variants: [],
    services: [],
    images: ['/uploads/products/vn-11134207-7r98o-ltv6vnpipyq517-1776302990996-h13o6s.jpg']
  }
];

let createdOrUpdated = 0;
for (const entry of products) {
  await seedProduct(categories[entry.category], entry.product, entry.variants, entry.services, entry.images);
  createdOrUpdated += 1;
}

console.log(`Seeded ${createdOrUpdated} extra products.`);
await mongoose.disconnect();
