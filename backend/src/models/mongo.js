import { mongoose } from '../lib/mongo.js';

const { Schema, model, models } = mongoose;

function timestamps() {
  return {
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
  };
}

function numericIdSchema(definition) {
  return new Schema({
    id: { type: Number, unique: true, index: true },
    ...definition
  }, { versionKey: false });
}

const CounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { versionKey: false });

export const Counter = models.Counter || model('Counter', CounterSchema, 'counters');

export async function nextId(name, session = null) {
  const row = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true, session }
  ).lean();
  return row.seq;
}

export const User = models.User || model('User', numericIdSchema({
  email: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  full_name: { type: String, required: true },
  phone: { type: String, default: '' },
  role: { type: String, default: 'customer', index: true },
  points: { type: Number, default: 0 },
  membership_level: { type: String, default: 'Member' },
  customer_tag: { type: String, default: 'new', index: true },
  email_verified: { type: Number, default: 0 },
  email_verified_at: { type: Date, default: null },
  email_verification_status: { type: String, default: 'pending' },
  email_otp_hash: { type: String, default: null },
  email_otp_expires_at: { type: Date, default: null },
  email_otp_last_sent_at: { type: Date, default: null },
  email_otp_attempt_count: { type: Number, default: 0 },
  verification_token: { type: String, default: null },
  is_active: { type: Number, default: 1 },
  ...timestamps()
}), 'users');

export const Category = models.Category || model('Category', numericIdSchema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  parent_id: { type: Number, default: null },
  sort_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
}), 'categories');

export const Product = models.Product || model('Product', numericIdSchema({
  slug: { type: String, required: true, unique: true, index: true },
  sku: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, index: true },
  brand: { type: String, default: '', index: true },
  type: { type: String, default: '', index: true },
  category_id: { type: Number, default: null, index: true },
  description: { type: String, default: '' },
  long_description: { type: String, default: '' },
  price: { type: Number, default: 0 },
  sale_price: { type: Number, default: null },
  cost: { type: Number, default: null },
  tip_size: { type: String, default: '' },
  shaft_material: { type: String, default: '' },
  joint_type: { type: String, default: '' },
  wrap_type: { type: String, default: '' },
  butt_material: { type: String, default: '' },
  stock_total: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  review_count: { type: Number, default: 0 },
  sold_count: { type: Number, default: 0 },
  is_featured: { type: Number, default: 0 },
  is_active: { type: Number, default: 1 },
  metadata: { type: Schema.Types.Mixed, default: {} },
  ...timestamps()
}), 'products');

export const ProductVariant = models.ProductVariant || model('ProductVariant', numericIdSchema({
  product_id: { type: Number, required: true, index: true },
  code: { type: String, default: '' },
  weight: { type: String, default: '' },
  tip_size: { type: String, default: '' },
  stock: { type: Number, default: 0 },
  price_delta: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
}), 'product_variants');

export const ProductService = models.ProductService || model('ProductService', numericIdSchema({
  product_id: { type: Number, required: true, index: true },
  code: { type: String, default: '' },
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
}), 'product_services');

export const ProductImage = models.ProductImage || model('ProductImage', numericIdSchema({
  product_id: { type: Number, required: true, index: true },
  image_url: { type: String, required: true },
  alt_text: { type: String, default: '' },
  sort_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
}), 'product_images');

export const Coupon = models.Coupon || model('Coupon', numericIdSchema({
  code: { type: String, required: true, unique: true, index: true },
  discount_type: { type: String, required: true },
  value: { type: Number, default: 0 },
  min_order_amount: { type: Number, default: 0 },
  usage_limit: { type: Number, default: null },
  used_count: { type: Number, default: 0 },
  active: { type: Number, default: 1 },
  starts_at: { type: Date, default: null },
  ends_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now }
}), 'coupons');

export const Setting = models.Setting || model('Setting', numericIdSchema({
  setting_key: { type: String, required: true, unique: true, index: true },
  setting_value: { type: Schema.Types.Mixed, default: {} },
  updated_at: { type: Date, default: Date.now }
}), 'settings');

export const Banner = models.Banner || model('Banner', numericIdSchema({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  image_url: { type: String, default: '' },
  href: { type: String, default: '' },
  sort_order: { type: Number, default: 0 },
  active: { type: Number, default: 1 },
  created_at: { type: Date, default: Date.now }
}), 'banners');

export const BlogPost = models.BlogPost || model('BlogPost', numericIdSchema({
  slug: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  excerpt: { type: String, default: '' },
  content: { type: String, default: '' },
  cover_image: { type: String, default: '' },
  active: { type: Number, default: 1 },
  published_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now }
}), 'blog_posts');

export const Address = models.Address || model('Address', numericIdSchema({
  user_id: { type: Number, required: true, index: true },
  label: { type: String, default: '' },
  recipient_name: { type: String, default: '' },
  phone: { type: String, default: '' },
  line1: { type: String, required: true },
  ward: { type: String, default: '' },
  district: { type: String, default: '' },
  city: { type: String, default: '' },
  is_default: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
}), 'addresses');

