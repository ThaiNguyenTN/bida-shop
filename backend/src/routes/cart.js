import crypto from 'crypto';
import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { fail, ok, parseJson } from '../lib/http.js';
import { verifyToken } from '../lib/auth.js';

export const cartRouter = Router();

function createGuestToken() {
  return crypto.randomUUID();
}

function normalizeCodes(value) {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.map((x) => String(x || '').trim()).filter(Boolean))].sort();
}

function codesKey(value) {
  return JSON.stringify(normalizeCodes(value));
}

async function getOptionalUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    const result = await query('SELECT id, email, full_name, role FROM users WHERE id = $1 AND is_active = 1', [payload.sub]);
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

async function findActiveCartByUser(userId, tx = null) {
  const result = await query('SELECT TOP 1 id, user_id, guest_token, status FROM carts WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC, id DESC', [userId, 'active'], tx);
  return result.rows[0] || null;
}

async function findActiveCartByGuest(guestToken, tx = null) {
  const result = await query('SELECT TOP 1 id, user_id, guest_token, status FROM carts WHERE guest_token = $1 AND status = $2 ORDER BY updated_at DESC, id DESC', [guestToken, 'active'], tx);
  return result.rows[0] || null;
}

async function createCart({ userId = null, guestToken = null }, tx = null) {
  const inserted = await query(
    'INSERT INTO carts(user_id, guest_token, status) OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.guest_token, INSERTED.status VALUES ($1, $2, $3)',
    [userId, guestToken, 'active'],
    tx
  );
  return inserted.rows[0];
}

async function touchCart(cartId, tx = null) {
  await query('UPDATE carts SET updated_at = SYSUTCDATETIME() WHERE id = $1', [cartId], tx);
}

async function getOrCreateUserCart(userId, tx = null) {
  return (await findActiveCartByUser(userId, tx)) || createCart({ userId }, tx);
}

async function getOrCreateGuestCart(guestToken, tx = null) {
  return (await findActiveCartByGuest(guestToken, tx)) || createCart({ guestToken }, tx);
}

async function mergeGuestCartIntoUser(userId, guestToken, tx = null) {
  const guestCart = await findActiveCartByGuest(guestToken, tx);
  const userCart = await getOrCreateUserCart(userId, tx);
  if (!guestCart || guestCart.id === userCart.id) {
    return userCart;
  }

  const guestItems = await query('SELECT * FROM cart_items WHERE cart_id = $1 ORDER BY id ASC', [guestCart.id], tx);
  for (const item of guestItems.rows) {
    const existing = await query(
      'SELECT TOP 1 id, quantity, is_selected FROM cart_items WHERE cart_id = $1 AND product_id = $2 AND ISNULL(variant_id, 0) = ISNULL($3, 0) AND ISNULL(selected_services, $4) = $4',
      [userCart.id, item.product_id, item.variant_id || 0, item.selected_services || '[]'],
      tx
    );

    if (existing.rows[0]) {
      const mergedQuantity = Number(existing.rows[0].quantity || 0) + Number(item.quantity || 0);
      const mergedSelected = Number(existing.rows[0].is_selected || 0) || Number(item.is_selected || 0) ? 1 : 0;
      await query(
        'UPDATE cart_items SET quantity = $2, is_selected = $3, updated_at = SYSUTCDATETIME() WHERE id = $1',
        [existing.rows[0].id, mergedQuantity, mergedSelected],
        tx
      );
    } else {
      await query(
        'INSERT INTO cart_items(cart_id, product_id, variant_id, quantity, selected_services, unit_price, is_selected) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [userCart.id, item.product_id, item.variant_id || null, item.quantity, item.selected_services || '[]', item.unit_price, item.is_selected ? 1 : 0],
        tx
      );
    }
  }

  await query('DELETE FROM cart_items WHERE cart_id = $1', [guestCart.id], tx);
  await query('UPDATE carts SET status = $2, updated_at = SYSUTCDATETIME() WHERE id = $1', [guestCart.id, 'merged'], tx);
  await touchCart(userCart.id, tx);
  return userCart;
}

async function resolveCart(req, tx = null) {
  const user = await getOptionalUser(req);
  const incomingGuestToken = String(req.headers['x-guest-token'] || '').trim() || null;

  if (user?.id) {
    const cart = incomingGuestToken ? await mergeGuestCartIntoUser(user.id, incomingGuestToken, tx) : await getOrCreateUserCart(user.id, tx);
    return { cart, user, guestToken: null };
  }

  const guestToken = incomingGuestToken || createGuestToken();
  const cart = await getOrCreateGuestCart(guestToken, tx);
  return { cart, user: null, guestToken };
}

