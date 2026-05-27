(function () {
  const store = window.BidaStore;
  const page = document.body.dataset.page;
  const app = document.getElementById('app');
  const state = { settings: null, categories: [], products: [], banners: [], posts: [], coupons: [], me: null, cart: { items: [], summary: { totalQuantity: 0 } } };

  function $(s, p) { return (p || document).querySelector(s); }
  function $all(s, p) { return Array.from((p || document).querySelectorAll(s)); }
  function param(name) { return new URLSearchParams(location.search).get(name); }
  function fmtDate(v) { return v ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(v)) : '-'; }
  function stars(n) { const x = Math.round(Number(n || 0)); return '★'.repeat(x) + '☆'.repeat(Math.max(0, 5 - x)); }
  function notify(text, type) {
    const node = document.createElement('div');
    node.className = `alert ${type || 'success'}`;
    node.style.position = 'fixed';
    node.style.left = '50%';
    node.style.bottom = '24px';
    node.style.transform = 'translateX(-50%)';
    node.style.zIndex = '120';
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2400);
  }
  function isValidFullName(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    return text.length >= 2 && !/\d/.test(text);
  }

  function isValidGmail(value) {
    return /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(String(value || '').trim());
  }

  function getReviewError(values) {
    const rating = Number(values.rating || 0);
    const comment = String(values.comment || '').trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'Điểm đánh giá phải từ 1 đến 5 sao.';
    if (comment.length < 10) return 'Nhận xét phải có ít nhất 10 ký tự.';
    if (comment.length > 500) return 'Nhận xét không được vượt quá 500 ký tự.';
    if (/(.)\1{9,}/i.test(comment)) return 'Nhận xét không được lặp ký tự quá nhiều.';
    return null;
  }

  function bankSettings() {
    return {
      bankCode: String(state.settings?.bank?.bankCode || 'MB').trim(),
      accountNo: String(state.settings?.bank?.accountNo || '0909123456').trim(),
      accountName: String(state.settings?.bank?.accountName || 'BIDA PRO SHOP').trim()
    };
  }

  function buildBankQrUrl(order) {
    const bank = bankSettings();
    if (bank.bankCode && bank.accountNo) {
      const amount = Math.max(0, Math.round(Number(order?.grand_total || 0)));
      const content = `Thanh toan ${order?.order_code || 'BIDA'}`;
      return `https://img.vietqr.io/image/${encodeURIComponent(bank.bankCode)}-${encodeURIComponent(bank.accountNo)}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(bank.accountName)}`;
    }
    return state.settings?.bankQr || '';
  }

  function bankTransferHtml(order) {
    if (order?.payment_method !== 'bank_transfer') return '';
    const bank = bankSettings();
    const qrUrl = buildBankQrUrl(order);
    return `<div class="qr-box" style="margin-top:18px;">
      <h3>Thanh toán chuyển khoản</h3>
      ${qrUrl ? `<img src="${qrUrl}" alt="QR chuyển khoản đơn ${order.order_code}" loading="lazy" />` : '<div class="alert warning">Chưa cấu hình ảnh QR ngân hàng.</div>'}
      <div class="kpi-list">
        <div class="list-line"><span>Ngân hàng</span><strong>${bank.bankCode}</strong></div>
        <div class="list-line"><span>Số tài khoản</span><strong>${bank.accountNo}</strong></div>
        <div class="list-line"><span>Chủ tài khoản</span><strong>${bank.accountName}</strong></div>
        <div class="list-line"><span>Số tiền</span><strong>${store.currency(order.grand_total)}</strong></div>
        <div class="list-line"><span>Nội dung</span><strong>Thanh toan ${order.order_code}</strong></div>
      </div>
      <p class="muted">Sau khi chuyển khoản, cửa hàng sẽ kiểm tra và cập nhật trạng thái thanh toán.</p>
    </div>`;
  }

  function getRegisterErrors(values) {
  const errors = {};

  const fullName = String(values.fullName || '').trim();
  const email = String(values.email || '').trim();
  const phone = normalizePhone(values.phone || '');
  const password = String(values.password || '');
  const confirmPassword = String(values.confirmPassword || '');

  if (!fullName) errors.fullName = 'Vui lòng nhập họ tên.';
  else if (!isValidFullName(fullName)) errors.fullName = 'Họ tên phải có ít nhất 2 ký tự và không được chứa số.';

  if (!email) errors.email = 'Vui lòng nhập email.';
  else if (!isValidGmail(email)) errors.email = 'Vui lòng dùng đúng địa chỉ Gmail, ví dụ tenban@gmail.com.';

  if (!phone) {
    errors.phone = 'Vui lòng nhập số điện thoại.';
  } else if (!/^0\d{9}$/.test(phone)) {
    errors.phone = 'Số điện thoại phải gồm 10 số và bắt đầu bằng 0.';
  }


  if (!password) {
    errors.password = 'Vui lòng nhập mật khẩu.';
  } else if (!isStrongPassword(password)) {
    errors.password = 'Mật khẩu phải từ 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt.';
  }

  if (!confirmPassword) {
    errors.confirmPassword = 'Vui lòng nhập lại mật khẩu.';
  } else if (confirmPassword !== password) {
    errors.confirmPassword = 'Mật khẩu nhập lại không khớp.';
  }

  return errors;
}

function setFieldError(form, fieldName, message) {
  const input = form.querySelector(`[name="${fieldName}"]`);
  const error = form.querySelector(`[data-error-for="${fieldName}"]`);
  if (!input || !error) return;

  input.classList.toggle('input-error', Boolean(message));
  error.textContent = message || '';
}

function applyRegisterErrors(form, errors) {
  const fields = ['fullName', 'email', 'phone', 'password', 'confirmPassword'];
  fields.forEach((field) => setFieldError(form, field, errors[field] || ''));
  return Object.keys(errors).length === 0;
}

function readRegisterValues(form) {
  return {
    fullName: form.fullName.value,
    email: form.email.value,
    phone: form.phone.value,
    password: form.password.value,
    confirmPassword: form.confirmPassword.value
  };
}

