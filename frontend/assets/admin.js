(function () {
  const store = window.BidaStore;
  const app = document.getElementById('adminApp');
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - 29);
  const defaultFrom = fromDate.toISOString().slice(0, 10);
  const state = {
    me: null,
    dashboard: null,
    products: [],
    categories: [],
    orders: [],
    customers: [],
    customerDetail: null,
    coupons: [],
    banners: [],
    posts: [],
    reviews: [],
    settings: null,
    productSearch: '',
    customerSearch: '',
    activeTab: 'dashboard',
    selectedCustomerId: null,
    couponRecipientDetail: null,
    couponSubTab: 'list',
    editingCoupon: null,
    contentSubTab: 'banners',
    editingBanner: null,
    editingPost: null,
    dashboardRange: { from: defaultFrom, to: defaultTo }
  };

  function $(s, p) { return (p || document).querySelector(s); }
  function $all(s, p) { return Array.from((p || document).querySelectorAll(s)); }
  function fmtDate(v) { return v ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '-'; }
  function esc(value) { return String(value || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function formatCustomerAddress(address = {}) {
    return [address.line1, address.ward || address.district || '', address.city].map((item) => String(item || '').trim()).filter(Boolean).join(', ');
  }
  function notificationPreviewHtml(value) {
    const raw = String(value || '').trim();
    if (!raw) return '<p class="muted">Không có nội dung.</p>';
    const safe = raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    if (!/[<>]/.test(safe)) return `<p>${esc(safe).replace(/\n/g, '<br />')}</p>`;
    const template = document.createElement('template');
    template.innerHTML = safe;
    $all('img', template.content).forEach((img) => {
      img.classList.add('admin-notification-image');
      img.loading = 'lazy';
      img.src = store.resolveMediaUrl(img.getAttribute('src') || '');
    });
    return template.innerHTML;
  }
  function initials(name) { return String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || '?'; }
  function notify(text, type) {
    const node = document.createElement('div');
    node.className = `alert ${type || 'success'}`;
    Object.assign(node.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: '200' });
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2800);
  }
  function currentTheme() { if (localStorage.getItem(store.THEME_KEY) === 'light') document.body.classList.add('light'); }
  function getField(form, name) { return form?.elements?.namedItem(name); }
  function productImageCard(url, index) {
    return `<div class="image-sort-item" draggable="true" data-index="${index}" style="padding:10px;border:1px dashed var(--line);border-radius:14px;background:rgba(255,255,255,0.04);">
      <img src="${store.resolveMediaUrl(url)}" style="width:100%;height:110px;object-fit:cover;border-radius:12px;" onerror="this.onerror=null;this.src='data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="28" fill="#64748b">Ảnh lỗi</text></svg>')}'">
      <div class="muted" style="margin-top:8px;font-size:12px;word-break:break-all;">${esc(url)}</div>
      <div class="inline-actions" style="margin-top:8px;justify-content:space-between;"><span class="badge">Kéo để đổi thứ tự</span><button class="btn btn-danger remove-uploaded-image" type="button" data-index="${index}">Xóa</button></div>
    </div>`;
  }
  function parseVariantsText(text) {
    return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
      const [weight = '', tipSize = '', stock = '0', priceDelta = '0'] = line.split('|').map((part) => part.trim());
      return { code: `VAR-${index + 1}`, weight, tipSize, stock: Number(stock || 0), priceDelta: Number(priceDelta || 0) };
    });
  }
  function stringifyVariants(variants = []) {
    return (variants || []).map((v) => [v.weight || '', v.tip_size || v.tipSize || '', Number(v.stock || 0), Number(v.price_delta || v.priceDelta || 0)].join('|')).join('\n');
  }
  function parseServicesText(text) {
    return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name = '', price = '0'] = line.split('|').map((part) => part.trim());
      return { name, price: Number(price || 0), code: name.toUpperCase().replace(/[^A-Z0-9]+/g, '-') };
    }).filter((x) => x.name);
  }
  function stringifyServices(services = []) {
    return (services || []).map((s) => `${s.name}|${Number(s.price || 0)}`).join('\n');
  }
  function categoryOptionsHtml(selectedValue = '') {
    const current = String(selectedValue || '');
    return `<option value="">Chọn danh mục</option>${(state.categories || []).map((category) => `<option value="${category.id}" ${String(category.id) === current ? 'selected' : ''}>${esc(category.name)}</option>`).join('')}`;
  }
  function filteredProducts() {
    const q = state.productSearch.trim().toLowerCase();
    if (!q) return state.products;
    return state.products.filter((product) => [product.sku, product.name, product.brand, product.type].join(' ').toLowerCase().includes(q));
  }
  function getProductImageUrlsFromForm() {
    const field = $('#productForm [name="imageUrls"]');
    return String(field?.value || '').split('\n').map((line) => line.trim()).filter(Boolean);
  }
  function setProductImageUrlsToForm(urls) {
    const field = $('#productForm [name="imageUrls"]');
    if (!field) return;
    field.value = urls.join('\n');
    renderProductImagePreview();
  }
  function renderProductImagePreview() {
    const wrap = $('#productImagePreview');
    if (!wrap) return;
    const urls = getProductImageUrlsFromForm();
    wrap.innerHTML = urls.length ? `<div id="sortableImages" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;">${urls.map(productImageCard).join('')}</div>` : '<div class="muted">Chưa có ảnh nào cho sản phẩm này.</div>';
    $all('.remove-uploaded-image', wrap).forEach((btn) => btn.onclick = () => setProductImageUrlsToForm(getProductImageUrlsFromForm().filter((_, idx) => idx !== Number(btn.dataset.index))));
    let dragging = null;
    $all('.image-sort-item', wrap).forEach((item) => {
      item.addEventListener('dragstart', () => { dragging = Number(item.dataset.index); item.style.opacity = '0.5'; });
      item.addEventListener('dragend', () => { item.style.opacity = '1'; });
      item.addEventListener('dragover', (e) => e.preventDefault());
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = Number(item.dataset.index);
        if (dragging == null || target === dragging) return;
        const urls = getProductImageUrlsFromForm();
        const [moved] = urls.splice(dragging, 1);
        urls.splice(target, 0, moved);
        dragging = null;
        setProductImageUrlsToForm(urls);
      });
    });
  }
  async function uploadSelectedProductImages() {
    const input = $('#productImageFiles');
    const files = Array.from(input?.files || []);
    if (!files.length) return notify('Hãy chọn ít nhất 1 ảnh để tải lên.', 'warning');
    try {
      const result = await store.uploadProductImages(files);
      setProductImageUrlsToForm([...getProductImageUrlsFromForm(), ...(result.files || []).map((file) => file.url)]);
      input.value = '';
      notify('Đã tải ảnh lên thành công.');
    } catch (error) { notify(error.message, 'danger'); }
  }

  async function bootstrap() {
    currentTheme();
    try {
      const me = await store.getMeSafe();
      state.me = me?.user || null;
      if (!state.me || !['admin', 'manager', 'warehouse', 'cskh'].includes(state.me.role)) return renderLogin();
      await loadAdminData();
      renderShell(state.activeTab);
    } catch (error) {
      app.innerHTML = `<div class="login-screen"><div class="card login-card"><div class="section-title"><h1>Admin không tải được</h1><span class="badge">API lỗi</span></div><p class="muted">${esc(error.message || 'Không kết nối được API admin.')}</p><div class="inline-actions"><button class="btn btn-primary" id="retryAdminLoad" type="button">Thử lại</button><button class="btn" id="logoutAdminLoad" type="button">Đăng nhập lại</button></div></div></div>`;
      $('#retryAdminLoad').onclick = bootstrap;
      $('#logoutAdminLoad').onclick = () => { store.setToken(''); renderLogin(); };
    }
  }
  async function loadDashboard() {
    const params = new URLSearchParams({ from: state.dashboardRange.from, to: state.dashboardRange.to });
    state.dashboard = await store.request(`/admin/dashboard?${params.toString()}`);
  }
  async function loadAdminData() {
    const [products, categories, orders, customers, settings, coupons, banners, posts, reviews] = await Promise.all([
      store.request('/admin/products'),
      store.request('/categories'),
      store.request('/admin/orders'),
      store.request('/admin/customers'),
      store.request('/admin/settings/general'),
      store.request('/admin/coupons'),
      store.request('/admin/content/banners'),
      store.request('/admin/content/posts'),
      store.request('/admin/reviews')
    ]);
    Object.assign(state, { products, categories, orders, customers, settings, coupons, banners, posts, reviews });
    await loadDashboard();
    if (state.selectedCustomerId) {
      try { state.customerDetail = await store.request(`/admin/customers/${state.selectedCustomerId}`); } catch { state.customerDetail = null; }
    }
  }
  function renderLogin() {
    app.innerHTML = `<div class="login-screen"><div class="card login-card"><div class="section-title"><h1>Admin • Bida Pro Shop</h1><span class="badge">Database</span></div><p class="muted">Đăng nhập bằng tài khoản quản trị đã seed trong database.</p><form id="loginForm" class="stack-form"><label><span>Email</span><input name="email" required /></label><label><span>Mật khẩu</span><input name="password" type="password" required /></label><button class="btn btn-primary" type="submit">Đăng nhập</button></form></div></div>`;
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const data = await store.request('/auth/login', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }) });
        store.setToken(data.token);
        bootstrap();
      } catch (error) { notify(error.message, 'danger'); }
    };
  }
  function tabList() {
    const all = [
      ['dashboard', 'Tổng quan'], ['products', 'Sản phẩm'], ['orders', 'Đơn hàng'], ['customers', 'Khách hàng'],
      ['coupons', 'Voucher'], ['content', 'Banner & blog'], ['inventory', 'Nhập kho'], ['reviews', 'Đánh giá'], ['settings', 'Cài đặt']
    ];
    if (state.me.role === 'warehouse') return all.filter(([id]) => ['dashboard', 'products', 'orders', 'inventory'].includes(id));
    if (state.me.role === 'cskh') return all.filter(([id]) => ['dashboard', 'orders', 'customers', 'coupons', 'reviews'].includes(id));
    return all;
  }
  function tabIcon(id) {
    return ({ dashboard: '📊', products: '🧾', orders: '📦', customers: '👤', coupons: '🎟️', content: '📰', inventory: '🏷️', reviews: '★', settings: '⚙️' })[id] || '•';
  }
  function renderShell(tab) {
    state.activeTab = tab;
    app.innerHTML = `<div class="admin-shell"><aside class="admin-sidebar"><div class="logo admin-brand"><span class="logo-mark">🎱</span><span class="admin-brand-text">Admin Panel</span></div><div class="notice admin-user-card"><strong>${esc(state.me.fullName)}</strong><div class="muted">${esc(state.me.role)}</div></div><div class="admin-menu">${tabList().map(([id, label]) => `<button class="btn ${tab === id ? 'btn-primary' : ''}" data-tab="${id}" title="${esc(label)}" type="button"><span class="admin-nav-icon">${tabIcon(id)}</span><span class="admin-nav-label">${label}</span></button>`).join('')}</div><div class="admin-sidebar-actions"><button class="btn" id="openFrontendBtn" title="Mở web khách" type="button"><span class="admin-nav-icon">↗</span><span class="admin-nav-label">Mở web khách</span></button><button class="btn" id="toggleThemeAdmin" title="Đổi giao diện" type="button"><span class="admin-nav-icon">◐</span><span class="admin-nav-label">Đổi giao diện</span></button><button class="btn btn-danger" id="logoutBtn" title="Đăng xuất" type="button"><span class="admin-nav-icon">⏻</span><span class="admin-nav-label">Đăng xuất</span></button></div></aside><main class="admin-content"><div class="admin-topbar"><div><h1 style="margin:0;">${tabList().find(([id]) => id === tab)?.[1] || ''}</h1></div></div><div id="tabContent"></div></main></div>`;
    $all('[data-tab]').forEach((button) => button.onclick = () => renderShell(button.dataset.tab));
    $('#openFrontendBtn').onclick = () => window.open('index.html', '_blank');
    $('#toggleThemeAdmin').onclick = () => { document.body.classList.toggle('light'); localStorage.setItem(store.THEME_KEY, document.body.classList.contains('light') ? 'light' : 'dark'); };
    $('#logoutBtn').onclick = () => { store.setToken(''); location.reload(); };
    renderTab(tab);
  }
  function renderTab(tab) {
    if (tab === 'dashboard') return renderDashboard();
    if (tab === 'products') return renderProducts();
    if (tab === 'orders') return renderOrders();
    if (tab === 'customers') return renderCustomers();
    if (tab === 'coupons') return renderCoupons();
    if (tab === 'content') return renderContent();
    if (tab === 'inventory') return renderInventory();
    if (tab === 'reviews') return renderReviews();
    return renderSettings();
  }

  function renderDashboard() {
    const d = state.dashboard || { kpis: {}, topProducts: [], alerts: [], recentOrders: [], dailyRevenue: [], range: state.dashboardRange };
    $('#tabContent').innerHTML = `<div class="card" style="padding:18px;"><div class="section-title"><div><h2>Doanh thu từ ngày đến ngày</h2></div><form id="dashboardRangeForm" class="inline-actions"><input type="date" name="from" value="${d.range?.from || state.dashboardRange.from}" /><input type="date" name="to" value="${d.range?.to || state.dashboardRange.to}" /><button class="btn btn-primary" type="submit">Xem doanh thu</button></form></div><div class="grid-4"><div class="stat-card" style="padding:18px;"><div class="muted">Doanh thu paid</div><h2>${store.currency(d.kpis?.revenue || 0)}</h2></div><div class="stat-card" style="padding:18px;"><div class="muted">Số đơn trong kỳ</div><h2>${d.kpis?.orders_count || 0}</h2></div><div class="stat-card" style="padding:18px;"><div class="muted">Đơn đã thanh toán</div><h2>${d.kpis?.paid_orders || 0}</h2></div><div class="stat-card" style="padding:18px;"><div class="muted">Giá trị đơn TB</div><h2>${store.currency(d.kpis?.avg_paid_order || 0)}</h2></div></div></div>
    <div class="grid-2" style="margin-top:18px;"><div class="card" style="padding:18px;"><h3>Doanh thu theo ngày</h3><table class="admin-table compact"><thead><tr><th>Ngày</th><th>Đơn</th><th>Doanh thu</th></tr></thead><tbody>${(d.dailyRevenue || []).map((row) => `<tr><td>${row.order_date}</td><td>${row.orders_count}</td><td>${store.currency(row.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Chưa có dữ liệu.</td></tr>'}</tbody></table></div><div class="card" style="padding:18px;"><h3>Top sản phẩm bán chạy</h3><table class="admin-table compact"><thead><tr><th>Tên</th><th>Brand</th><th>Đã bán</th><th>Tồn</th></tr></thead><tbody>${(d.topProducts || []).map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.brand || '-')}</td><td>${row.sold_count}</td><td>${row.stock_total}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Chưa có dữ liệu.</td></tr>'}</tbody></table></div></div>
    <div class="grid-2" style="margin-top:18px;"><div class="card" style="padding:18px;"><h3>Đơn gần đây</h3><table class="admin-table compact"><thead><tr><th>Mã đơn</th><th>Khách</th><th>Tổng</th><th>Trạng thái</th></tr></thead><tbody>${(d.recentOrders || []).map((o) => `<tr><td>${esc(o.order_code)}</td><td>${esc(o.customer_name)}</td><td>${store.currency(o.grand_total)}</td><td>${esc(o.order_status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Chưa có dữ liệu.</td></tr>'}</tbody></table></div><div class="card" style="padding:18px;"><h3>Cảnh báo sắp hết hàng</h3><table class="admin-table compact"><thead><tr><th>Sản phẩm</th><th>Tồn</th></tr></thead><tbody>${(d.alerts || []).map((p) => `<tr><td>${esc(p.name)}</td><td>${p.stock_total}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Kho đang ổn.</td></tr>'}</tbody></table></div></div>`;
    $('#dashboardRangeForm').onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(e.target); state.dashboardRange = { from: fd.get('from'), to: fd.get('to') }; await loadDashboard(); renderDashboard(); };
  }

  function resetProductForm() {
    const form = $('#productForm'); if (!form) return;
    form.reset();
    form.elements.namedItem('id').value = '';
    form.elements.namedItem('imageUrls').value = '';
    $('#productFormTitle').textContent = 'Thêm / sửa sản phẩm';
    renderProductImagePreview();
  }
  function enhanceProductForm() {
    const form = $('#productForm');
    if (!form) return;

    const brandField = form.elements.namedItem('brand')?.closest('label');
    const typeField = form.elements.namedItem('type')?.closest('label');
    const typeGrid = typeField?.parentElement;
    if (typeGrid?.classList?.contains('form-grid-2')) typeGrid.classList.add('form-grid-3');
    if (!form.elements.namedItem('categoryId') && typeGrid && brandField && typeField) {
      const categoryLabel = document.createElement('label');
      categoryLabel.innerHTML = `<span>Danh mục</span><select name="categoryId">${categoryOptionsHtml()}</select>`;
      typeGrid.appendChild(categoryLabel);
    }

    const featuredLabel = form.elements.namedItem('isFeatured')?.closest('label');
    const activeLabel = form.elements.namedItem('isActive')?.closest('label');
    const statusGrid = featuredLabel?.parentElement;
    if (statusGrid?.classList?.contains('form-grid-2')) statusGrid.className = 'admin-product-status-grid';
    if (featuredLabel) {
      featuredLabel.className = 'admin-check-card';
      featuredLabel.innerHTML = `<input type="checkbox" name="isFeatured" ${form.elements.namedItem('isFeatured')?.checked ? 'checked' : ''} /><span class="admin-check-copy"><strong>Sản phẩm nổi bật</strong><small>Ưu tiên hiển thị ở trang chủ và khu vực gợi ý.</small></span>`;
    }
    if (activeLabel) {
      activeLabel.className = 'admin-check-card';
      activeLabel.innerHTML = `<input type="checkbox" name="isActive" ${form.elements.namedItem('isActive')?.checked ? 'checked' : ''} /><span class="admin-check-copy"><strong>Hiển thị trên web</strong><small>Bật hoặc tắt trạng thái bán trên giao diện khách hàng.</small></span>`;
    }
  }
  async function loadProductIntoForm(id) {
    const product = await store.request(`/admin/products/${id}`);
    const form = $('#productForm');
    form.elements.namedItem('id').value = product.id;
    form.elements.namedItem('name').value = product.name || '';
    form.elements.namedItem('sku').value = product.sku || '';
    form.elements.namedItem('brand').value = product.brand || '';
    form.elements.namedItem('type').value = product.type || '';
    form.elements.namedItem('categoryId').value = product.category_id || '';
    form.elements.namedItem('price').value = product.price || 0;
    form.elements.namedItem('salePrice').value = product.sale_price || '';
    form.elements.namedItem('stockTotal').value = product.stock_total || 0;
    form.elements.namedItem('tipSize').value = product.tip_size || '';
    form.elements.namedItem('jointType').value = product.joint_type || '';
    form.elements.namedItem('shaftMaterial').value = product.shaft_material || '';
    form.elements.namedItem('wrapType').value = product.wrap_type || '';
    form.elements.namedItem('buttMaterial').value = product.butt_material || '';
    form.elements.namedItem('description').value = product.description || '';
    form.elements.namedItem('longDescription').value = product.long_description || '';
    form.elements.namedItem('variantsText').value = stringifyVariants(product.variants || []);
    form.elements.namedItem('servicesText').value = stringifyServices(product.services || []);
    form.elements.namedItem('imageUrls').value = (product.images || []).map((image) => image.image_url).join('\n');
    form.elements.namedItem('isFeatured').checked = Boolean(product.is_featured);
    form.elements.namedItem('isActive').checked = Boolean(product.is_active);
    $('#productFormTitle').textContent = `Sửa sản phẩm: ${product.name}`;
    renderProductImagePreview();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderProducts() {
    const products = filteredProducts();
    $('#tabContent').innerHTML = `<div class="card" style="padding:18px;"><div class="section-title"><h2>CRUD sản phẩm</h2><div class="inline-actions"><input id="adminProductSearch" type="search" placeholder="Tìm theo SKU, tên, thương hiệu, loại..." value="${esc(state.productSearch)}" style="min-width:320px;" /><button class="btn btn-primary" id="newProductBtn" type="button">Thêm sản phẩm</button></div></div><div class="table-shell"><table class="admin-table beautiful-table"><thead><tr><th>Ảnh</th><th>SKU</th><th>Tên</th><th>Brand</th><th>Loại</th><th>Giá</th><th>Tồn</th><th>Biến thể</th><th>Trạng thái</th><th></th></tr></thead><tbody>${products.map((p) => `<tr><td style="width:86px;"><img src="${store.resolveMediaUrl(p.cover_image || '')}" style="width:64px;height:64px;border-radius:14px;object-fit:cover;background:#f1f5f9;" onerror="this.onerror=null;this.src='data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="20" fill="#64748b">No image</text></svg>')}'"></td><td><strong>${esc(p.sku)}</strong></td><td><div><strong>${esc(p.name)}</strong><div class="muted">${esc(p.joint_type || '-')} • ${esc(p.butt_material || '-')}</div></div></td><td>${esc(p.brand)}</td><td>${esc(p.type)}</td><td>${store.currency(p.sale_price || p.price)}</td><td>${p.stock_total}</td><td>${p.variants_count || 0}</td><td><span class="badge ${p.is_active ? 'active' : ''}">${p.is_active ? 'Hiển thị' : 'Ẩn'}</span></td><td><div class="inline-actions"><button class="btn edit-product" type="button" data-id="${p.id}">Sửa</button>${['admin', 'manager'].includes(state.me.role) ? `<button class="btn ${p.is_active ? 'btn-danger' : ''} toggle-product" type="button" data-id="${p.id}" data-active="${p.is_active ? '1' : '0'}">${p.is_active ? 'Ẩn' : 'Hiện'}</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="10" class="muted">Không tìm thấy sản phẩm.</td></tr>'}</tbody></table></div></div><div class="card" style="padding:18px;margin-top:18px;"><h2 id="productFormTitle">Thêm / sửa sản phẩm</h2><form id="productForm" class="stack-form"><input type="hidden" name="id" /><input type="hidden" name="imageUrls" /><div class="form-grid-2"><label><span>Tên</span><input name="name" required /></label><label><span>SKU</span><input name="sku" required /></label></div><div class="form-grid-2"><label><span>Brand</span><input name="brand" required /></label><label><span>Loại</span><input name="type" required placeholder="Pool / Carom / Break/Jump / Accessory" /></label></div><div class="form-grid-2"><label><span>Giá bán</span><input type="number" name="price" min="0" required /></label><label><span>Giá KM</span><input type="number" name="salePrice" min="0" /></label></div><div class="form-grid-2"><label><span>Tồn kho tổng</span><input type="number" name="stockTotal" min="0" value="0" /></label><label><span>Tip size mặc định</span><input name="tipSize" placeholder="12.5mm" /></label></div><div class="form-grid-2"><label><span>Joint</span><input name="jointType" /></label><label><span>Shaft</span><input name="shaftMaterial" /></label></div><div class="form-grid-2"><label><span>Wrap</span><input name="wrapType" placeholder="Linen / Leather / Wrapless" /></label><label><span>Chuôi (butt)</span><input name="buttMaterial" placeholder="Maple / Ebony / Carbon butt" /></label></div><label><span>Mô tả ngắn</span><textarea name="description"></textarea></label><label><span>Mô tả chi tiết</span><textarea name="longDescription"></textarea></label><label><span>Biến thể trọng lượng</span><textarea name="variantsText" rows="5" placeholder="Mỗi dòng: weight|tip size|stock|price delta&#10;Ví dụ: 19oz|12.5mm|5|0"></textarea></label><label><span>Dịch vụ kèm theo</span><textarea name="servicesText" rows="4" placeholder="Mỗi dòng: tên dịch vụ|giá&#10;Ví dụ: Khắc tên lên chuôi|150000"></textarea></label><div class="card" style="padding:14px;"><div class="section-title"><h3>Ảnh sản phẩm</h3><div class="inline-actions"><input id="productImageFiles" type="file" accept="image/*" multiple /><button class="btn btn-primary" id="uploadProductImagesBtn" type="button">Tải ảnh từ máy</button></div></div><div class="muted" style="margin-bottom:12px;">Kéo-thả các ảnh để sắp xếp thứ tự hiển thị.</div><div id="productImagePreview"></div></div><div class="form-grid-2"><label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="isFeatured" /> Sản phẩm nổi bật</label><label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="isActive" checked /> Hiển thị trên web</label></div><div class="inline-actions"><button class="btn btn-primary" type="submit">Lưu</button><button class="btn" type="button" id="resetProductForm">Làm mới</button></div></form></div>`;
    $('#adminProductSearch').oninput = (e) => { state.productSearch = e.target.value || ''; renderProducts(); };
    $('#newProductBtn').onclick = resetProductForm;
    $('#resetProductForm').onclick = resetProductForm;
    $('#uploadProductImagesBtn').onclick = uploadSelectedProductImages;
    enhanceProductForm();
    renderProductImagePreview();
    $all('.edit-product').forEach((btn) => btn.onclick = async () => { try { await loadProductIntoForm(Number(btn.dataset.id)); } catch (error) { notify(error.message, 'danger'); } });
    $all('.toggle-product').forEach((btn) => btn.onclick = async () => { const id = Number(btn.dataset.id); const nextActive = btn.dataset.active !== '1'; try { await store.request(`/admin/products/${id}/visibility`, { method: 'PATCH', body: JSON.stringify({ isActive: nextActive }) }); await loadAdminData(); renderProducts(); notify(nextActive ? 'Đã hiển thị sản phẩm.' : 'Đã ẩn sản phẩm.'); } catch (error) { notify(error.message, 'danger'); } });
    $('#productForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { name: fd.get('name'), sku: fd.get('sku'), brand: fd.get('brand'), type: fd.get('type'), categoryId: fd.get('categoryId') ? Number(fd.get('categoryId')) : null, price: Number(fd.get('price')), salePrice: fd.get('salePrice') ? Number(fd.get('salePrice')) : null, stockTotal: Number(fd.get('stockTotal') || 0), tipSize: fd.get('tipSize'), jointType: fd.get('jointType'), shaftMaterial: fd.get('shaftMaterial'), wrapType: fd.get('wrapType'), buttMaterial: fd.get('buttMaterial'), description: fd.get('description'), longDescription: fd.get('longDescription'), variants: parseVariantsText(fd.get('variantsText')), services: parseServicesText(fd.get('servicesText')), imageUrls: getProductImageUrlsFromForm(), isFeatured: fd.get('isFeatured') === 'on', isActive: fd.get('isActive') === 'on' };
      const id = fd.get('id');
      try { await store.request(id ? `/admin/products/${id}` : '/admin/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); await loadAdminData(); renderProducts(); resetProductForm(); notify(id ? 'Đã cập nhật sản phẩm.' : 'Đã tạo sản phẩm mới.'); } catch (error) { notify(error.message, 'danger'); }
    };
  }

  function renderOrders() {
    $('#tabContent').innerHTML = `<div class="card" style="padding:18px;"><div class="section-title"><h2>Quản lý đơn hàng</h2></div><div class="table-shell"><table class="admin-table beautiful-table compact"><thead><tr><th>Mã đơn</th><th>Khách</th><th>Điện thoại</th><th>Tổng</th><th>Trạng thái đơn</th><th>Thanh toán</th><th>Vận đơn</th><th>Lưu</th></tr></thead><tbody>${state.orders.map((o) => `<tr><td><strong>${esc(o.order_code)}</strong><div class="muted">${fmtDate(o.created_at)}</div></td><td>${esc(o.customer_name)}</td><td>${esc(o.phone)}</td><td>${store.currency(o.grand_total)}</td><td><select class="order-status" data-id="${o.id}"><option value="received" ${o.order_status === 'received' ? 'selected' : ''}>Tiếp nhận</option><option value="preparing" ${o.order_status === 'preparing' ? 'selected' : ''}>Đang chuẩn bị</option><option value="shipping" ${o.order_status === 'shipping' ? 'selected' : ''}>Đang giao</option><option value="completed" ${o.order_status === 'completed' ? 'selected' : ''}>Hoàn thành</option><option value="cancelled" ${o.order_status === 'cancelled' ? 'selected' : ''}>Hủy</option></select></td><td><select class="payment-status" data-id="${o.id}"><option value="pending" ${o.payment_status === 'pending' ? 'selected' : ''}>Chờ</option><option value="paid" ${o.payment_status === 'paid' ? 'selected' : ''}>Đã thanh toán</option><option value="failed" ${o.payment_status === 'failed' ? 'selected' : ''}>Lỗi</option><option value="refunded" ${o.payment_status === 'refunded' ? 'selected' : ''}>Hoàn tiền</option></select></td><td><input class="tracking-input" data-id="${o.id}" value="${esc(o.tracking_code || '')}" placeholder="Mã vận đơn" /></td><td><button class="btn save-order" type="button" data-id="${o.id}">Lưu</button></td></tr>`).join('')}</tbody></table></div></div>`;
    $all('.save-order').forEach((btn) => btn.onclick = async () => {
      const id = btn.dataset.id;
      try { await store.request(`/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ orderStatus: $(`.order-status[data-id="${id}"]`).value, paymentStatus: $(`.payment-status[data-id="${id}"]`).value, trackingCode: $(`.tracking-input[data-id="${id}"]`).value }) }); await loadAdminData(); renderOrders(); notify('Đã cập nhật đơn hàng.'); } catch (error) { notify(error.message, 'danger'); }
    });
  }

  async function openCustomer(id) {
    state.selectedCustomerId = id;
    state.customerDetail = await store.request(`/admin/customers/${id}`);
    renderCustomers();
  }
  function renderCustomers() {
    const detail = state.customerDetail;
    if (detail) {
      $('#tabContent').innerHTML = `<div class="customer-profile-page"><div class="card customer-detail-panel customer-profile-full"><div class="customer-detail-hero"><div class="customer-hero-main"><div class="customer-detail-avatar">${initials(detail.user.full_name)}</div><div><div class="customer-detail-title-row"><h2>${esc(detail.user.full_name)}</h2><span class="tag-pill ${esc(detail.user.customer_tag || 'new')}">${esc(detail.user.customer_tag || 'new')}</span></div><div class="muted">ID #${detail.user.id} • ${esc(detail.user.email)} • ${esc(detail.user.phone || 'Chưa có số điện thoại')}</div><div class="muted">Hạng thành viên: <strong>${esc(detail.user.membership_level || 'Member')}</strong></div></div></div><div class="customer-tag-editor"><button class="btn" id="backToCustomersBtn" type="button">Quay lại danh sách</button><select id="customerTagSelect"><option value="new" ${detail.user.customer_tag === 'new' ? 'selected' : ''}>Khách mới</option><option value="vip" ${detail.user.customer_tag === 'vip' ? 'selected' : ''}>VIP</option><option value="wholesale" ${detail.user.customer_tag === 'wholesale' ? 'selected' : ''}>Mua sỉ</option></select><button class="btn btn-primary" id="saveCustomerTagBtn">Lưu phân nhóm</button></div></div><div class="customer-kpi-grid"><div class="customer-kpi-card"><span>Tổng chi tiêu</span><strong>${store.currency(detail.user.paid_revenue)}</strong></div><div class="customer-kpi-card"><span>Số đơn hoàn tất</span><strong>${detail.user.orders_count}</strong></div><div class="customer-kpi-card"><span>Điểm tích lũy</span><strong>${Number(detail.user.points || 0).toLocaleString('vi-VN')}</strong></div><div class="customer-kpi-card"><span>Hạng thành viên</span><strong>${esc(detail.user.membership_level || 'Member')}</strong></div></div><div class="customer-detail-grid"><section class="detail-section"><div class="detail-section-head"><h3>Địa chỉ nhận hàng</h3><span>${detail.addresses.length} địa chỉ</span></div>${detail.addresses.map((a) => `<article class="detail-card"><strong>${esc(a.label || 'Địa chỉ')}</strong><div class="muted">${esc(a.recipient_name || '')} • ${esc(a.phone || '')}</div><div>${esc(formatCustomerAddress(a) || a.line1 || '')}</div></article>`).join('') || '<div class="empty-state-inline">Khách hàng này chưa có địa chỉ nào.</div>'}</section><section class="detail-section"><div class="detail-section-head"><h3>Đánh giá gần đây</h3><span>${detail.reviews.length} đánh giá</span></div>${detail.reviews.map((r) => `<article class="detail-card"><div class="list-line"><strong>${esc(r.product_name)}</strong><span class="rating-stars">${'★'.repeat(Number(r.rating || 0))}${'☆'.repeat(Math.max(0, 5 - Number(r.rating || 0)))}</span></div><div>${esc(r.comment || 'Không có nội dung')}</div></article>`).join('') || '<div class="empty-state-inline">Chưa có đánh giá nào.</div>'}</section><section class="detail-section customer-history-section"><div class="detail-section-head"><h3>Lịch sử mua hàng</h3><span>${detail.orders.length} đơn</span></div>${detail.orders.map((o) => `<article class="detail-card order-history-card"><div class="list-line"><strong>${esc(o.order_code)}</strong><span>${fmtDate(o.created_at)}</span></div><div class="muted">${store.currency(o.grand_total)} • ${esc(o.order_status)} • ${esc(o.payment_status)}</div><ul class="order-items-list">${(o.items || []).map((item) => `<li><span>${esc(item.product_name)} x${item.quantity}</span><strong>${store.currency(item.line_total)}</strong></li>`).join('') || '<li>Không có dòng hàng.</li>'}</ul></article>`).join('') || '<div class="empty-state-inline">Chưa có đơn hàng nào.</div>'}</section><section class="detail-section"><div class="detail-section-head"><h3>Thông báo đã gửi</h3><span>${detail.notifications.length} thông báo</span></div>${detail.notifications.map((n) => `<article class="detail-card"><div class="list-line"><strong>${esc(n.title)}</strong><span>${fmtDate(n.sent_at)}</span></div><div class="notification-rich-copy">${notificationPreviewHtml(n.message || '')}</div></article>`).join('') || '<div class="empty-state-inline">Chưa gửi thông báo nào.</div>'}</section></div></div></div>`;
      $('#backToCustomersBtn').onclick = () => { state.selectedCustomerId = null; state.customerDetail = null; renderCustomers(); };
      $('#saveCustomerTagBtn').onclick = async () => { try { await store.request(`/admin/customers/${state.selectedCustomerId}/tag`, { method: 'PATCH', body: JSON.stringify({ customerTag: $('#customerTagSelect').value }) }); await loadAdminData(); await openCustomer(state.selectedCustomerId); notify('Đã cập nhật phân nhóm khách hàng.'); } catch (error) { notify(error.message, 'danger'); } };
      return;
    }
    const query = (state.customerSearch || '').trim().toLowerCase();
    const customers = state.customers.filter((c) => {
      if (!query) return true;
      return [c.id, c.full_name, c.email, c.phone, c.primary_address, c.customer_tag].join(' ').toLowerCase().includes(query);
    });
    $('#tabContent').innerHTML = `<div class="customer-admin-grid"><div class="card customer-list-panel customer-list-full"><div class="customer-panel-head"><div><h2>Khách hàng</h2><p class="muted">Tra cứu nhanh hồ sơ, tổng chi tiêu, điểm và lịch sử mua hàng.</p></div><span class="customer-total-badge">${customers.length} khách</span></div><label class="customer-search-wrap"><input id="customerSearchInput" type="search" placeholder="Tìm theo tên, email, số điện thoại, tag..." value="${esc(state.customerSearch || '')}" /></label><div class="customer-card-list customer-card-grid">${customers.map((c) => `<article class="customer-card"><div class="customer-card-top"><div class="customer-avatar">${initials(c.full_name)}</div><div class="customer-card-main"><div class="customer-name-row"><strong>${esc(c.full_name)}</strong><span class="customer-id-chip">#${c.id}</span></div><div class="muted">${esc(c.email)}</div><div class="muted">${esc(c.phone || 'Chưa có số điện thoại')}</div><div class="muted">Hạng: ${esc(c.membership_level || 'Member')}</div></div><span class="tag-pill ${esc(c.customer_tag || 'new')}">${esc(c.customer_tag || 'new')}</span></div><div class="customer-card-address">${esc(c.primary_address || 'Chưa có địa chỉ nhận hàng')}</div><div class="customer-card-stats"><div><span>Điểm</span><strong>${Number(c.points || 0).toLocaleString('vi-VN')}</strong></div><div><span>Hạng</span><strong>${esc(c.membership_level || 'Member')}</strong></div><div><span>Đơn</span><strong>${c.orders_count}</strong></div><div><span>Tổng chi</span><strong>${store.currency(c.paid_revenue)}</strong></div></div><div class="customer-card-actions"><button class="btn btn-primary open-customer" data-id="${c.id}">Xem hồ sơ</button></div></article>`).join('') || '<div class="empty-state-inline">Không tìm thấy khách hàng phù hợp.</div>'}</div></div><div class="card notification-composer-card"><div class="section-title"><div><h2>Gửi thông báo cho khách hàng</h2><p class="muted">Phía khách chỉ thấy tiêu đề trong danh sách và bấm vào mới đọc nội dung chi tiết.</p></div></div><form id="customerNotificationForm" class="stack-form"><label><span>Đối tượng gửi</span><select name="audience" id="notificationAudienceSelect"><option value="all">Tất cả khách hàng</option><option value="tag">Theo nhóm khách hàng</option><option value="membership">Theo hạng thành viên</option><option value="selected">Theo mã khách hàng</option></select></label><label id="notificationTagWrap" style="display:none;"><span>Nhóm khách hàng</span><select name="customerTag"><option value="new">Khách mới</option><option value="vip">VIP</option><option value="wholesale">Mua sỉ</option></select></label><label id="notificationMembershipWrap" style="display:none;"><span>Hạng thành viên</span><select name="membershipLevel"><option value="Member">Member</option><option value="Silver">Silver</option><option value="VIP">VIP</option><option value="Wholesale">Wholesale</option></select></label><label id="notificationCodesWrap" style="display:none;"><span>Mã khách hàng / ID</span><textarea name="customerCodes" rows="3" placeholder="Ví dụ: 5, 12, 28"></textarea></label><label><span>Tiêu đề</span><input name="title" maxlength="255" required /></label><label><span>Nội dung</span><textarea name="message" id="customerNotificationMessage" rows="8" placeholder="Có thể nhập văn bản thường hoặc chèn ảnh vào nội dung."></textarea></label><div class="inline-actions"><input id="notificationImageFiles" type="file" accept="image/*" /><button class="btn" id="uploadNotificationImageBtn" type="button">Tải ảnh vào nội dung</button></div><div class="notification-rich-copy muted" id="customerNotificationHint">Sau khi tải ảnh, hệ thống sẽ chèn thẻ hình vào cuối nội dung.</div><button class="btn btn-primary" type="submit">Gửi thông báo</button></form></div></div>`;
    const searchInput = $('#customerSearchInput');
    if (searchInput) searchInput.oninput = (e) => { state.customerSearch = e.target.value || ''; renderCustomers(); };
    $all('.open-customer').forEach((btn) => btn.onclick = () => openCustomer(Number(btn.dataset.id)));
    const toggleAudience = () => {
      const audience = $('#notificationAudienceSelect')?.value || 'all';
      $('#notificationTagWrap').style.display = audience === 'tag' ? 'block' : 'none';
      $('#notificationMembershipWrap').style.display = audience === 'membership' ? 'block' : 'none';
      $('#notificationCodesWrap').style.display = audience === 'selected' ? 'block' : 'none';
    };
    $('#notificationAudienceSelect')?.addEventListener('change', toggleAudience);
    toggleAudience();
    $('#uploadNotificationImageBtn')?.addEventListener('click', async () => {
      const files = $('#notificationImageFiles')?.files;
      if (!files?.length) return notify('Hãy chọn ít nhất một ảnh.', 'warning');
      try {
        const result = await store.uploadNotificationImages(files);
        const textarea = $('#customerNotificationMessage');
        const appended = (result.files || []).map((file) => `<p><img src="${file.url}" alt="${esc(file.originalName || 'Thông báo')}" /></p>`).join('\n');
        textarea.value = `${String(textarea.value || '').trim()}${textarea.value ? '\n' : ''}${appended}`;
        $('#notificationImageFiles').value = '';
        notify('Đã chèn ảnh vào nội dung thông báo.');
      } catch (error) {
        notify(error.message, 'danger');
      }
    });
    $('#customerNotificationForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      try {
        const result = await store.request('/admin/notifications/send', {
          method: 'POST',
          body: JSON.stringify({
            audience: fd.get('audience'),
            customerTag: fd.get('customerTag'),
            membershipLevel: fd.get('membershipLevel'),
            customerCodes: fd.get('customerCodes'),
            title: fd.get('title'),
            message: fd.get('message')
          })
        });
        event.target.reset();
        toggleAudience();
        notify(`Đã gửi thông báo cho ${result.sent} khách hàng.`);
        await loadAdminData();
      } catch (error) {
        notify(error.message, 'danger');
      }
    });
  }

  function renderCoupons() {
    const detail = state.couponRecipientDetail;
    const couponValueText = (coupon) => coupon.discount_type === 'percent' ? `${coupon.value}%` : coupon.discount_type === 'free_shipping' ? 'Miễn ship' : store.currency(coupon.value);
    const couponKindLabel = (coupon) => ({ percent: 'Theo %', fixed: 'Cố định', free_shipping: 'Miễn ship' })[coupon.discount_type] || coupon.discount_type;
    const couponStatus = (coupon) => {
      const now = new Date();
      const startsAt = coupon.starts_at ? new Date(coupon.starts_at) : null;
      const endsAt = coupon.ends_at ? new Date(coupon.ends_at) : null;
      if (coupon.active === false || coupon.active === 0) return { label: 'Đang tắt', className: 'is-off' };
      if (startsAt && startsAt > now) return { label: 'Sắp mở', className: 'is-waiting' };
      if (endsAt && endsAt < now) return { label: 'Hết hạn', className: 'is-expired' };
      if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit || 0)) return { label: 'Hết lượt', className: 'is-expired' };
      return { label: 'Đang chạy', className: 'is-active' };
    };
    const usagePercent = (coupon) => coupon.usage_limit ? Math.min(100, Math.round((Number(coupon.used_count || 0) / Number(coupon.usage_limit || 1)) * 100)) : 0;
    const subTabs = [
      ['list', 'Quản lý mã giảm giá'],
      ['editor', state.editingCoupon?.id ? `Sửa ${state.editingCoupon.code}` : 'Tạo / sửa voucher'],
      ['notify', 'Gửi thông báo']
    ];
    const detailHtml = detail ? `<div class="card coupon-recipients-panel"><div class="section-title"><div><h2>Khách đã nhận voucher ${esc(detail.coupon.code)}</h2><p class="muted">Theo dõi lượt gửi, lượt đọc và hiệu quả sử dụng của voucher.</p></div><button class="btn" id="closeCouponRecipients" type="button">Đóng</button></div><div class="coupon-summary-grid"><div class="coupon-kpi"><span>Khách đã nhận</span><strong>${detail.summary.recipient_count || 0}</strong></div><div class="coupon-kpi"><span>Lượt gửi</span><strong>${detail.summary.received_notifications || 0}</strong></div><div class="coupon-kpi"><span>Lượt sử dụng</span><strong>${detail.summary.used_count || 0}</strong></div><div class="coupon-kpi"><span>Tổng giảm</span><strong>${store.currency(detail.summary.discount_total || 0)}</strong></div></div>${Number(detail.summary.usage_from_non_recipients || 0) ? `<div class="alert warning" style="margin-bottom:14px;">Có ${detail.summary.usage_from_non_recipients} lượt dùng mã từ khách không nằm trong danh sách đã gửi thông báo.</div>` : ''}<div class="table-shell coupon-table-shell"><table class="admin-table beautiful-table compact coupon-recipient-table"><thead><tr><th>Khách hàng</th><th>Liên hệ</th><th>Đã nhận</th><th>Đã đọc</th><th>Đã dùng</th><th>Doanh thu</th><th>Giảm giá</th><th>Lần dùng cuối</th></tr></thead><tbody>${detail.recipients.map((row) => `<tr><td><strong>${esc(row.full_name)}</strong><div class="muted">#${row.id} • ${esc(row.customer_tag || 'new')}</div></td><td>${esc(row.email)}<div class="muted">${esc(row.phone || 'Chưa có SĐT')}</div></td><td><strong>${row.received_count}</strong><div class="muted">${fmtDate(row.last_sent_at)}</div></td><td>${row.read_count || 0}</td><td><strong>${row.used_count || 0}</strong></td><td>${store.currency(row.used_revenue || 0)}</td><td>${store.currency(row.discount_total || 0)}</td><td>${fmtDate(row.last_used_at)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Voucher này chưa được gửi cho khách hàng nào.</td></tr>'}</tbody></table></div></div>` : '';
    const editorCoupon = state.editingCoupon || {};
    const selected = (actual, expected) => actual === expected ? 'selected' : '';
    const listHtml = `<section class="card coupon-list-card"><div class="coupon-list-head"><div><h2>Quản lý mã giảm giá</h2><p class="muted">${state.coupons.length} voucher trong hệ thống</p></div><span class="coupon-count-pill">${state.coupons.reduce((sum, c) => sum + Number(c.used_count || 0), 0)} lượt dùng</span></div><div class="table-shell coupon-table-shell"><table class="admin-table beautiful-table compact coupon-table"><thead><tr><th>Voucher</th><th>Giá trị</th><th>Điều kiện</th><th>Sử dụng</th><th>Thời hạn</th><th>Thao tác</th></tr></thead><tbody>${state.coupons.map((c) => { const status = couponStatus(c); return `<tr><td><div class="coupon-code-cell"><strong>${esc(c.code)}</strong><div class="inline-actions"><span class="coupon-type-pill">${couponKindLabel(c)}</span><span class="coupon-status ${status.className}">${status.label}</span></div></div></td><td><strong>${couponValueText(c)}</strong></td><td><div>Từ ${store.currency(c.min_order_amount)}</div><div class="muted">${c.usage_limit ? `Giới hạn ${c.usage_limit} lượt` : 'Không giới hạn lượt'}</div></td><td><div class="coupon-usage"><strong>${Number(c.used_count || 0)}${c.usage_limit ? ` / ${c.usage_limit}` : ''}</strong><span>${c.usage_limit ? `${usagePercent(c)}%` : 'Mở'}</span></div><div class="coupon-progress"><i style="width:${c.usage_limit ? usagePercent(c) : 100}%"></i></div></td><td><div>${c.ends_at ? fmtDate(c.ends_at) : 'Không giới hạn'}</div>${c.starts_at ? `<div class="muted">Từ ${fmtDate(c.starts_at)}</div>` : ''}</td><td><div class="coupon-actions"><button class="btn edit-coupon" data-id="${c.id}" type="button">Sửa</button><button class="btn view-coupon-recipients" data-id="${c.id}" type="button">Người nhận</button></div></td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Chưa có voucher nào.</td></tr>'}</tbody></table></div></section>`;
    const editorHtml = `<section class="card coupon-editor-card"><div class="coupon-list-head"><div><h2 id="couponFormTitle">${editorCoupon.id ? `Sửa voucher ${esc(editorCoupon.code)}` : 'Tạo voucher mới'}</h2><p class="muted">Thiết lập loại giảm, giới hạn dùng và thời gian hiệu lực.</p></div>${editorCoupon.id ? '<button class="btn" id="newCouponBtn" type="button">Tạo mới</button>' : ''}</div><form id="couponForm" class="stack-form"><input type="hidden" name="id" value="${editorCoupon.id || ''}" /><div class="form-grid-2"><label><span>Mã voucher</span><input name="code" value="${esc(editorCoupon.code || '')}" required /></label><label><span>Loại giảm giá</span><select name="discountType"><option value="percent" ${selected(editorCoupon.discount_type || 'percent', 'percent')}>Theo %</option><option value="fixed" ${selected(editorCoupon.discount_type, 'fixed')}>Số tiền cố định</option><option value="free_shipping" ${selected(editorCoupon.discount_type, 'free_shipping')}>Miễn phí vận chuyển</option></select></label></div><div class="form-grid-2"><label><span>Giá trị</span><input type="number" name="value" min="0" value="${editorCoupon.value || ''}" /></label><label><span>Đơn tối thiểu</span><input type="number" name="minOrderAmount" min="0" value="${editorCoupon.min_order_amount || 0}" /></label></div><div class="form-grid-2"><label><span>Giới hạn dùng</span><input type="number" name="usageLimit" min="0" value="${editorCoupon.usage_limit || ''}" /></label><label><span>Hoạt động</span><select name="active"><option value="1" ${editorCoupon.active === false || editorCoupon.active === 0 ? '' : 'selected'}>Bật</option><option value="0" ${editorCoupon.active === false || editorCoupon.active === 0 ? 'selected' : ''}>Tắt</option></select></label></div><div class="form-grid-2"><label><span>Bắt đầu</span><input type="datetime-local" name="startsAt" value="${editorCoupon.starts_at ? String(editorCoupon.starts_at).slice(0,16) : ''}" /></label><label><span>Kết thúc</span><input type="datetime-local" name="endsAt" value="${editorCoupon.ends_at ? String(editorCoupon.ends_at).slice(0,16) : ''}" /></label></div><div class="inline-actions"><button class="btn btn-primary" type="submit">${editorCoupon.id ? 'Lưu thay đổi' : 'Tạo voucher'}</button><button class="btn" type="button" id="resetCouponForm">Làm mới</button></div></form></section>`;
    const notifyHtml = `<section class="card coupon-editor-card"><h2>Gửi thông báo voucher</h2><p class="muted">Chọn voucher và nhóm khách hàng cần nhận thông báo.</p><form id="couponNotifyForm" class="stack-form"><label><span>Chọn voucher</span><select name="couponId">${state.coupons.map((c) => `<option value="${c.id}">${c.code}</option>`).join('')}</select></label><label><span>Đối tượng gửi</span><select name="audience" id="couponAudienceSelect"><option value="vip">Tất cả khách VIP</option><option value="all">Tất cả khách hàng</option><option value="selected">Khách chọn riêng</option><option value="points">Khách có điểm tích lũy từ...</option></select></label><label id="userIdsWrap" style="display:none;"><span>ID khách hàng riêng</span><input name="userIds" placeholder="Ví dụ: 5, 12, 28" /></label><label id="minPointsWrap" style="display:none;"><span>Điểm tích lũy tối thiểu</span><input name="minPoints" type="number" min="0" placeholder="Ví dụ: 5000" /></label><label><span>Nội dung thông báo</span><textarea name="message" placeholder="Bạn nhận được voucher mới từ cửa hàng"></textarea></label><button class="btn btn-primary" type="submit">Gửi thông báo</button></form></section>`;
    const contentHtml = state.couponSubTab === 'editor' ? editorHtml : state.couponSubTab === 'notify' ? notifyHtml : `${listHtml}${detailHtml}`;
    $('#tabContent').innerHTML = `<div class="coupon-page"><div class="coupon-subtabs">${subTabs.map(([id, label]) => `<button class="btn ${state.couponSubTab === id ? 'btn-primary' : ''}" type="button" data-coupon-subtab="${id}">${label}</button>`).join('')}</div>${contentHtml}</div>`;
    $all('[data-coupon-subtab]').forEach((btn) => btn.onclick = () => { state.couponSubTab = btn.dataset.couponSubtab; if (state.couponSubTab !== 'list') state.couponRecipientDetail = null; renderCoupons(); });
    $all('.edit-coupon').forEach((btn) => btn.onclick = () => { state.editingCoupon = state.coupons.find((c) => c.id === Number(btn.dataset.id)) || null; state.couponSubTab = 'editor'; state.couponRecipientDetail = null; renderCoupons(); });
    $all('.view-coupon-recipients').forEach((btn) => btn.onclick = async () => {
      try {
        state.couponRecipientDetail = await store.request(`/admin/coupons/${btn.dataset.id}/recipients`);
        renderCoupons();
      } catch (error) {
        notify(error.message, 'danger');
      }
    });
    if ($('#closeCouponRecipients')) $('#closeCouponRecipients').onclick = () => { state.couponRecipientDetail = null; renderCoupons(); };
    if ($('#newCouponBtn')) $('#newCouponBtn').onclick = () => { state.editingCoupon = null; renderCoupons(); };
    if ($('#resetCouponForm')) $('#resetCouponForm').onclick = () => { state.editingCoupon = null; renderCoupons(); };
    if ($('#couponForm')) $('#couponForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const id = fd.get('id');
      const discountType = fd.get('discountType');
      const value = Number(fd.get('value') || 0);
      const minOrderAmount = Number(fd.get('minOrderAmount') || 0);
      const usageLimit = fd.get('usageLimit') ? Number(fd.get('usageLimit')) : null;
      if (discountType === 'percent' && (value <= 0 || value > 100)) return notify('Voucher phần trăm phải lớn hơn 0% và không được vượt quá 100%.', 'warning');
      if (discountType === 'fixed' && value <= 0) return notify('Giá trị voucher phải lớn hơn 0.', 'warning');
      if (discountType === 'fixed' && minOrderAmount > 0 && value > minOrderAmount) return notify('Giá trị voucher không được lớn hơn đơn tối thiểu.', 'warning');
      if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit <= 0)) return notify('Giới hạn dùng phải là số nguyên lớn hơn 0.', 'warning');
      const payload = { code: String(fd.get('code') || '').trim(), discountType, value, minOrderAmount, usageLimit, startsAt: fd.get('startsAt') || null, endsAt: fd.get('endsAt') || null, active: fd.get('active') === '1' };
      try { await store.request(id ? `/admin/coupons/${id}` : '/admin/coupons', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); await loadAdminData(); state.editingCoupon = null; state.couponSubTab = 'list'; renderCoupons(); notify('Đã lưu voucher.'); } catch (error) { notify(error.message, 'danger'); }
    };
    function toggleNotifyAudience() {
      const audience = $('#couponAudienceSelect').value;
      $('#userIdsWrap').style.display = audience === 'selected' ? 'block' : 'none';
      $('#minPointsWrap').style.display = audience === 'points' ? 'block' : 'none';
    }
    if ($('#couponAudienceSelect')) {
      $('#couponAudienceSelect').onchange = toggleNotifyAudience;
      toggleNotifyAudience();
    }
    if ($('#couponNotifyForm')) $('#couponNotifyForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const userIds = String(fd.get('userIds') || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
      try {
        const couponId = fd.get('couponId');
        const result = await store.request(`/admin/coupons/${couponId}/notify`, { method: 'POST', body: JSON.stringify({ audience: fd.get('audience'), userIds, minPoints: Number(fd.get('minPoints') || 0), message: fd.get('message') }) });
        if (state.couponRecipientDetail?.coupon?.id === Number(couponId)) state.couponRecipientDetail = await store.request(`/admin/coupons/${couponId}/recipients`);
        notify(`Đã gửi thông báo cho ${result.sent} khách hàng.`);
        renderCoupons();
      } catch (error) { notify(error.message, 'danger'); }
    };
  }

  function renderContent() {
    const subTabs = [
      ['banners', 'Quản lý banner'],
      ['bannerForm', state.editingBanner?.id ? `Sửa banner` : 'Tạo / sửa banner'],
      ['posts', 'Quản lý blog'],
      ['postForm', state.editingPost?.id ? `Sửa bài viết` : 'Tạo / sửa blog']
    ];
    const selected = (actual, expected) => actual === expected ? 'selected' : '';
    const banner = state.editingBanner || {};
    const post = state.editingPost || {};
    const activeValue = (item) => item.active === false || item.active === 0 ? '0' : '1';
    const bannerListHtml = `<section class="card content-list-card"><div class="content-list-head"><div><h2>Banner trang chủ</h2><p class="muted">${state.banners.length} banner đang có trong hệ thống.</p></div><button class="btn btn-primary" id="newBannerFromList" type="button">Thêm banner</button></div><div class="table-shell content-table-shell"><table class="admin-table beautiful-table compact content-table"><thead><tr><th>Banner</th><th>Link</th><th>Thứ tự</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${state.banners.map((b) => `<tr><td><div class="content-media-cell"><img src="${store.resolveMediaUrl(b.image_url || '')}" onerror="this.style.display='none'" /><div><strong>${esc(b.title)}</strong><div class="muted">${esc(b.subtitle || 'Không có phụ đề')}</div></div></div></td><td>${esc(b.href || '-')}</td><td>${Number(b.sort_order || 0)}</td><td><span class="content-status ${activeValue(b) === '1' ? 'is-active' : 'is-off'}">${activeValue(b) === '1' ? 'Đang bật' : 'Đang tắt'}</span></td><td><button class="btn edit-banner" data-id="${b.id}" type="button">Sửa</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Chưa có banner.</td></tr>'}</tbody></table></div></section>`;
    const bannerFormHtml = `<section class="card content-editor-card"><div class="content-list-head"><div><h2>${banner.id ? `Sửa banner ${esc(banner.title)}` : 'Tạo banner mới'}</h2><p class="muted">Ảnh banner sẽ hiển thị ở đầu trang chủ.</p></div>${banner.id ? '<button class="btn" id="newBannerBtn" type="button">Tạo mới</button>' : ''}</div><form id="bannerForm" class="stack-form"><input type="hidden" name="id" value="${banner.id || ''}" /><div class="form-grid-2"><label><span>Tiêu đề</span><input name="title" value="${esc(banner.title || '')}" required /></label><label><span>Link đích</span><input name="href" value="${esc(banner.href || '')}" /></label></div><label><span>Phụ đề</span><input name="subtitle" value="${esc(banner.subtitle || '')}" /></label><div class="inline-actions"><input id="bannerImageFiles" type="file" accept="image/*" /><button class="btn" type="button" id="uploadBannerBtn">Tải ảnh banner</button></div><input type="hidden" name="imageUrl" value="${esc(banner.image_url || '')}" /><div id="bannerPreview" class="muted">${banner.image_url ? `<img src="${store.resolveMediaUrl(banner.image_url)}" style="width:100%;max-width:360px;height:160px;object-fit:cover;border-radius:8px;" />` : 'Chưa có ảnh banner.'}</div><div class="form-grid-2"><label><span>Thứ tự</span><input type="number" name="sortOrder" value="${Number(banner.sort_order || 0)}" /></label><label><span>Hoạt động</span><select name="active"><option value="1" ${selected(activeValue(banner), '1')}>Bật</option><option value="0" ${selected(activeValue(banner), '0')}>Tắt</option></select></label></div><div class="inline-actions"><button class="btn btn-primary" type="submit">${banner.id ? 'Lưu thay đổi' : 'Tạo banner'}</button><button class="btn" id="resetBannerForm" type="button">Làm mới</button></div></form></section>`;
    const postListHtml = `<section class="card content-list-card"><div class="content-list-head"><div><h2>Bài viết blog</h2><p class="muted">${state.posts.length} bài viết trong hệ thống.</p></div><button class="btn btn-primary" id="newPostFromList" type="button">Thêm bài viết</button></div><div class="table-shell content-table-shell"><table class="admin-table beautiful-table compact content-table"><thead><tr><th>Bài viết</th><th>Ngày đăng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${state.posts.map((p) => `<tr><td><div class="content-media-cell"><img src="${store.resolveMediaUrl(p.cover_image || '')}" onerror="this.style.display='none'" /><div><strong>${esc(p.title)}</strong><div class="muted">${esc(p.excerpt || 'Không có tóm tắt')}</div></div></div></td><td>${fmtDate(p.published_at)}</td><td><span class="content-status ${activeValue(p) === '1' ? 'is-active' : 'is-off'}">${activeValue(p) === '1' ? 'Đang bật' : 'Đang tắt'}</span></td><td><button class="btn edit-post" data-id="${p.id}" type="button">Sửa</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Chưa có bài viết.</td></tr>'}</tbody></table></div></section>`;
    const postFormHtml = `<section class="card content-editor-card"><div class="content-list-head"><div><h2>${post.id ? `Sửa bài viết ${esc(post.title)}` : 'Tạo bài viết mới'}</h2><p class="muted">Bài viết sẽ xuất hiện trong khu vực cẩm nang và tin tức.</p></div>${post.id ? '<button class="btn" id="newPostBtn" type="button">Tạo mới</button>' : ''}</div><form id="postForm" class="stack-form"><input type="hidden" name="id" value="${post.id || ''}" /><label><span>Tiêu đề</span><input name="title" value="${esc(post.title || '')}" required /></label><label><span>Tóm tắt</span><textarea name="excerpt">${esc(post.excerpt || '')}</textarea></label><div class="inline-actions"><input id="postImageFiles" type="file" accept="image/*" /><button class="btn" type="button" id="uploadPostBtn">Tải ảnh cover</button></div><input type="hidden" name="coverImage" value="${esc(post.cover_image || '')}" /><div id="postPreview" class="muted">${post.cover_image ? `<img src="${store.resolveMediaUrl(post.cover_image)}" style="width:100%;max-width:360px;height:180px;object-fit:cover;border-radius:8px;" />` : 'Chưa có ảnh cover.'}</div><label><span>Nội dung</span><textarea name="content" rows="8">${esc(post.content || '')}</textarea></label><div class="form-grid-2"><label><span>Ngày đăng</span><input type="datetime-local" name="publishedAt" value="${post.published_at ? String(post.published_at).slice(0,16) : ''}" /></label><label><span>Hoạt động</span><select name="active"><option value="1" ${selected(activeValue(post), '1')}>Bật</option><option value="0" ${selected(activeValue(post), '0')}>Tắt</option></select></label></div><div class="inline-actions"><button class="btn btn-primary" type="submit">${post.id ? 'Lưu thay đổi' : 'Tạo bài viết'}</button><button class="btn" id="resetPostForm" type="button">Làm mới</button></div></form></section>`;
    const contentHtml = state.contentSubTab === 'bannerForm' ? bannerFormHtml : state.contentSubTab === 'posts' ? postListHtml : state.contentSubTab === 'postForm' ? postFormHtml : bannerListHtml;
    $('#tabContent').innerHTML = `<div class="content-page"><div class="content-subtabs">${subTabs.map(([id, label]) => `<button class="btn ${state.contentSubTab === id ? 'btn-primary' : ''}" type="button" data-content-subtab="${id}">${label}</button>`).join('')}</div>${contentHtml}</div>`;
    const setBannerPreview = (url) => { if (!$('#bannerForm')) return; getField($('#bannerForm'), 'imageUrl').value = url || ''; $('#bannerPreview').innerHTML = url ? `<img src="${store.resolveMediaUrl(url)}" style="width:100%;max-width:360px;height:160px;object-fit:cover;border-radius:8px;" />` : 'Chưa có ảnh banner.'; };
    const setPostPreview = (url) => { if (!$('#postForm')) return; getField($('#postForm'), 'coverImage').value = url || ''; $('#postPreview').innerHTML = url ? `<img src="${store.resolveMediaUrl(url)}" style="width:100%;max-width:360px;height:180px;object-fit:cover;border-radius:8px;" />` : 'Chưa có ảnh cover.'; };
    $all('[data-content-subtab]').forEach((btn) => btn.onclick = () => { state.contentSubTab = btn.dataset.contentSubtab; renderContent(); });
    if ($('#newBannerFromList')) $('#newBannerFromList').onclick = () => { state.editingBanner = null; state.contentSubTab = 'bannerForm'; renderContent(); };
    if ($('#newPostFromList')) $('#newPostFromList').onclick = () => { state.editingPost = null; state.contentSubTab = 'postForm'; renderContent(); };
    if ($('#newBannerBtn')) $('#newBannerBtn').onclick = () => { state.editingBanner = null; renderContent(); };
    if ($('#newPostBtn')) $('#newPostBtn').onclick = () => { state.editingPost = null; renderContent(); };
    if ($('#resetBannerForm')) $('#resetBannerForm').onclick = () => { state.editingBanner = null; renderContent(); };
    if ($('#resetPostForm')) $('#resetPostForm').onclick = () => { state.editingPost = null; renderContent(); };
    if ($('#uploadBannerBtn')) $('#uploadBannerBtn').onclick = async () => { try { const result = await store.uploadBannerImages($('#bannerImageFiles').files); setBannerPreview(result.files?.[0]?.url || ''); notify('Đã tải banner.'); } catch (error) { notify(error.message, 'danger'); } };
    if ($('#uploadPostBtn')) $('#uploadPostBtn').onclick = async () => { try { const result = await store.uploadBlogImages($('#postImageFiles').files); setPostPreview(result.files?.[0]?.url || ''); notify('Đã tải ảnh blog.'); } catch (error) { notify(error.message, 'danger'); } };
    $all('.edit-banner').forEach((btn) => btn.onclick = () => { state.editingBanner = state.banners.find((x) => x.id === Number(btn.dataset.id)) || null; state.contentSubTab = 'bannerForm'; renderContent(); });
    $all('.edit-post').forEach((btn) => btn.onclick = () => { state.editingPost = state.posts.find((x) => x.id === Number(btn.dataset.id)) || null; state.contentSubTab = 'postForm'; renderContent(); });
    if ($('#bannerForm')) $('#bannerForm').onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(e.target); const id = fd.get('id'); const payload = { title: fd.get('title'), subtitle: fd.get('subtitle'), href: fd.get('href'), imageUrl: fd.get('imageUrl'), sortOrder: Number(fd.get('sortOrder') || 0), active: fd.get('active') === '1' }; try { await store.request(id ? `/admin/content/banners/${id}` : '/admin/content/banners', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); await loadAdminData(); state.editingBanner = null; state.contentSubTab = 'banners'; renderContent(); notify('Đã lưu banner.'); } catch (error) { notify(error.message, 'danger'); } };
    if ($('#postForm')) $('#postForm').onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(e.target); const id = fd.get('id'); const payload = { title: fd.get('title'), excerpt: fd.get('excerpt'), content: fd.get('content'), coverImage: fd.get('coverImage'), publishedAt: fd.get('publishedAt') || null, active: fd.get('active') === '1' }; try { await store.request(id ? `/admin/content/posts/${id}` : '/admin/content/posts', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); await loadAdminData(); state.editingPost = null; state.contentSubTab = 'posts'; renderContent(); notify('Đã lưu bài viết.'); } catch (error) { notify(error.message, 'danger'); } };
  }

  function renderInventory() {
    $('#tabContent').innerHTML = `<div class="grid-2"><div class="card" style="padding:18px;"><h2>Nhập kho</h2><form id="inventoryForm" class="stack-form"><label><span>Chọn sản phẩm</span><select name="productId" id="inventoryProductSelect">${state.products.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.sku)})</option>`).join('')}</select></label><label><span>Biến thể (nếu có)</span><select name="variantId" id="inventoryVariantSelect"><option value="">Không chọn biến thể</option></select></label><div class="form-grid-2"><label><span>Số lượng thêm</span><input type="number" name="quantity" min="1" value="1" required /></label><label><span>Ghi chú</span><input name="note" placeholder="Nhập từ nhà cung cấp" /></label></div><button class="btn btn-primary" type="submit">Cộng tồn kho</button></form></div><div class="card" style="padding:18px;"><h2>Tồn hiện tại</h2><table class="admin-table beautiful-table compact"><thead><tr><th>Sản phẩm</th><th>Tồn kho</th><th>Biến thể</th></tr></thead><tbody>${state.products.slice(0, 30).map((p) => `<tr><td>${esc(p.name)}</td><td>${p.stock_total}</td><td>${p.variants_count || 0}</td></tr>`).join('')}</tbody></table></div></div>`;
    async function populateVariants() {
      const productId = Number($('#inventoryProductSelect').value);
      const product = await store.request(`/admin/products/${productId}`);
      $('#inventoryVariantSelect').innerHTML = `<option value="">Không chọn biến thể</option>${(product.variants || []).map((v) => `<option value="${v.id}">${esc(v.weight || '-')} • ${esc(v.tip_size || '-') || '-'} • tồn ${v.stock}</option>`).join('')}`;
    }
    $('#inventoryProductSelect').onchange = populateVariants;
    populateVariants();
    $('#inventoryForm').onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await store.request('/admin/inventory/restock', { method: 'POST', body: JSON.stringify({ productId: Number(fd.get('productId')), variantId: fd.get('variantId') ? Number(fd.get('variantId')) : null, quantity: Number(fd.get('quantity')), note: fd.get('note') }) }); await loadAdminData(); renderInventory(); notify('Đã cộng tồn kho.'); } catch (error) { notify(error.message, 'danger'); } };
  }

  function renderReviews() {
    $('#tabContent').innerHTML = `<div class="card" style="padding:18px;"><div class="section-title"><h2>Đánh giá khách hàng</h2></div><div class="table-shell"><table class="admin-table beautiful-table compact"><thead><tr><th>Khách</th><th>Sản phẩm</th><th>Điểm</th><th>Nội dung</th><th>Ngày</th><th>Hiển thị</th></tr></thead><tbody>${state.reviews.map((r) => `<tr><td><strong>${esc(r.full_name)}</strong><div class="muted">${esc(r.email)}</div></td><td>${esc(r.product_name)}</td><td>${r.rating}/5</td><td>${esc(r.comment || '')}</td><td>${fmtDate(r.created_at)}</td><td><button class="btn ${r.is_visible ? 'btn-danger' : 'btn-primary'} toggle-review" data-id="${r.id}" data-visible="${r.is_visible ? '1' : '0'}">${r.is_visible ? 'Ẩn' : 'Hiện'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có đánh giá.</td></tr>'}</tbody></table></div></div>`;
    $all('.toggle-review').forEach((btn) => btn.onclick = async () => { const next = btn.dataset.visible !== '1'; try { await store.request(`/admin/reviews/${btn.dataset.id}/visibility`, { method: 'PATCH', body: JSON.stringify({ isVisible: next }) }); await loadAdminData(); renderReviews(); notify('Đã cập nhật trạng thái đánh giá.'); } catch (error) { notify(error.message, 'danger'); } });
  }

  function renderSettings() {
    $('#tabContent').innerHTML = `<div class="card" style="padding:18px;"><div class="section-title"><h2>Cài đặt chung</h2></div><form id="settingsForm" class="stack-form"><div class="form-grid-2"><label><span>Tên website</span><input name="siteName" value="${esc(state.settings.siteName || '')}" /></label><label><span>Hotline</span><input name="hotline" value="${esc(state.settings.hotline || '')}" /></label></div><div class="form-grid-2"><label><span>Zalo</span><input name="zalo" value="${esc(state.settings.zalo || '')}" /></label><label><span>Messenger</span><input name="messenger" value="${esc(state.settings.messenger || '')}" /></label></div><label><span>Showroom</span><input name="showroom" value="${esc(state.settings.showroom || '')}" /></label><div class="form-grid-3"><label><span>Mã ngân hàng QR</span><input name="bankCode" value="${esc(state.settings.bank?.bankCode || 'MB')}" placeholder="MB, VCB, ACB..." /></label><label><span>Số tài khoản QR</span><input name="bankAccountNo" value="${esc(state.settings.bank?.accountNo || '')}" /></label><label><span>Chủ tài khoản</span><input name="bankAccountName" value="${esc(state.settings.bank?.accountName || '')}" /></label></div><div class="form-grid-2"><label><span>Phí ship chuẩn</span><input name="shippingStandard" type="number" value="${state.settings.shipping?.standard || 45000}" /></label><label><span>Miễn phí từ</span><input name="shippingFreeFrom" type="number" value="${state.settings.shipping?.freeFrom || 5000000}" /></label></div><label><span>Chính sách bảo hành</span><textarea name="warrantyPolicy">${esc(state.settings.warrantyPolicy || '')}</textarea></label><label><span>Chính sách đổi trả</span><textarea name="returnPolicy">${esc(state.settings.returnPolicy || '')}</textarea></label><label><span>Chính sách vận chuyển</span><textarea name="shippingPolicy">${esc(state.settings.shippingPolicy || '')}</textarea></label><button class="btn btn-primary" type="submit">Lưu cài đặt</button></form></div>`;
    $('#settingsForm').onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(e.target); const payload = { siteName: fd.get('siteName'), hotline: fd.get('hotline'), zalo: fd.get('zalo'), messenger: fd.get('messenger'), showroom: fd.get('showroom'), bank: { bankCode: fd.get('bankCode'), accountNo: fd.get('bankAccountNo'), accountName: fd.get('bankAccountName') }, shipping: { standard: Number(fd.get('shippingStandard') || 45000), freeFrom: Number(fd.get('shippingFreeFrom') || 5000000) }, warrantyPolicy: fd.get('warrantyPolicy'), returnPolicy: fd.get('returnPolicy'), shippingPolicy: fd.get('shippingPolicy') }; try { await store.request('/admin/settings/general', { method: 'PUT', body: JSON.stringify(payload) }); await loadAdminData(); renderSettings(); notify('Đã lưu cài đặt.'); } catch (error) { notify(error.message, 'danger'); } };
  }

  bootstrap();
})();