async function loadCartSnapshot(cartId) {
  const itemResult = await query(`SELECT ci.id, ci.cart_id, ci.product_id, ci.variant_id, ci.quantity, ci.selected_services, ci.unit_price, ci.is_selected,
      p.slug, p.sku, p.name, p.brand, p.type, p.price, p.sale_price, p.stock_total, p.tip_size AS product_tip_size,
      pv.weight AS variant_weight, pv.tip_size AS variant_tip_size, pv.stock AS variant_stock,
      (SELECT TOP 1 image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC) AS cover_image
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    LEFT JOIN product_variants pv ON pv.id = ci.variant_id
    WHERE ci.cart_id = $1 AND p.is_active = 1
    ORDER BY ci.created_at DESC, ci.id DESC`, [cartId]);

  const items = [];
  for (const row of itemResult.rows) {
    const selectedCodes = parseJson(row.selected_services, []);
    const serviceResult = await query('SELECT id, code, name, price FROM product_services WHERE product_id = $1 ORDER BY name ASC', [row.product_id]);
    const selectedServices = serviceResult.rows.filter((service) => selectedCodes.includes(service.code));
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unit_price || 0);
    const lineTotal = quantity * unitPrice;
    items.push({
      id: row.id,
      cartId: row.cart_id,
      productId: row.product_id,
      variantId: row.variant_id,
      quantity,
      isSelected: Boolean(row.is_selected),
      selectedServiceCodes: selectedCodes,
      unitPrice,
      lineTotal,
      product: {
        id: row.product_id,
        slug: row.slug,
        sku: row.sku,
        name: row.name,
        brand: row.brand,
        type: row.type,
        price: Number(row.price || 0),
        salePrice: row.sale_price == null ? null : Number(row.sale_price),
        stockTotal: Number(row.stock_total || 0),
        tipSize: row.product_tip_size,
        coverImage: row.cover_image || 'https://placehold.co/1200x800?text=Bida'
      },
      variant: row.variant_id ? {
        id: row.variant_id,
        weight: row.variant_weight,
        tipSize: row.variant_tip_size,
        stock: Number(row.variant_stock || 0)
      } : null,
      services: selectedServices
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const selectedSubtotal = items.filter((item) => item.isSelected).reduce((sum, item) => sum + item.lineTotal, 0);
  const shippingStandard = 45000;
  const shipping = items.some((item) => item.isSelected) ? shippingStandard : 0;

  return {
    items,
    summary: {
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      selectedQuantity: items.filter((item) => item.isSelected).reduce((sum, item) => sum + item.quantity, 0),
      itemCount: items.length,
      selectedItemCount: items.filter((item) => item.isSelected).length,
      subtotal,
      selectedSubtotal,
      shipping,
      grandTotal: selectedSubtotal + shipping
    }
  };
}

async function pricingForCartItem(productId, variantId, selectedServices, tx = null) {
  const productResult = await query('SELECT id, sale_price, price, stock_total, is_active, name FROM products WHERE id = $1', [productId], tx);
  const product = productResult.rows[0];
  if (!product || !product.is_active) throw new Error('Sản phẩm không tồn tại hoặc đã ẩn');

  let variant = null;
  if (variantId) {
    const variantResult = await query('SELECT id, product_id, stock, price_delta FROM product_variants WHERE id = $1 AND product_id = $2', [variantId, productId], tx);
    variant = variantResult.rows[0] || null;
    if (!variant) throw new Error('Biến thể không tồn tại');
  }

  const serviceCodes = normalizeCodes(selectedServices);
  const services = (await query('SELECT code, price FROM product_services WHERE product_id = $1', [productId], tx)).rows;
  const servicesTotal = serviceCodes.reduce((sum, code) => sum + Number(services.find((service) => service.code === code)?.price || 0), 0);
  const stock = variant ? Number(variant.stock || 0) : Number(product.stock_total || 0);
  const unitPrice = Number(product.sale_price || product.price || 0) + Number(variant?.price_delta || 0) + servicesTotal;

  return {
    product,
    variant,
    stock,
    serviceCodes,
    selectedServicesJson: codesKey(serviceCodes),
    unitPrice
  };
}

cartRouter.get('/', async (req, res) => {
  const { cart, guestToken } = await resolveCart(req);
  const snapshot = await loadCartSnapshot(cart.id);
  return ok(res, { cartId: cart.id, guestToken, ...snapshot });
});

cartRouter.post('/items', async (req, res) => {
  try {
    const body = req.body || {};
    const quantity = Math.max(1, Number(body.quantity || 1));
    const result = await withTransaction(async (tx) => {
      const { cart, guestToken } = await resolveCart(req, tx);
      const pricing = await pricingForCartItem(body.productId, body.variantId || null, body.selectedServices || [], tx);
      if (pricing.stock < quantity) throw new Error(`Tồn kho không đủ cho ${pricing.product.name}`);

      const existing = await query(
        'SELECT TOP 1 id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2 AND ISNULL(variant_id, 0) = ISNULL($3, 0) AND ISNULL(selected_services, $4) = $4',
        [cart.id, body.productId, body.variantId || 0, pricing.selectedServicesJson],
        tx
      );

      if (existing.rows[0]) {
        const nextQuantity = Number(existing.rows[0].quantity || 0) + quantity;
        if (pricing.stock < nextQuantity) throw new Error(`Tồn kho không đủ cho ${pricing.product.name}`);
        await query(
          'UPDATE cart_items SET quantity = $2, unit_price = $3, is_selected = 1, updated_at = SYSUTCDATETIME() WHERE id = $1',
          [existing.rows[0].id, nextQuantity, pricing.unitPrice],
          tx
        );
      } else {
        await query(
          'INSERT INTO cart_items(cart_id, product_id, variant_id, quantity, selected_services, unit_price, is_selected) VALUES ($1,$2,$3,$4,$5,$6,1)',
          [cart.id, body.productId, body.variantId || null, quantity, pricing.selectedServicesJson, pricing.unitPrice],
          tx
        );
      }

      await touchCart(cart.id, tx);
      return { cartId: cart.id, guestToken };
    });

    const snapshot = await loadCartSnapshot(result.cartId);
    return ok(res, { guestToken: result.guestToken, cartId: result.cartId, ...snapshot }, 201);
  } catch (error) {
    return fail(res, error.message || 'Không thêm được vào giỏ', 400);
  }
});

cartRouter.patch('/items/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await withTransaction(async (tx) => {
      const { cart, guestToken } = await resolveCart(req, tx);
      const current = await query('SELECT * FROM cart_items WHERE id = $1 AND cart_id = $2', [req.params.id, cart.id], tx);
      const item = current.rows[0];
      if (!item) throw new Error('Không tìm thấy dòng giỏ hàng');

      const nextQuantity = body.quantity == null ? Number(item.quantity || 1) : Math.max(1, Number(body.quantity || 1));
      const nextSelected = body.isSelected == null ? (item.is_selected ? 1 : 0) : (body.isSelected ? 1 : 0);
      const pricing = await pricingForCartItem(item.product_id, item.variant_id || null, parseJson(item.selected_services, []), tx);
      if (pricing.stock < nextQuantity) throw new Error(`Tồn kho không đủ cho ${pricing.product.name}`);

      await query(
        'UPDATE cart_items SET quantity = $2, unit_price = $3, is_selected = $4, updated_at = SYSUTCDATETIME() WHERE id = $1',
        [item.id, nextQuantity, pricing.unitPrice, nextSelected],
        tx
      );
      await touchCart(cart.id, tx);
      return { cartId: cart.id, guestToken };
    });

    const snapshot = await loadCartSnapshot(result.cartId);
    return ok(res, { guestToken: result.guestToken, cartId: result.cartId, ...snapshot });
  } catch (error) {
    return fail(res, error.message || 'Không cập nhật được giỏ hàng', 400);
  }
});

