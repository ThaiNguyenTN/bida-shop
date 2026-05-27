(function () {
  const TOKEN_KEY = 'bida_api_token';
  const GUEST_KEY = 'bida_guest_token';
  const CART_CACHE_KEY = 'bida_cart_cache_v2';
  const THEME_KEY = 'bida-theme';
  const API_BASE = window.BIDA_API_BASE || (location.hostname === 'localhost' ? 'http://localhost:4000/api' : '/api');
  const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

  function currency(value) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value || 0));
  }

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(token) { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); }
  function getGuestToken() { return localStorage.getItem(GUEST_KEY) || ''; }
  function setGuestToken(token) { if (token) localStorage.setItem(GUEST_KEY, token); else localStorage.removeItem(GUEST_KEY); }

  function getCartCache() {
    try { return JSON.parse(localStorage.getItem(CART_CACHE_KEY) || '{"items":[],"summary":{"totalQuantity":0}}'); }
    catch { return { items: [], summary: { totalQuantity: 0 } }; }
  }
  function setCartCache(cart) { localStorage.setItem(CART_CACHE_KEY, JSON.stringify(cart || { items: [], summary: { totalQuantity: 0 } })); return cart; }

  function resolveMediaUrl(url) {
    const value = String(url || '').trim().replace(/\\/g, '/');
    if (!value) return '';
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (/^\/uploads\//i.test(value)) return `${API_ORIGIN}${value}`;
    if (/^uploads\//i.test(value)) return `${API_ORIGIN}/${value}`;
    if (/^\.\//.test(value)) return value.replace(/^\.\//, '');
    return value;
  }

  async function request(path, options = {}) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = { ...(options.headers || {}) };
    if (!isFormData && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const token = getToken();
    const guestToken = getGuestToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (guestToken) headers['X-Guest-Token'] = guestToken;
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.message || `HTTP ${response.status}`);
    const data = payload.data;
    if (data && Object.prototype.hasOwnProperty.call(data, 'guestToken')) setGuestToken(data.guestToken || '');
    return data;
  }

  async function getMeSafe() {
    const token = getToken();
    if (!token) return null;
    try { return await request('/auth/me'); }
    catch { setToken(''); return null; }
  }

  async function fetchCart() { return setCartCache(await request('/cart')); }
  async function addToCart(item) { return setCartCache(await request('/cart/items', { method: 'POST', body: JSON.stringify(item) })); }
  async function updateCartItem(itemId, payload) { return setCartCache(await request(`/cart/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(payload) })); }
  async function removeCartItem(itemId) { return setCartCache(await request(`/cart/items/${itemId}`, { method: 'DELETE' })); }
  async function removeSelectedCartItems() { return setCartCache(await request('/cart/selected', { method: 'DELETE' })); }
  async function mergeGuestCart() {
    if (!getToken() || !getGuestToken()) return getCartCache();
    const data = await request('/cart/merge', { method: 'POST', body: JSON.stringify({ guestToken: getGuestToken() }) });
    setGuestToken('');
    return setCartCache(data);
  }

  async function uploadFiles(route, files, fieldName = 'images') {
    const formData = new FormData();
    Array.from(files || []).forEach((file) => formData.append(fieldName, file));
    return request(route, { method: 'POST', body: formData });
  }

  window.BidaStore = {
    API_BASE,
    API_ORIGIN,
    TOKEN_KEY,
    GUEST_KEY,
    CART_CACHE_KEY,
    THEME_KEY,
    currency,
    getToken,
    setToken,
    getGuestToken,
    setGuestToken,
    getCartCache,
    setCartCache,
    resolveMediaUrl,
    request,
    getMeSafe,
    fetchCart,
    addToCart,
    updateCartItem,
    removeCartItem,
    removeSelectedCartItems,
    mergeGuestCart,
    uploadProductImages(files) { return uploadFiles('/admin/uploads/product-images', files); },
    uploadBannerImages(files) { return uploadFiles('/admin/uploads/banner-images', files); },
    uploadBlogImages(files) { return uploadFiles('/admin/uploads/blog-images', files); }
  };
})();