function bindRegisterLiveValidation(form) {
  const fields = ['fullName', 'email', 'phone', 'password', 'confirmPassword'];

  fields.forEach((field) => {
    const input = form.querySelector(`[name="${field}"]`);
    if (!input) return;

    input.addEventListener('input', () => {
      const errors = getRegisterErrors(readRegisterValues(form));
      applyRegisterErrors(form, errors);
    });

    input.addEventListener('blur', () => {
      const errors = getRegisterErrors(readRegisterValues(form));
      applyRegisterErrors(form, errors);
    });
  });
}
  function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  }

  function isStrongPassword(password) {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(String(password || ''));
  }
  function placeholderImage(label = 'Bida') {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" fill="#64748b">${label}</text></svg>`)}`;
  }

  function normalizeImageUrl(url, fallbackLabel = 'Bida') {
    const value = String(url || '').trim().replace(/\\/g, '/');
    if (!value) return placeholderImage(fallbackLabel);
    return store.resolveMediaUrl(value) || placeholderImage(fallbackLabel);
  }


  function applyImageFallback(root = document) {
    $all('img[data-fallback-src]', root).forEach((img) => {
      img.onerror = () => {
        img.onerror = null;
        img.src = img.dataset.fallbackSrc;
      };
    });
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function validateCheckoutForm(fd) {
    const fullName = String(fd.get('fullName') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const phone = normalizePhone(fd.get('phone'));
    const line1 = String(fd.get('line1') || '').trim();
    const district = String(fd.get('district') || '').trim();
    const city = String(fd.get('city') || '').trim();
    const paymentMethod = String(fd.get('paymentMethod') || '').trim();

    if (!isValidFullName(fullName)) return 'Họ tên phải có ít nhất 2 ký tự và không được chứa số.';
    if (!isValidGmail(email)) return 'Vui lòng dùng đúng địa chỉ Gmail, ví dụ tenban@gmail.com.';
    if (!/^0\d{9}$/.test(phone)) return 'Số điện thoại phải gồm đúng 10 số và bắt đầu bằng 0.';
    if (!line1) return 'Vui lòng nhập địa chỉ giao hàng.';
    if (!district) return 'Vui lòng nhập quận/huyện.';
    if (!city) return 'Vui lòng nhập tỉnh/thành phố.';
    if (!['cod', 'bank_transfer', 'vnpay', 'momo'].includes(paymentMethod)) return 'Phương thức thanh toán không hợp lệ.';
    return null;
  }

  function parseCouponDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function evaluateCoupon(code, subtotal) {
    const couponCode = String(code || '').trim().toUpperCase();
    if (!couponCode) return { code: '', discount: 0, shippingOverride: null, valid: true, message: '' };
    const coupon = (state.coupons || []).find((item) => String(item.code || '').toUpperCase() === couponCode);
    if (!coupon) return { code: couponCode, discount: 0, shippingOverride: null, valid: false, message: 'Mã giảm giá không tồn tại.' };
    const now = new Date();
    const startsAt = parseCouponDate(coupon.starts_at);
    const endsAt = parseCouponDate(coupon.ends_at);
    if (startsAt && startsAt > now) return { code: couponCode, discount: 0, shippingOverride: null, valid: false, message: 'Voucher chưa đến thời gian sử dụng.' };
    if (endsAt && endsAt < now) return { code: couponCode, discount: 0, shippingOverride: null, valid: false, message: 'Voucher đã hết hạn.' };
    if (Number(coupon.min_order_amount || 0) > subtotal) return { code: couponCode, discount: 0, shippingOverride: null, valid: false, message: `Đơn hàng phải từ ${store.currency(coupon.min_order_amount)} để dùng voucher này.` };
    if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit || 0)) return { code: couponCode, discount: 0, shippingOverride: null, valid: false, message: 'Voucher đã hết lượt sử dụng.' };
    if (coupon.discount_type === 'percent') {
      const percentValue = Number(coupon.value || 0);
      if (percentValue <= 0 || percentValue > 100) return { code: couponCode, discount: 0, shippingOverride: null, valid: false, message: 'Voucher phần trăm phải lớn hơn 0% và không được vượt quá 100%.' };
      const discount = Math.min(subtotal, Math.round((subtotal * percentValue) / 100));
      return { code: couponCode, discount, shippingOverride: null, valid: true, message: `Áp dụng ${Number(coupon.value || 0)}% giảm giá.` };
    }
    if (coupon.discount_type === 'free_shipping') {
      return { code: couponCode, discount: 0, shippingOverride: 0, valid: true, message: 'Áp dụng miễn phí vận chuyển.' };
    }
    const fixedValue = Number(coupon.value || 0);
    if (fixedValue <= 0) return { code: couponCode, discount: 0, shippingOverride: null, valid: false, message: 'Giá trị voucher phải lớn hơn 0.' };
    if (fixedValue > subtotal) return { code: couponCode, discount: 0, shippingOverride: null, valid: false, message: 'Giá trị mã giảm giá không được lớn hơn giá trị đơn hàng.' };
    const discount = fixedValue;
    return { code: couponCode, discount, shippingOverride: null, valid: true, message: `Giảm ${store.currency(discount)} cho đơn hàng.` };
  }

  async function bootstrap() {
    try {
      const me = await store.getMeSafe();
      if (me) {
        try {
          await store.mergeGuestCart();
        } catch {}
      }
      const [settings, categories, products, banners, posts, coupons, cart] = await Promise.all([
        store.request('/settings'),
        store.request('/categories'),
        store.request('/products'),
        store.request('/banners'),
        store.request('/blog-posts'),
        store.request('/coupons'),
        store.fetchCart()
      ]);
      Object.assign(state, { settings, categories, products, banners, posts, coupons, me, cart });
      renderHeader();
      if (page === 'home') return renderHome();
      if (page === 'products') return renderProducts();
      if (page === 'product') return renderProductDetail();
      if (page === 'cart') return renderCart();
      if (page === 'account') return renderAccount();
      if (page === 'review') return renderReviewPage();
      if (page === 'info') return renderInfo();
      if (page === 'blog') return renderBlogDetail();
    } catch (error) {
      app.innerHTML = `<section class="section"><div class="container"><div class="alert danger">Không tải được dữ liệu API: ${error.message}</div></div></section>`;
    }
  }

  function currentTheme() {
    if (localStorage.getItem(store.THEME_KEY) === 'light') document.body.classList.add('light');
  }

  function productCard(product) {
    const imageSrc = normalizeImageUrl(product.cover_image, product.name);
    const fallbackSrc = placeholderImage(product.name);
    return `<article class="card product-card">
      <img src="${imageSrc}" data-fallback-src="${fallbackSrc}" alt="${product.name}" loading="lazy" />
      <div class="product-content">
        <div class="meta-row"><span class="badge">${product.brand}</span><span>${product.type}</span><span>${product.joint_type || '-'}</span></div>
        <h3>${product.name}</h3>
        <div class="price-row" style="margin:10px 0 14px;"><strong>${store.currency(product.sale_price || product.price)}</strong>${product.sale_price ? `<span class="old-price">${store.currency(product.price)}</span>` : ''}</div>
        <div class="meta-row"><span class="rating">${stars(product.rating)}</span><span>${product.review_count || 0} đánh giá</span><span>${Number(product.stock_total) > 0 ? 'Còn hàng' : 'Hết hàng'}</span></div>
        <div class="inline-actions" style="margin-top:14px;"><a class="btn btn-primary" href="product.html?slug=${product.slug}">Xem chi tiết</a></div>
      </div>
    </article>`;
  }

  function renderHeader() {
    currentTheme();
    const cartCount = Number(state.cart?.summary?.totalQuantity || 0);
    const unreadCount = Number(state.me?.unreadCount || state.me?.notifications?.filter((n) => !Number(n.is_read)).length || 0);
    document.querySelector('.topbar')?.remove();
    document.querySelector('.floating-actions')?.remove();
    document.querySelector('.footer')?.remove();
    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML = `<div class="container">
      <a class="logo" href="index.html"><span class="logo-mark">🎱</span><span>${state.settings.siteName}</span></a>
      <nav class="nav">
        <a class="${page === 'home' ? 'active' : ''}" href="index.html">Trang chủ</a>
        <a class="${page === 'products' ? 'active' : ''}" href="products.html">Sản phẩm</a>
        <a class="${page === 'cart' ? 'active' : ''}" href="cart.html">Giỏ hàng</a>
        <a class="${['account','review'].includes(page) ? 'active' : ''}" href="account.html">Tài khoản</a>
        <a class="${page === 'info' ? 'active' : ''}" href="info.html">Chính sách & Liên hệ</a>
        <a href="admin.html" target="_blank" rel="noreferrer"></a>
      </nav>
      <div class="header-actions">
        <div class="search-box" style="min-width:280px;"><input id="smartSearch" type="search" placeholder="Tìm gậy, thương hiệu, SKU..." /><div class="search-suggest" id="searchSuggest"></div></div>
        <button class="btn" id="themeToggle">🌓</button>
        ${state.me ? `<a class="btn" href="account.html#notifications" title="Thông báo">🔔 ${unreadCount}</a>` : ''}
        <a class="btn btn-primary" href="cart.html">🛒 ${cartCount}</a>
      </div>
    </div>`;
    document.body.prepend(header);
    $('#themeToggle').onclick = () => {
      document.body.classList.toggle('light');
      localStorage.setItem(store.THEME_KEY, document.body.classList.contains('light') ? 'light' : 'dark');
    };
    const input = $('#smartSearch');
    const suggest = $('#searchSuggest');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { suggest.classList.remove('active'); suggest.innerHTML = ''; return; }
      const matches = state.products.filter((p) => [p.name, p.brand, p.sku].join(' ').toLowerCase().includes(q)).slice(0, 6);
      suggest.innerHTML = matches.length ? matches.map((p) => `<a class="search-item" href="product.html?slug=${p.slug}"><img src="${normalizeImageUrl(p.cover_image, p.name)}" data-fallback-src="${placeholderImage(p.name)}" width="66" height="50" style="border-radius:12px;object-fit:cover;" alt="${p.name}" loading="lazy"/><div><strong>${p.name}</strong><div class="muted">${p.brand} • ${store.currency(p.sale_price || p.price)}</div></div></a>`).join('') : '<div class="empty">Không tìm thấy sản phẩm phù hợp.</div>';
      suggest.classList.add('active');
      applyImageFallback(suggest);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) suggest.classList.remove('active'); });
    const floating = document.createElement('div');
    floating.className = 'floating-actions';
    floating.innerHTML = `<a href="tel:${String(state.settings.hotline).replace(/\s+/g, '')}" title="Gọi hotline">📞</a><a href="${state.settings.zalo}" target="_blank" rel="noreferrer">💬</a><a href="${state.settings.messenger}" target="_blank" rel="noreferrer">✉️</a>`;
    document.body.appendChild(floating);
    const footer = document.createElement('footer');
    footer.className = 'footer';
    footer.innerHTML = `<div class="container grid-3"><div><div class="logo" style="margin-bottom:12px;"><span class="logo-mark">🎱</span><span>${state.settings.siteName}</span></div><p class="muted">Showroom: ${state.settings.showroom}</p><p class="muted">Hotline: ${state.settings.hotline}</p></div><div><strong>Chính sách quan trọng</strong><p class="muted">${state.settings.shippingPolicy}</p></div><div><strong>Tài khoản hiện tại</strong><p class="muted">${state.me?.user?.fullName || 'Khách vãng lai'} ${state.me?.user?.membershipLevel ? '• ' + state.me.user.membershipLevel : ''}</p></div></div>`;
    document.body.appendChild(footer);
    applyImageFallback(document);
  }

  const categoryImages = {
    'gay-pool': 'assets/uploads/categories/pool.jpg',
    'gay-carom': 'assets/uploads/categories/carom.jpg',
    'gay-pha-nhay': 'assets/uploads/categories/break.jpg',
    'phu-kien': 'assets/uploads/categories/accessories.jpg'
  };
  function renderHome() {
  const featured = state.products.filter((p) => p.is_featured).slice(0, 4);
  const top = [...state.products].sort((a, b) => Number(b.sold_count || 0) - Number(a.sold_count || 0)).slice(0, 4);
  const categories = state.categories.slice(0, 4);

  const banners = state.banners?.length
    ? state.banners
    : [{
        title: 'Bộ sưu tập mới',
        subtitle: 'Cue & phụ kiện',
        image_url: placeholderImage('Bida'),
        href: 'products.html'
      }];

  app.innerHTML = `
    <section class="hero">
      <div class="container">
        <div class="hero-slider" id="heroSlider">
          <div class="hero-track" id="heroTrack">
            ${banners.map((banner, index) => `
              <a class="hero-slide ${index === 0 ? 'active' : ''}" href="${banner.href || 'products.html'}">
                <img
                  src="${normalizeImageUrl(banner.image_url, banner.title)}"
                  data-fallback-src="${placeholderImage(banner.title)}"
                  alt="${banner.title}"
                />
                <div class="hero-overlay hero-bottom">
                  <span class="badge">${banner.subtitle || ''}</span>
                  <h1>${banner.title || ''}</h1>
                  <p>${banner.description || state.settings.shippingPolicy || ''}</p>
                  <div class="inline-actions">
                    <span class="btn btn-primary">Mua ngay</span>
                    <span class="btn">Xem thêm</span>
                  </div>
                </div>
              </a>
            `).join('')}
          </div>

          ${banners.length > 1 ? `
            <button class="hero-nav prev" id="heroPrev" type="button">‹</button>
            <button class="hero-nav next" id="heroNext" type="button">›</button>
            <div class="hero-dots" id="heroDots">
              ${banners.map((_, index) => `
                <button class="hero-dot ${index === 0 ? 'active' : ''}" type="button" data-index="${index}"></button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    </section>

    <section class="section"><div class="container"><div class="section-title"><div><h2>Danh mục nổi bật</h2><p class="muted">Đi nhanh tới dòng sản phẩm bạn cần.</p></div></div><div class="grid-4">
      ${categories.map((c) => `
        <a class="card category-card" href="products.html?category=${c.slug}">
          <img
            src="${normalizeImageUrl(categoryImages[c.slug], c.name)}"
            data-fallback-src="${placeholderImage(c.name)}"
            alt="${c.name}"
          />
          <div class="category-content">
            <h3>${c.name}</h3>
            <p class="muted">${c.slug}</p>
          </div>
        </a>
      `).join('')}
    </div></div></section>

    <section class="section"><div class="container"><div class="section-title"><div><h2>Sản phẩm nổi bật</h2><p class="muted"></p></div><a href="products.html" class="btn">Xem toàn bộ</a></div><div class="product-grid">${featured.map(productCard).join('')}</div></div></section>

    <section class="section"><div class="container grid-2"><div><div class="section-title"><h2>Bán chạy nhất</h2></div><div class="grid-2">${top.map((p) => `<div class="card mini-card" style="padding:14px;display:flex;gap:14px;align-items:center;"><img src="${normalizeImageUrl(p.cover_image, p.name)}" data-fallback-src="${placeholderImage(p.name)}" alt="${p.name}" width="130" style="border-radius:16px;object-fit:cover;" /><div><div class="chip">Đã bán ${p.sold_count || 0}</div><h3>${p.name}</h3><div class="muted">${p.brand} • ${p.tip_size || '-'} • ${p.joint_type || '-'}</div><div style="margin-top:10px;"><a class="btn btn-primary" href="product.html?slug=${p.slug}">Xem ngay</a></div></div></div>`).join('')}</div></div><div><div class="section-title"><h2>Mã giảm giá</h2></div><div class="card" style="padding:22px;"><div class="kpi-list">${state.coupons.map((c) => `<div class="list-line"><div><strong>${c.code}</strong><div class="muted">${c.discount_type === 'percent' ? c.value + '%' : store.currency(c.value)} • Tối thiểu ${store.currency(c.min_order_amount)}</div></div><span class="pill-status status-processing">${c.usage_limit ? `Giới hạn ${c.usage_limit}` : 'Đang hoạt động'}</span></div>`).join('') || '<div class="muted">Chưa có coupon.</div>'}</div></div></div></div></section>

    <section class="section"><div class="container"><div class="section-title"><div><h2>Cẩm nang & tin tức</h2><p class="muted"></p></div></div><div class="grid-3">
      ${state.posts.map((post) => `
        <a class="card blog-card" href="blog.html?slug=${post.slug}" style="text-decoration:none;color:inherit;">
          <img
            src="${normalizeImageUrl(post.cover_image, post.title)}"
            data-fallback-src="${placeholderImage(post.title)}"
            alt="${post.title}"
          />
          <div class="blog-content">
            <span class="badge">Blog</span>
            <h3>${post.title}</h3>
            <p class="muted">${post.excerpt || ''}</p>
            <div class="meta-row">
              <span>${fmtDate(post.published_at)}</span>
              <span>Xem bài viết</span>
            </div>
          </div>
        </a>
      `).join('')}
    </div></div></section>
  `;

  applyImageFallback(app);
  initHeroSlider();
}

  async function renderProducts() {
    const params = new URLSearchParams(location.search);
    const filters = {
      category: params.get('category') || '',
      brand: params.get('brand') || '',
      joint: params.get('joint') || '',
      shaftMaterial: params.get('shaftMaterial') || '',
      minPrice: params.get('minPrice') || '',
      maxPrice: params.get('maxPrice') || '',
      sort: params.get('sort') || '',
      q: params.get('q') || ''
    };
    const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const products = await store.request(`/products?${query.toString()}`);
    const brands = [...new Set(state.products.map((p) => p.brand).filter(Boolean))];
    const joints = [...new Set(state.products.map((p) => p.joint_type).filter(Boolean))];
    const shafts = [...new Set(state.products.map((p) => p.shaft_material).filter(Boolean))];
    app.innerHTML = `<section class="section"><div class="container"><div class="section-title"><div><h1>Danh mục sản phẩm</h1><p class="muted"></p></div></div><div class="catalog-layout"><aside class="card" style="padding:18px;"><form id="filterForm" class="stack-form"><label><span>Từ khóa</span><input name="q" value="${filters.q}" /></label><label><span>Danh mục</span><select name="category"><option value="">Tất cả</option>${state.categories.map((c) => `<option value="${c.slug}" ${filters.category === c.slug ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label><label><span>Thương hiệu</span><select name="brand"><option value="">Tất cả</option>${brands.map((x) => `<option value="${x}" ${filters.brand === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label><span>Ren</span><select name="joint"><option value="">Tất cả</option>${joints.map((x) => `<option value="${x}" ${filters.joint === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label><span>Chất liệu ngọn</span><select name="shaftMaterial"><option value="">Tất cả</option>${shafts.map((x) => `<option value="${x}" ${filters.shaftMaterial === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><div class="form-grid-2"><label><span>Giá từ</span><input type="number" name="minPrice" value="${filters.minPrice}" /></label><label><span>Giá đến</span><input type="number" name="maxPrice" value="${filters.maxPrice}" /></label></div><label><span>Sắp xếp</span><select name="sort"><option value="">Mặc định</option><option value="price_asc" ${filters.sort === 'price_asc' ? 'selected' : ''}>Giá tăng</option><option value="price_desc" ${filters.sort === 'price_desc' ? 'selected' : ''}>Giá giảm</option><option value="best_selling" ${filters.sort === 'best_selling' ? 'selected' : ''}>Bán chạy</option><option value="top_rated" ${filters.sort === 'top_rated' ? 'selected' : ''}>Đánh giá cao</option></select></label><div class="inline-actions"><button class="btn btn-primary" type="submit">Lọc</button><a class="btn" href="products.html">Reset</a></div></form></aside><div><div class="section-title"><div><h2>${products.length} sản phẩm</h2><p class="muted"></p></div></div><div class="product-grid">${products.map(productCard).join('') || '<div class="alert warning">Không có sản phẩm phù hợp.</div>'}</div></div></div></div></section>`;
    $('#filterForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const next = new URLSearchParams();
      for (const [k, v] of form.entries()) if (String(v).trim()) next.set(k, v);
      location.href = `products.html?${next.toString()}`;
    });
    applyImageFallback(app);
  }

  async function renderProductDetail() {
    const slug = param('slug');
    if (!slug) { app.innerHTML = '<section class="section"><div class="container"><div class="alert danger">Thiếu slug sản phẩm.</div></div></section>'; return; }
    const product = await store.request(`/products/${slug}`);
    const images = product.images?.length ? product.images : [{ image_url: product.cover_image || placeholderImage(product.name) }];
    const reviewsHtml = (product.reviews || []).length
      ? product.reviews.map((review) => `<div class="notice"><div class="list-line"><strong>${review.full_name}</strong><span>${fmtDate(review.created_at)}</span></div><div class="muted">${stars(review.rating)}</div><p style="margin:8px 0 0;">${review.comment || 'Khách hàng không để lại nội dung.'}</p></div>`).join('')
      : '<div class="muted">Chưa có đánh giá nào.</div>';
    const reviewHelpHtml = state.me
      ? `<div class="notice"><strong>Đánh giá từ đơn hàng của bạn</strong><div class="muted">Sau khi mua hàng, vào mục Tài khoản → Đơn hàng của tôi → Đánh giá sản phẩm để gửi nhận xét đúng cho từng sản phẩm đã mua.</div><div style="margin-top:10px;"><a class="btn btn-primary" href="account.html">Mở đơn hàng của tôi</a></div></div>`
      : `<div class="notice"><strong>Đăng nhập để đánh giá</strong><div class="muted">Bạn cần đăng nhập và đánh giá từ chính đơn hàng đã mua.</div><div style="margin-top:10px;"><a class="btn btn-primary" href="account.html">Đăng nhập ngay</a></div></div>`;
    app.innerHTML = `<section class="section"><div class="container"><div class="grid-2"><div><div class="card" style="padding:18px;"><img id="mainImage" src="${normalizeImageUrl(images[0].image_url, product.name)}" data-fallback-src="${placeholderImage(product.name)}" alt="${product.name}" style="width:100%;border-radius:18px;object-fit:cover;" /><div class="inline-actions" style="margin-top:12px;flex-wrap:wrap;">${images.map((img, index) => `<img class="thumb-img" src="${normalizeImageUrl(img.image_url, `${product.name} ${index + 1}`)}" data-fallback-src="${placeholderImage(product.name)}" data-src="${normalizeImageUrl(img.image_url, product.name)}" width="90" style="border-radius:12px;cursor:pointer;object-fit:cover;" />`).join('')}</div></div></div><div><div class="card" style="padding:22px;"><div class="badge">${product.brand}</div><h1>${product.name}</h1><div class="meta-row"><span>SKU: ${product.sku}</span><span>${Number(product.stock_total) > 0 ? 'Còn hàng' : 'Hết hàng'}</span></div><div class="price-row" style="margin:14px 0;"><strong>${store.currency(product.sale_price || product.price)}</strong>${product.sale_price ? `<span class="old-price">${store.currency(product.price)}</span>` : ''}</div><p class="muted">${product.description}</p><form id="addCartForm" class="stack-form" style="margin-top:16px;"><label><span>Biến thể</span><select name="variantId"><option value="">Mặc định</option>${(product.variants || []).map((v) => `<option value="${v.id}">${v.weight || '-'} • ${v.tip_size || '-'} • tồn ${v.stock}</option>`).join('')}</select></label><fieldset><legend>Dịch vụ kèm theo</legend>${(product.services || []).map((s) => `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="services" value="${s.code}" /> ${s.name} (+${store.currency(s.price)})</label>`).join('') || '<div class="muted">Không có dịch vụ thêm.</div>'}</fieldset><label><span>Số lượng</span><input type="number" name="quantity" min="1" value="1" /></label><div class="inline-actions"><button class="btn btn-primary" type="submit">Thêm vào giỏ</button>${state.me ? `<button class="btn" type="button" id="wishlistBtn">♡ Yêu thích</button>` : ''}</div></form></div><div class="card" style="padding:22px;margin-top:18px;"><h2>Bảng thông số kỹ thuật</h2><table class="admin-table"><tbody><tr><td>Loại ren</td><td>${product.joint_type || '-'}</td></tr><tr><td>Ngọn</td><td>${product.shaft_material || '-'}</td></tr><tr><td>Chuôi</td><td>${product.butt_material || '-'}</td></tr><tr><td>Trọng lượng</td><td>${(product.variants || []).map((v) => v.weight).filter(Boolean).join(', ') || '-'}</td></tr><tr><td>Đầu cơ</td><td>${product.tip_size || '-'}</td></tr></tbody></table></div></div></div><div class="section-title" style="margin-top:24px;"><div><h2>Đánh giá khách hàng</h2><p class="muted"></p></div></div><div class="grid-2"><div class="card" style="padding:22px;">${reviewsHtml}</div><div class="card" style="padding:22px;"><h3>Đánh giá từ đơn hàng</h3>${reviewHelpHtml}</div></div><div class="section-title" style="margin-top:24px;"><div><h2>Sản phẩm gợi ý</h2><p class="muted"></p></div></div><div class="product-grid">${(product.collaborativeSuggestions || []).map(productCard).join('')}</div></div></section>`;
    applyImageFallback(app);
    $all('.thumb-img').forEach((img) => img.onclick = () => { $('#mainImage').src = img.dataset.src; });
    $('#addCartForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const cart = await store.addToCart({ productId: product.id, variantId: fd.get('variantId') || null, quantity: Number(fd.get('quantity') || 1), selectedServices: fd.getAll('services') });
        state.cart = cart;
        renderHeader();
        notify('Đã thêm vào giỏ hàng.');
      } catch (error) {
        notify(error.message, 'danger');
      }
    });
    if ($('#wishlistBtn')) $('#wishlistBtn').onclick = async () => {
      try { await store.request(`/auth/wishlist/${product.id}`, { method: 'POST' }); notify('Đã cập nhật wishlist.'); }
      catch (error) { notify(error.message, 'danger'); }
    };
  }

  async function renderCart() {
    state.cart = await store.fetchCart();
    renderHeader();
    const lines = state.cart.items || [];
    const savedAddresses = state.me?.addresses || [];
    const defaultAddress = savedAddresses.find((item) => Number(item.is_default)) || savedAddresses[0] || null;
    const mustLoginHtml = !state.me ? `<div class="notice" style="margin-bottom:14px;"><strong>Vui lòng đăng nhập để đặt hàng</strong><div class="muted">Bạn vẫn có thể thêm sản phẩm vào giỏ, nhưng phải đăng nhập trước khi tạo đơn.</div><div style="margin-top:10px;"><a class="btn btn-primary" href="account.html">Đăng nhập / Đăng ký</a></div></div>` : '';

    function selectedLines() { return lines.filter((line) => line.isSelected); }
    function baseShippingAmount() { return selectedLines().length ? Number(state.settings.shipping?.standard || 45000) : 0; }
    function currentCouponState() {
      const couponInput = $('#checkoutForm [name="couponCode"]');
      const subtotal = selectedLines().reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
      return evaluateCoupon(couponInput ? couponInput.value : '', subtotal);
    }
    function syncAddressFields(addressId) {
      const form = $('#checkoutForm');
      if (!form) return;
      const address = savedAddresses.find((item) => Number(item.id) === Number(addressId));
      if (!address) return;
      form.fullName.value = address.recipient_name || state.me?.user?.fullName || '';
      form.phone.value = address.phone || state.me?.user?.phone || '';
      form.line1.value = address.line1 || '';
      form.district.value = address.district || '';
      form.city.value = address.city || 'TP.HCM';
    }
    function renderSummary() {
      const subtotal = selectedLines().reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
      const coupon = currentCouponState();
      const shippingBase = baseShippingAmount();
      const shipping = coupon.valid && coupon.shippingOverride !== null ? coupon.shippingOverride : shippingBase;
      const discount = coupon.valid ? Number(coupon.discount || 0) : 0;
      const total = Math.max(0, subtotal - discount + shipping);
      $('#cartSubtotal').textContent = store.currency(subtotal);
      $('#cartDiscount').textContent = discount ? `- ${store.currency(discount)}` : store.currency(0);
      $('#cartShipping').textContent = store.currency(shipping);
      $('#cartGrandTotal').textContent = store.currency(total);
      const status = $('#couponStatus');
      if (status) {
        status.className = `muted ${coupon.code ? (coupon.valid ? 'coupon-valid' : 'coupon-invalid') : ''}`;
        status.textContent = coupon.message || 'Nhập mã giảm giá để hệ thống tính lại tổng đơn.';
      }
    }

    app.innerHTML = `<section class="section"><div class="container grid-2"><div><div class="section-title"><div><h1>Giỏ hàng</h1><p class="muted"></p></div></div>${mustLoginHtml}<div class="card" style="padding:18px;">${lines.map((line) => `<div class="list-line" style="align-items:flex-start;"><label style="display:flex;gap:10px;align-items:flex-start;flex:1;"><input type="checkbox" class="cart-check" data-id="${line.id}" ${line.isSelected ? 'checked' : ''} /><div><strong>${line.product.name}</strong><div class="muted">${line.variant ? `${line.variant.weight || '-'} • ${line.variant.tipSize || '-'}` : 'Bản mặc định'}</div><div class="muted">Dịch vụ: ${line.services.map((s) => s.name).join(', ') || 'Không'}</div><div class="muted">Đơn giá: ${store.currency(line.unitPrice)}</div></div></label><div><input type="number" min="1" class="cart-qty" data-id="${line.id}" value="${line.quantity}" style="width:82px;" /></div><strong>${store.currency(line.lineTotal)}</strong><button class="btn btn-danger cart-remove" data-id="${line.id}">Xóa</button></div>`).join('') || '<div class="muted">Giỏ hàng đang trống.</div>'}</div></div><div><div class="card" style="padding:22px;"><h2>Thanh toán</h2><div class="kpi-list"><div class="list-line"><span>Tạm tính</span><strong id="cartSubtotal">${store.currency(selectedLines().reduce((sum, line) => sum + Number(line.lineTotal || 0), 0))}</strong></div><div class="list-line"><span>Giảm giá</span><strong id="cartDiscount">${store.currency(0)}</strong></div><div class="list-line"><span>Phí ship chuẩn</span><strong id="cartShipping">${store.currency(baseShippingAmount())}</strong></div><div class="list-line"><span>Tổng thanh toán</span><strong id="cartGrandTotal">${store.currency(selectedLines().reduce((sum, line) => sum + Number(line.lineTotal || 0), 0) + baseShippingAmount())}</strong></div></div><form id="checkoutForm" class="stack-form" style="margin-top:16px;">${savedAddresses.length ? `<label><span>Chọn địa chỉ đã lưu</span><select name="savedAddressId" id="savedAddressSelect"><option value="">-- Nhập địa chỉ mới --</option>${savedAddresses.map((address) => `<option value="${address.id}" ${defaultAddress && Number(defaultAddress.id) === Number(address.id) ? 'selected' : ''}>${address.label} • ${address.recipient_name || state.me?.user?.fullName || ''} • ${address.line1}</option>`).join('')}</select></label>` : ''}<div class="form-grid-2"><label><span>Họ tên</span><input name="fullName" minlength="2" value="${defaultAddress?.recipient_name || state.me?.user?.fullName || ''}" required /></label><label><span>Email</span><input name="email" type="email" value="${state.me?.user?.email || ''}" required /></label></div><div class="form-grid-2"><label><span>Điện thoại</span><input name="phone" inputmode="numeric" maxlength="10" pattern="0[0-9]{9}" placeholder="0901234567" value="${defaultAddress?.phone || state.me?.user?.phone || ''}" required /></label><label><span>Mã giảm giá</span><input name="couponCode" placeholder="BIDA500" /></label></div><div class="muted" id="couponStatus">Nhập mã giảm giá để hệ thống tính lại tổng đơn.</div><label><span>Địa chỉ giao hàng</span><textarea name="line1" required>${defaultAddress?.line1 || ''}</textarea></label><div class="form-grid-2"><label><span>Quận/Huyện</span><input name="district" value="${defaultAddress?.district || ''}" required /></label><label><span>Thành phố</span><input name="city" value="${defaultAddress?.city || 'TP.HCM'}" required /></label></div><label><span>Phương thức thanh toán</span><select name="paymentMethod" required><option value="cod">COD</option><option value="bank_transfer">Chuyển khoản</option><option value="vnpay">VNPay</option><option value="momo">MoMo</option></select></label><label><span>Ghi chú</span><textarea name="note" placeholder="Ví dụ: thay đầu cơ trước khi giao"></textarea></label><div class="inline-actions"><button class="btn btn-primary" type="submit" ${state.me ? '' : 'disabled'}>Đặt hàng</button><button class="btn" type="button" id="deleteSelected">Xóa mục đã chọn</button></div></form><div class="muted" style="margin-top:12px;"></div></div></div></div></section>`;

    renderSummary();
    if ($('#savedAddressSelect')) $('#savedAddressSelect').onchange = (e) => { if (e.target.value) syncAddressFields(e.target.value); };
    const couponInput = $('#checkoutForm [name="couponCode"]');
    if (couponInput) couponInput.addEventListener('input', renderSummary);
    $all('.cart-check').forEach((checkbox) => {
      checkbox.onchange = async () => {
        const id = Number(checkbox.dataset.id);
        const line = lines.find((item) => item.id === id);
        if (!line) return;
        line.isSelected = checkbox.checked;
        renderSummary();
        try { state.cart = await store.updateCartItem(id, { isSelected: checkbox.checked }); renderHeader(); }
        catch (error) { checkbox.checked = !checkbox.checked; line.isSelected = checkbox.checked; renderSummary(); notify(error.message, 'danger'); }
      };
    });
    $all('.cart-qty').forEach((input) => {
      input.onchange = async () => {
        const id = Number(input.dataset.id);
        const quantity = Math.max(1, Number(input.value || 1));
        try { state.cart = await store.updateCartItem(id, { quantity }); renderHeader(); renderCart(); }
        catch (error) { notify(error.message, 'danger'); }
      };
    });
    $all('.cart-remove').forEach((btn) => { btn.onclick = async () => { try { state.cart = await store.removeCartItem(Number(btn.dataset.id)); renderHeader(); renderCart(); } catch (error) { notify(error.message, 'danger'); } }; });
    $('#deleteSelected').onclick = async () => { try { state.cart = await store.removeSelectedCartItems(); renderHeader(); renderCart(); } catch (error) { notify(error.message, 'danger'); } };
    $('#checkoutForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!state.me) { notify('Vui lòng đăng nhập trước khi đặt hàng.', 'warning'); location.href = 'account.html'; return; }
      const selected = selectedLines();
      if (!selected.length) return notify('Chọn ít nhất 1 sản phẩm để thanh toán.', 'warning');
      const fd = new FormData(e.target);
      const validationError = validateCheckoutForm(fd);
      if (validationError) return notify(validationError, 'warning');
      const coupon = evaluateCoupon(fd.get('couponCode'), selected.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0));
      if (String(fd.get('couponCode') || '').trim() && !coupon.valid) return notify(coupon.message || 'Voucher không hợp lệ.', 'warning');
      const payload = { customer: { fullName: String(fd.get('fullName') || '').trim(), email: String(fd.get('email') || '').trim(), phone: normalizePhone(fd.get('phone')), address: { line1: String(fd.get('line1') || '').trim(), district: String(fd.get('district') || '').trim(), city: String(fd.get('city') || '').trim() } }, items: selected.map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: Number(line.quantity), selectedServices: line.selectedServiceCodes || [] })), paymentMethod: fd.get('paymentMethod'), note: String(fd.get('note') || '').trim(), couponCode: String(fd.get('couponCode') || '').trim() };
      try {
        const result = await store.request('/orders/checkout', { method: 'POST', body: JSON.stringify(payload) });
        state.cart = await store.removeSelectedCartItems();
        renderHeader();
        if (result.payment?.redirectUrl) { notify('Đang chuyển sang cổng thanh toán...'); location.href = result.payment.redirectUrl; return; }
        notify(`Đặt hàng thành công: ${result.order.order_code}`); location.href = `info.html?order=${result.order.order_code}`;
      } catch (error) { notify(error.message, 'danger'); }
    };
  }

  async function renderAccount() {
    const me = await store.getMeSafe();
    if (!me) {
      app.innerHTML = `<section class="section"><div class="container grid-2"><div class="card" style="padding:22px;"><h1>Đăng nhập</h1><form id="loginForm" class="stack-form"><label><span>Email</span><input name="email" required /></label><label><span>Mật khẩu</span><input name="password" type="password" required /></label><button class="btn btn-primary" type="submit">Đăng nhập</button></form></div><div class="card" style="padding:22px;"><h2>Tạo tài khoản</h2><form id="registerForm" class="stack-form" novalidate>
  <label>
    <span>Họ tên</span>
    <input name="fullName" required />
    <div class="field-error" data-error-for="fullName"></div>
  </label>

  <label>
    <span>Email</span>
    <input name="email" type="email" placeholder="tenban@gmail.com" required />
    <div class="field-error" data-error-for="email"></div>
  </label>

  <label>
    <span>Điện thoại</span>
    <input name="phone" inputmode="numeric" maxlength="10" placeholder="0901234567" />
    <div class="field-error" data-error-for="phone"></div>
  </label>

  <label>
    <span>Mật khẩu</span>
    <input name="password" type="password" required />
    <div class="field-error" data-error-for="password"></div>
  </label>

  <label>
    <span>Nhập lại mật khẩu</span>
    <input name="confirmPassword" type="password" required />
    <div class="field-error" data-error-for="confirmPassword"></div>
  </label>

  <button class="btn btn-primary" type="submit">Đăng ký</button>
</form></div></div></section>`;
      $('#loginForm').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try { const data = await store.request('/auth/login', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }) }); store.setToken(data.token); await store.mergeGuestCart(); location.reload(); }
        catch (error) { notify(error.message, 'danger'); }
      };
      const registerForm = $('#registerForm');
      if (registerForm) {
        bindRegisterLiveValidation(registerForm);
        registerForm.addEventListener('submit', async (e) => {
          e.preventDefault();

          const values = readRegisterValues(registerForm);
          const errors = getRegisterErrors(values);

          if (!applyRegisterErrors(registerForm, errors)) {
            notify('Vui lòng sửa các lỗi trong form đăng ký.', 'warning');
            return;
          }

          try {
            const data = await store.request('/auth/register', {
              method: 'POST',
              body: JSON.stringify({
                email: String(values.email || '').trim(),
                password: values.password,
                fullName: String(values.fullName || '').trim(),
                phone: normalizePhone(values.phone || '')
              })
            });

            if (data.token) {
              store.setToken(data.token);
              await store.mergeGuestCart();
              location.reload();
            } else {
              notify(data.message || 'Đăng ký thành công.', 'success');
              return;
            }
          } catch (error) {
            notify(error.message, 'danger');
          }
        });
      }
      return;
    }
    state.me = me;
    const orders = await store.request('/auth/orders');
    const reviewTarget = Number(param('orderItemId') || 0);
    const reviewOrderItem = orders.flatMap((o) => o.items || []).find((item) => item.id === reviewTarget);
    const notificationsHtml = (me.notifications || []).map((n) => `<div class="notice"><div class="list-line"><strong>${n.title}</strong><span>${fmtDate(n.sent_at)}</span></div><div class="muted">${n.message}</div><div class="muted">${Number(n.is_read) ? 'Đã đọc' : 'Chưa đọc'}</div></div>`).join('') || '<div class="muted">Chưa có thông báo.</div>';
    app.innerHTML = `<section class="section"><div class="container"><div class="section-title"><div><h1>Tài khoản khách hàng</h1><p class="muted">Quản lý địa chỉ, thông báo, điểm tích lũy và đơn hàng.</p></div><button class="btn" id="logoutBtn">Đăng xuất</button></div>${reviewOrderItem ? `<div class="card" style="padding:22px;margin-bottom:18px;"><h2>Đánh giá sản phẩm</h2><div class="muted">${reviewOrderItem.product_name}</div><form id="reviewOrderItemForm" class="stack-form" style="margin-top:14px;"><input type="hidden" name="orderItemId" value="${reviewOrderItem.id}" /><div class="form-grid-2"><label><span>Điểm</span><select name="rating" required><option value="5">5 sao</option><option value="4">4 sao</option><option value="3">3 sao</option><option value="2">2 sao</option><option value="1">1 sao</option></select></label><label><span>Sản phẩm</span><input value="${reviewOrderItem.product_name}" disabled /></label></div><label><span>Nhận xét</span><textarea name="comment" minlength="10" maxlength="500" required placeholder="Chia sẻ trải nghiệm thực tế, tối thiểu 10 ký tự"></textarea></label><div class="inline-actions"><button class="btn btn-primary" type="submit">Gửi đánh giá</button><a class="btn" href="account.html">Hủy</a></div></form></div>` : ''}<div class="grid-2"><div class="card" style="padding:22px;"><h2>Thông tin</h2><div class="kpi-list"><div class="list-line"><span>Họ tên</span><strong>${me.user.fullName}</strong></div><div class="list-line"><span>Email</span><strong>${me.user.email}</strong></div><div class="list-line"><span>Điểm tích lũy</span><strong>${Number(me.user.points || 0).toLocaleString('vi-VN')}</strong></div><div class="list-line"><span>Hạng</span><strong>${me.user.membershipLevel}</strong></div></div><h3 style="margin-top:18px;">Địa chỉ</h3>${me.addresses.map((a) => `<div class="notice"><strong>${a.label}</strong><div class="muted">${a.recipient_name || me.user.fullName} • ${a.phone || ''}</div><div class="muted">${a.line1}, ${a.district || ''}, ${a.city || ''}</div></div>`).join('') || '<div class="muted">Chưa có địa chỉ lưu.</div>'}<form id="addressForm" class="stack-form" style="margin-top:16px;"><div class="form-grid-2"><label><span>Nhãn địa chỉ</span><input name="label" placeholder="Nhà riêng / Công ty" required /></label><label><span>Người nhận</span><input name="recipientName" value="${me.user.fullName}" required /></label></div><div class="form-grid-2"><label><span>Số điện thoại</span><input name="phone" inputmode="numeric" maxlength="10" pattern="0[0-9]{9}" placeholder="0901234567" required /></label><label><span>Tỉnh/Thành phố</span><input name="city" value="TP.HCM" required /></label></div><div class="form-grid-2"><label><span>Quận/Huyện</span><input name="district" required /></label><label><span>Phường/Xã</span><input name="ward" /></label></div><label><span>Địa chỉ chi tiết</span><textarea name="line1" required></textarea></label><label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="isDefault" checked /> Đặt làm địa chỉ mặc định</label><button class="btn btn-primary" type="submit">Lưu địa chỉ</button></form><h3 id="notifications" style="margin-top:18px;">Thông báo</h3><div class="inline-actions" style="margin-bottom:10px;"><button class="btn" id="markAllReadBtn" type="button">Đánh dấu đã đọc</button></div>${notificationsHtml}<h3 style="margin-top:18px;">Wishlist</h3>${me.wishlist.map((w) => `<div class="list-line"><a href="product.html?slug=${w.slug}">${w.name}</a><strong>${store.currency(w.price)}</strong></div>`).join('') || '<div class="muted">Chưa có wishlist.</div>'}</div><div class="card" style="padding:22px;"><h2>Đơn hàng của tôi</h2>${orders.map((o) => `<div class="notice"><div class="list-line"><strong>${o.order_code}</strong><span>${fmtDate(o.created_at)}</span></div><div class="muted">${store.currency(o.grand_total)} • ${o.order_status} • ${o.payment_status}</div><div class="muted">Vận chuyển: ${o.shipping_provider || '-'} • Mã vận đơn: ${o.tracking_code || '-'}</div><ul style="margin:10px 0 0 18px;">${(o.items || []).map((item) => `<li>${item.product_name} x${item.quantity} • ${store.currency(item.line_total)} ${item.canReview ? (item.hasReview ? '<span class="badge active" style="margin-left:8px;">Đã đánh giá</span>' : `<a class="btn" style="margin-left:8px;" href="review.html?orderItemId=${item.id}">Đánh giá sản phẩm</a>`) : ''}</li>`).join('')}</ul></div>`).join('') || '<div class="muted">Chưa có đơn hàng.</div>'}</div></div></div></section>`;
    $('#logoutBtn').onclick = () => { store.setToken(''); location.reload(); };
    $('#markAllReadBtn').onclick = async () => { try { await store.request('/auth/notifications/read-all', { method: 'POST' }); location.reload(); } catch (error) { notify(error.message, 'danger'); } };
    $('#addressForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (!isValidFullName(fd.get('recipientName'))) return notify('Tên người nhận phải có ít nhất 2 ký tự và không được chứa số.', 'warning');
      if (!/^0\d{9}$/.test(normalizePhone(fd.get('phone')))) return notify('Số điện thoại địa chỉ phải gồm đúng 10 số.', 'warning');
      try {
        await store.request('/auth/addresses', { method: 'POST', body: JSON.stringify({ label: fd.get('label'), recipientName: fd.get('recipientName'), phone: normalizePhone(fd.get('phone')), line1: fd.get('line1'), ward: fd.get('ward'), district: fd.get('district'), city: fd.get('city'), isDefault: fd.get('isDefault') === 'on' }) });
        notify('Đã lưu địa chỉ.');
        location.reload();
      } catch (error) { notify(error.message, 'danger'); }
    };
    if ($('#reviewOrderItemForm')) $('#reviewOrderItemForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const reviewError = getReviewError({ rating: Number(fd.get('rating')), comment: String(fd.get('comment') || '').trim() });
      if (reviewError) return notify(reviewError, 'warning');
      try { await store.request('/auth/reviews', { method: 'POST', body: JSON.stringify({ orderItemId: Number(fd.get('orderItemId')), rating: Number(fd.get('rating')), comment: String(fd.get('comment') || '').trim() }) }); notify('Đã gửi đánh giá thành công.'); location.href = 'account.html'; }
      catch (error) { notify(error.message, 'danger'); }
    };
  }

  async function renderReviewPage() {
    const me = await store.getMeSafe();
    if (!me) { location.href = 'account.html'; return; }
    const orders = await store.request('/auth/orders');
    const orderItemId = Number(param('orderItemId') || 0);
    const reviewOrderItem = orders.flatMap((o) => o.items || []).find((item) => item.id === orderItemId);
    if (!reviewOrderItem) {
      app.innerHTML = `<section class="section"><div class="container"><div class="alert warning">Không tìm thấy dòng sản phẩm phù hợp để đánh giá.</div><a class="btn" href="account.html">Quay lại tài khoản</a></div></section>`;
      return;
    }
    app.innerHTML = `<section class="section"><div class="container"><div class="card" style="padding:22px;max-width:760px;margin:0 auto;"><h1>Đánh giá sản phẩm</h1><p class="muted">Bạn đang đánh giá đúng sản phẩm đã mua trong đơn hàng của mình.</p><div class="notice"><strong>${reviewOrderItem.product_name}</strong><div class="muted">Số lượng: ${reviewOrderItem.quantity} • Thành tiền: ${store.currency(reviewOrderItem.line_total)}</div></div><form id="reviewOrderItemForm" class="stack-form" style="margin-top:16px;"><input type="hidden" name="orderItemId" value="${reviewOrderItem.id}" /><div class="form-grid-2"><label><span>Điểm</span><select name="rating" required><option value="5">5 sao</option><option value="4">4 sao</option><option value="3">3 sao</option><option value="2">2 sao</option><option value="1">1 sao</option></select></label><label><span>Sản phẩm</span><input value="${reviewOrderItem.product_name}" disabled /></label></div><label><span>Nhận xét</span><textarea name="comment" minlength="10" maxlength="500" required placeholder="Chia sẻ trải nghiệm thực tế, tối thiểu 10 ký tự"></textarea></label><div class="inline-actions"><button class="btn btn-primary" type="submit">Gửi đánh giá</button><a class="btn" href="account.html">Quay lại đơn hàng</a></div></form></div></div></section>`;
    $('#reviewOrderItemForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const reviewError = getReviewError({ rating: Number(fd.get('rating')), comment: String(fd.get('comment') || '').trim() });
      if (reviewError) return notify(reviewError, 'warning');
      try { await store.request('/auth/reviews', { method: 'POST', body: JSON.stringify({ orderItemId: Number(fd.get('orderItemId')), rating: Number(fd.get('rating')), comment: String(fd.get('comment') || '').trim() }) }); notify('Đã gửi đánh giá thành công.'); location.href = 'account.html'; }
      catch (error) { notify(error.message, 'danger'); }
    };
  }

  async function renderInfo() {
    const orderCode = param('order');
    let orderBlock = '';
    if (orderCode) {
      try {
        const order = await store.request(`/orders/${orderCode}`);
        orderBlock = `<div class="card" style="padding:22px;margin-bottom:18px;"><h2>Đơn hàng ${order.order_code}</h2><div class="kpi-list"><div class="list-line"><span>Khách hàng</span><strong>${order.customer_name}</strong></div><div class="list-line"><span>Trạng thái đơn</span><strong>${order.order_status}</strong></div><div class="list-line"><span>Thanh toán</span><strong>${order.payment_status}</strong></div><div class="list-line"><span>Tổng tiền</span><strong>${store.currency(order.grand_total)}</strong></div></div>${bankTransferHtml(order)}</div>`;
      } catch {}
    }
    app.innerHTML = `<section class="section"><div class="container">${orderBlock}<div class="grid-2"><div class="card" style="padding:22px;"><h1>Chính sách bảo hành</h1><p class="muted">${state.settings.warrantyPolicy}</p><h2>Đổi trả & vận chuyển</h2><p class="muted">${state.settings.returnPolicy}</p><p class="muted">${state.settings.shippingPolicy}</p></div><div class="card" style="padding:22px;"><h2>Liên hệ showroom</h2><p class="muted">${state.settings.showroom}</p><p class="muted">Hotline: ${state.settings.hotline}</p><form class="stack-form"><label><span>Họ tên</span><input /></label><label><span>Nội dung</span><textarea placeholder="Để lại lời nhắn"></textarea></label><button class="btn btn-primary" type="button" id="contactBtn">Gửi liên hệ</button></form></div></div></div></section>`;
    $('#contactBtn').onclick = () => notify('Đã ghi nhận lời nhắn.');
  }
  
  bootstrap();
  async function renderBlogDetail() {
  const slug = param('slug');
  if (!slug) {
    app.innerHTML = '<section class="section"><div class="container"><div class="alert danger">Thiếu slug bài viết.</div></div></section>';
    return;
  }

  const post = state.posts.find((x) => x.slug === slug);
  if (!post) {
    app.innerHTML = '<section class="section"><div class="container"><div class="alert warning">Không tìm thấy bài viết.</div></div></section>';
    return;
  }

  app.innerHTML = `
    <section class="section">
      <div class="container">
        <article class="card" style="padding:24px;">
          <img
            src="${normalizeImageUrl(post.cover_image, post.title)}"
            data-fallback-src="${placeholderImage(post.title)}"
            alt="${post.title}"
            style="width:100%;max-height:420px;object-fit:cover;border-radius:18px;"
          />
          <div style="margin-top:18px;">
            <div class="badge">Blog</div>
            <h1 style="margin-top:12px;">${post.title}</h1>
            <div class="muted" style="margin-bottom:16px;">${fmtDate(post.published_at)}</div>
            <p class="muted" style="font-size:18px;">${post.excerpt || ''}</p>
            <div style="margin-top:20px;line-height:1.8;white-space:pre-line;">
              ${post.content || ''}
            </div>
          </div>
        </article>
      </div>
    </section>
  `;
  applyImageFallback(app);
  }
  function initHeroSlider() {
  const slider = document.getElementById('heroSlider');
  if (!slider) return;

  const slides = [...slider.querySelectorAll('.hero-slide')];
  const dots = [...slider.querySelectorAll('.hero-dot')];
  const prev = document.getElementById('heroPrev');
  const next = document.getElementById('heroNext');

  if (slides.length <= 1) return;

  let current = 0;
  let timer = null;

  function showSlide(index) {
    current = (index + slides.length) % slides.length;

    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === current);
    });

    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === current);
    });
  }

  function startAuto() {
    stopAuto();
    timer = setInterval(() => {
      showSlide(current + 1);
    }, 4000);
  }

  function stopAuto() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  prev?.addEventListener('click', () => {
    showSlide(current - 1);
    startAuto();
  });

  next?.addEventListener('click', () => {
    showSlide(current + 1);
    startAuto();
  });

  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      showSlide(Number(dot.dataset.index || 0));
      startAuto();
    });
  });

  slider.addEventListener('mouseenter', stopAuto);
  slider.addEventListener('mouseleave', startAuto);

  showSlide(0);
  startAuto();
  }
})();