cartRouter.delete('/items/:id', async (req, res) => {
  const result = await withTransaction(async (tx) => {
    const { cart, guestToken } = await resolveCart(req, tx);
    await query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2', [req.params.id, cart.id], tx);
    await touchCart(cart.id, tx);
    return { cartId: cart.id, guestToken };
  });
  const snapshot = await loadCartSnapshot(result.cartId);
  return ok(res, { guestToken: result.guestToken, cartId: result.cartId, ...snapshot });
});

cartRouter.delete('/selected', async (req, res) => {
  const result = await withTransaction(async (tx) => {
    const { cart, guestToken } = await resolveCart(req, tx);
    await query('DELETE FROM cart_items WHERE cart_id = $1 AND is_selected = 1', [cart.id], tx);
    await touchCart(cart.id, tx);
    return { cartId: cart.id, guestToken };
  });
  const snapshot = await loadCartSnapshot(result.cartId);
  return ok(res, { guestToken: result.guestToken, cartId: result.cartId, ...snapshot });
});

cartRouter.post('/merge', async (req, res) => {
  const user = await getOptionalUser(req);
  if (!user?.id) return fail(res, 'Unauthorized', 401);
  const guestToken = String(req.headers['x-guest-token'] || req.body?.guestToken || '').trim();
  if (!guestToken) {
    const cart = await getOrCreateUserCart(user.id);
    const snapshot = await loadCartSnapshot(cart.id);
    return ok(res, { cartId: cart.id, guestToken: null, ...snapshot });
  }
  const result = await withTransaction(async (tx) => {
    const cart = await mergeGuestCartIntoUser(user.id, guestToken, tx);
    return { cartId: cart.id };
  });
  const snapshot = await loadCartSnapshot(result.cartId);
  return ok(res, { cartId: result.cartId, guestToken: null, ...snapshot });
});