export const Wishlist = models.Wishlist || model('Wishlist', numericIdSchema({
  user_id: { type: Number, required: true, index: true },
  product_id: { type: Number, required: true, index: true },
  created_at: { type: Date, default: Date.now }
}), 'wishlists');

export const Cart = models.Cart || model('Cart', numericIdSchema({
  user_id: { type: Number, default: null, index: true },
  guest_token: { type: String, default: null, index: true },
  status: { type: String, default: 'active', index: true },
  ...timestamps()
}), 'carts');

export const CartItem = models.CartItem || model('CartItem', numericIdSchema({
  cart_id: { type: Number, required: true, index: true },
  product_id: { type: Number, required: true, index: true },
  variant_id: { type: Number, default: null },
  quantity: { type: Number, default: 1 },
  selected_services: { type: [String], default: [] },
  unit_price: { type: Number, default: 0 },
  is_selected: { type: Number, default: 1 },
  ...timestamps()
}), 'cart_items');

export const Order = models.Order || model('Order', numericIdSchema({
  order_code: { type: String, required: true, unique: true, index: true },
  user_id: { type: Number, default: null, index: true },
  customer_name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  payment_method: { type: String, required: true },
  payment_status: { type: String, default: 'pending', index: true },
  order_status: { type: String, default: 'new', index: true },
  payment_provider: { type: String, default: '' },
  payment_ref: { type: String, default: '' },
  payment_requested_at: { type: Date, default: null },
  subtotal: { type: Number, default: 0 },
  discount_total: { type: Number, default: 0 },
  shipping_total: { type: Number, default: 0 },
  grand_total: { type: Number, default: 0 },
  shipping_address: { type: Schema.Types.Mixed, default: {} },
  note: { type: String, default: '' },
  coupon_code: { type: String, default: '' },
  guest_checkout: { type: Number, default: 1 },
  shipping_provider: { type: String, default: '' },
  tracking_code: { type: String, default: '' },
  rewarded_points: { type: Number, default: 0 },
  ...timestamps()
}), 'orders');

export const OrderItem = models.OrderItem || model('OrderItem', numericIdSchema({
  order_id: { type: Number, required: true, index: true },
  product_id: { type: Number, required: true, index: true },
  variant_id: { type: Number, default: null },
  product_name: { type: String, required: true },
  sku: { type: String, default: '' },
  quantity: { type: Number, required: true },
  unit_price: { type: Number, default: 0 },
  line_total: { type: Number, default: 0 },
  selected_services: { type: [Schema.Types.Mixed], default: [] },
  created_at: { type: Date, default: Date.now }
}), 'order_items');

export const PaymentTransaction = models.PaymentTransaction || model('PaymentTransaction', numericIdSchema({
  order_id: { type: Number, required: true, index: true },
  provider: { type: String, required: true, index: true },
  request_id: { type: String, default: '' },
  provider_ref: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  status: { type: String, default: 'pending' },
  raw_payload: { type: Schema.Types.Mixed, default: {} },
  ...timestamps()
}), 'payment_transactions');

export const ProductReview = models.ProductReview || model('ProductReview', numericIdSchema({
  user_id: { type: Number, required: true, index: true },
  product_id: { type: Number, required: true, index: true },
  order_item_id: { type: Number, default: null, index: true },
  rating: { type: Number, required: true },
  comment: { type: String, default: '' },
  is_visible: { type: Number, default: 1 },
  ...timestamps()
}), 'product_reviews');

export const Notification = models.Notification || model('Notification', numericIdSchema({
  user_id: { type: Number, default: null, index: true },
  coupon_id: { type: Number, default: null, index: true },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  sent_at: { type: Date, default: Date.now },
  is_read: { type: Number, default: 0 }
}), 'notifications');

export const InventoryReceipt = models.InventoryReceipt || model('InventoryReceipt', numericIdSchema({
  product_id: { type: Number, required: true, index: true },
  variant_id: { type: Number, default: null },
  quantity: { type: Number, default: 0 },
  note: { type: String, default: '' },
  created_by: { type: Number, default: null },
  created_at: { type: Date, default: Date.now }
}), 'inventory_receipts');

export const collections = {
  users: User,
  categories: Category,
  products: Product,
  product_variants: ProductVariant,
  product_services: ProductService,
  product_images: ProductImage,
  coupons: Coupon,
  settings: Setting,
  banners: Banner,
  blog_posts: BlogPost,
  addresses: Address,
  wishlists: Wishlist,
  carts: Cart,
  cart_items: CartItem,
  orders: Order,
  order_items: OrderItem,
  payment_transactions: PaymentTransaction,
  product_reviews: ProductReview,
  notifications: Notification,
  inventory_receipts: InventoryReceipt
};
