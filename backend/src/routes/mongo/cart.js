import crypto from 'node:crypto';
import { Router } from 'express';
import { fail, ok } from '../../lib/http.js';
import { verifyToken } from '../../lib/auth.js';
import { connectMongo } from '../../lib/mongo.js';
import { Cart, CartItem, Product, ProductImage, ProductService, ProductVariant, User, nextId } from '../../models/mongo.js';

export const mongoCartRouter = Router();

function guestToken() {
  return crypto.randomBytes(24).toString('hex');
}
function parseServiceCodes(value) {
  if (Array.isArray(value)) return value.map(String);
  try { return JSON.parse(value || '[]').map(String); } catch { return []; }
}
async function currentCart(req, session = null) {
  const userId = req.user?.id || null;
  const token = req.headers['x-guest-token'] || req.body?.guestToken || guestToken();
  const filter = userId ? { user_id: userId, status: 'active' } : { guest_token: token, status: 'active' };
  let cart = await Cart.findOne(filter).session(session);
  if (!cart) {
    cart = await Cart.create([{ id: await nextId('carts', session), user_id: userId, guest_token: userId ? null : token, status: 'active' }], { session });
    cart = cart[0];
  }
  if (userId && token) {
    const guest = await Cart.findOne({ guest_token: token, status: 'active' }).session(session);
    if (guest && guest.id !== cart.id) {
      await CartItem.updateMany({ cart_id: guest.id }, { $set: { cart_id: cart.id } }).session(session);
      guest.status = 'merged';
      await guest.save({ session });
    }
  }
  return { cart, guestToken: userId ? '' : token };
}
async function priceForItem(productId, variantId, serviceCodes) {
  const product = await Product.findOne({ id: Number(productId), is_active: 1 }).lean();
  if (!product) throw new Error('Sản phẩm không tồn tại hoặc đang ẩn');
  const variant = variantId ? await ProductVariant.findOne({ id: Number(variantId), product_id: product.id }).lean() : null;
  if (variantId && !variant) throw new Error('Biến thể không hợp lệ');
  const services = await ProductService.find({ product_id: product.id }).lean();
  const selected = services.filter((service) => serviceCodes.includes(service.code));
  const unitPrice = Number(product.sale_price || product.price || 0) + Number(variant?.price_delta || 0) + selected.reduce((sum, s) => sum + Number(s.price || 0), 0);
  return { product, variant, selected, unitPrice };
}
async function serializeCart(cart, guestToken = '') {
  const items = await CartItem.find({ cart_id: cart.id }).sort({ created_at: 1, id: 1 }).lean();
  const productIds = [...new Set(items.map((item) => item.product_id))];
  const variantIds = [...new Set(items.map((item) => item.variant_id).filter(Boolean))];
  const [products, variants, images, services] = await Promise.all([
    Product.find({ id: { $in: productIds } }).lean(),
    ProductVariant.find({ id: { $in: variantIds } }).lean(),
    ProductImage.find({ product_id: { $in: productIds } }).sort({ sort_order: 1, id: 1 }).lean(),
    ProductService.find({ product_id: { $in: productIds } }).lean()
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const imageMap = new Map();
  images.forEach((img) => { if (!imageMap.has(img.product_id)) imageMap.set(img.product_id, img.image_url); });
  const lines = items.map((item) => {
    const product = productMap.get(item.product_id) || {};
    const selectedCodes = parseServiceCodes(item.selected_services);
    const selectedServices = services.filter((service) => service.product_id === item.product_id && selectedCodes.includes(service.code));
    const lineTotal = Number(item.unit_price || 0) * Number(item.quantity || 0);
    return {
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal,
      isSelected: Boolean(item.is_selected),
      product: {
        id: product.id,
        slug: product.slug,
        name: product.name,
        sku: product.sku,
        coverImage: imageMap.get(product.id) || ''
      },
      variant: item.variant_id ? variantMap.get(item.variant_id) || null : null,
      services: selectedServices
    };
  });
  const selected = lines.filter((line) => line.isSelected);
  return {
    id: cart.id,
    guestToken,
    items: lines,
    summary: {
      totalQuantity: lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      selectedQuantity: selected.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      subtotal: selected.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0)
    }
  };
}

mongoCartRouter.use(async (_req, _res, next) => {
  await connectMongo();
  next();
});

mongoCartRouter.use(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    req.user = await User.findOne({ id: Number(payload.sub), is_active: 1 }).lean();
  } catch {
    req.user = null;
  }
  return next();
});

