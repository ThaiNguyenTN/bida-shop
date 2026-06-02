import { Router } from 'express';
import { query, withTransaction } from '../lib/db.js';
import { fail, ok, parseJson } from '../lib/http.js';
import { verifyToken } from '../lib/auth.js';

export const cartRouter = Router();

function emptyCartSnapshot() {
  return {
    cartId: null,
    guestToken: null,
    items: [],
    summary: {
      totalQuantity: 0,
      selectedQuantity: 0,
      itemCount: 0,
      selectedItemCount: 0,
      subtotal: 0,
      selectedSubtotal: 0,
      shipping: 0,
      grandTotal: 0
    }
  };
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
    const result = await query(`SELECT id, email, full_name, role, email_verified
      FROM users WHERE id = $1 AND is_active = 1`, [payload.sub]);
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

async function getRequiredUser(req) {
  const user = await getOptionalUser(req);
  if (!user?.id) throw new Error('Vui lòng đăng nhập để sử dụng giỏ hàng');
  return user;
}

async function findActiveCartByUser(userId, tx = null) {
  const result = await query('SELECT TOP 1 id, user_id, status FROM carts WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC, id DESC', [userId, 'active'], tx);
  return result.rows[0] || null;
}

async function createCart(userId, tx = null) {
  const inserted = await query(
    'INSERT INTO carts(user_id, guest_token, status) OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.status VALUES ($1, NULL, $2)',
    [userId, 'active'],
    tx
  );
  return inserted.rows[0];
}

async function touchCart(cartId, tx = null) {
  await query('UPDATE carts SET updated_at = SYSUTCDATETIME() WHERE id = $1', [cartId], tx);
}

async function getOrCreateUserCart(userId, tx = null) {
  return (await findActiveCartByUser(userId, tx)) || createCart(userId, tx);
}

async function resolveAuthenticatedCart(req, tx = null) {
  const user = await getRequiredUser(req);
  const cart = await getOrCreateUserCart(user.id, tx);
  return { cart, user };
}

async function loadCartSnapshot(cartId) {
  if (!cartId) return emptyCartSnapshot();
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
    cartId,
    guestToken: null,
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
    stock,
    selectedServicesJson: codesKey(serviceCodes),
    unitPrice
  };
}

cartRouter.get('/', async (req, res) => {
  const user = await getOptionalUser(req);
  if (!user?.id) return ok(res, emptyCartSnapshot());
  const cart = await getOrCreateUserCart(user.id);
  return ok(res, await loadCartSnapshot(cart.id));
});

cartRouter.post('/items', async (req, res) => {
  try {
    const body = req.body || {};
    const quantity = Math.max(1, Number(body.quantity || 1));
    const result = await withTransaction(async (tx) => {
      const { cart } = await resolveAuthenticatedCart(req, tx);
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
      return cart.id;
    });

    return ok(res, await loadCartSnapshot(result), 201);
  } catch (error) {
    const status = error.message === 'Vui lòng đăng nhập để sử dụng giỏ hàng' ? 401 : 400;
    return fail(res, error.message || 'Không thêm được vào giỏ', status);
  }
});

cartRouter.patch('/items/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await withTransaction(async (tx) => {
      const { cart } = await resolveAuthenticatedCart(req, tx);
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
      return cart.id;
    });

    return ok(res, await loadCartSnapshot(result));
  } catch (error) {
    const status = error.message === 'Vui lòng đăng nhập để sử dụng giỏ hàng' ? 401 : 400;
    return fail(res, error.message || 'Không cập nhật được giỏ hàng', status);
  }
});

cartRouter.delete('/items/:id', async (req, res) => {
  try {
    const result = await withTransaction(async (tx) => {
      const { cart } = await resolveAuthenticatedCart(req, tx);
      await query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2', [req.params.id, cart.id], tx);
      await touchCart(cart.id, tx);
      return cart.id;
    });
    return ok(res, await loadCartSnapshot(result));
  } catch (error) {
    const status = error.message === 'Vui lòng đăng nhập để sử dụng giỏ hàng' ? 401 : 400;
    return fail(res, error.message || 'Không cập nhật được giỏ hàng', status);
  }
});

cartRouter.delete('/selected', async (req, res) => {
  try {
    const result = await withTransaction(async (tx) => {
      const { cart } = await resolveAuthenticatedCart(req, tx);
      await query('DELETE FROM cart_items WHERE cart_id = $1 AND is_selected = 1', [cart.id], tx);
      await touchCart(cart.id, tx);
      return cart.id;
    });
    return ok(res, await loadCartSnapshot(result));
  } catch (error) {
    const status = error.message === 'Vui lòng đăng nhập để sử dụng giỏ hàng' ? 401 : 400;
    return fail(res, error.message || 'Không cập nhật được giỏ hàng', status);
  }
});

cartRouter.post('/merge', async (req, res) => {
  const user = await getOptionalUser(req);
  if (!user?.id) return fail(res, 'Unauthorized', 401);
  const cart = await getOrCreateUserCart(user.id);
  return ok(res, await loadCartSnapshot(cart.id));
});