mongoCartRouter.get('/', async (req, res) => {
  const { cart, guestToken: token } = await currentCart(req);
  return ok(res, await serializeCart(cart, token));
});

mongoCartRouter.post('/items', async (req, res) => {
  try {
    const { cart, guestToken: token } = await currentCart(req);
    const selectedServices = parseServiceCodes(req.body?.selectedServices || []);
    const quantity = Math.max(1, Number(req.body?.quantity || 1));
    const variantId = req.body?.variantId ? Number(req.body.variantId) : null;
    const { unitPrice } = await priceForItem(Number(req.body?.productId), variantId, selectedServices);
    const existing = await CartItem.findOne({
      cart_id: cart.id,
      product_id: Number(req.body.productId),
      variant_id: variantId,
      selected_services: selectedServices
    });
    if (existing) {
      existing.quantity += quantity;
      existing.unit_price = unitPrice;
      existing.is_selected = 1;
      existing.updated_at = new Date();
      await existing.save();
    } else {
      await CartItem.create({
        id: await nextId('cart_items'),
        cart_id: cart.id,
        product_id: Number(req.body.productId),
        variant_id: variantId,
        quantity,
        selected_services: selectedServices,
        unit_price: unitPrice,
        is_selected: 1
      });
    }
    cart.updated_at = new Date();
    await cart.save();
    return ok(res, await serializeCart(cart, token), 201);
  } catch (error) {
    return fail(res, error.message, 400);
  }
});

mongoCartRouter.patch('/items/:id', async (req, res) => {
  const { cart, guestToken: token } = await currentCart(req);
  const item = await CartItem.findOne({ id: Number(req.params.id), cart_id: cart.id });
  if (!item) return fail(res, 'Không tìm thấy dòng giỏ hàng', 404);
  if (req.body?.quantity != null) item.quantity = Math.max(1, Number(req.body.quantity || 1));
  if (req.body?.isSelected != null) item.is_selected = req.body.isSelected ? 1 : 0;
  const selectedServices = parseServiceCodes(item.selected_services);
  const { unitPrice } = await priceForItem(item.product_id, item.variant_id, selectedServices);
  item.unit_price = unitPrice;
  item.updated_at = new Date();
  await item.save();
  return ok(res, await serializeCart(cart, token));
});

mongoCartRouter.delete('/items/:id', async (req, res) => {
  const { cart, guestToken: token } = await currentCart(req);
  await CartItem.deleteOne({ id: Number(req.params.id), cart_id: cart.id });
  return ok(res, await serializeCart(cart, token));
});

mongoCartRouter.delete('/selected', async (req, res) => {
  const { cart, guestToken: token } = await currentCart(req);
  await CartItem.deleteMany({ cart_id: cart.id, is_selected: 1 });
  return ok(res, await serializeCart(cart, token));
});

mongoCartRouter.post('/merge', async (req, res) => {
  if (!req.user) return ok(res, { items: [], summary: { totalQuantity: 0 } });
  const guest = await Cart.findOne({ guest_token: req.body?.guestToken, status: 'active' });
  const { cart } = await currentCart(req);
  if (guest && guest.id !== cart.id) {
    await CartItem.updateMany({ cart_id: guest.id }, { $set: { cart_id: cart.id } });
    guest.status = 'merged';
    await guest.save();
  }
  return ok(res, await serializeCart(cart));
});
