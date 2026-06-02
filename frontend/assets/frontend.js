(function () {
  const store = window.BidaStore;
  const page = document.body.dataset.page;
  const app = document.getElementById('app');
  const state = {
    settings: null,
    categories: [],
    products: [],
    banners: [],
    posts: [],
    coupons: [],
    me: null,
    cart: { items: [], summary: { totalQuantity: 0 } },
    locationProvinces: null,
    locationAreas: new Map(),
    aiAdvisorOpen: false,
    aiAdvisorLoading: false,
    aiAdvisorHistory: []
  };

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
  function rememberPendingVerification(email) {
    if (email) store.setPendingVerificationEmail(String(email || '').trim().toLowerCase());
  }
  function pendingVerificationEmail() {
    return store.getPendingVerificationEmail();
  }
  function clearPendingVerification() {
    store.clearPendingVerificationEmail();
  }
  function isEmailVerificationRequiredError(error) {
    return error && error.code === 'EMAIL_NOT_VERIFIED';
  }
  function canRetryOnlinePayment(order) {
    return String(order?.payment_method || '').toLowerCase() === 'vnpay' && ['pending', 'failed'].includes(String(order?.payment_status || '').toLowerCase());
  }
  function isValidFullName(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    return text.length >= 2 && !/\d/.test(text);
  }

  function isValidGmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
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

  function reviewContainsLink(comment) {
    return /(https?:\/\/|www\.|[a-z0-9-]+\.(com|vn|net|org|io|co|me|info|xyz|shop|site|link)\b)/i.test(String(comment || '').trim());
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
  else if (!isValidGmail(email)) errors.email = 'Vui lòng nhập địa chỉ email hợp lệ.';

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

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function addressAreaText(address = {}) {
    return String(address?.ward || address?.district || '').trim();
  }

  function formatAddressText(address = {}) {
    return [address.line1, addressAreaText(address), address.city].map((item) => String(item || '').trim()).filter(Boolean).join(', ');
  }

  function normalizeLocationText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .toLowerCase()
      .replace(/\b(thanh pho|tp|tinh|quan|huyen|phuong|xa|thi tran|dac khu)\b/g, ' ')
      .replace(/\bhcmc?\b/g, 'ho chi minh')
      .replace(/\bhn\b/g, 'ha noi')
      .replace(/\bdn\b/g, 'da nang')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchProvinceList() {
    if (Array.isArray(state.locationProvinces) && state.locationProvinces.length) return state.locationProvinces;
    state.locationProvinces = await store.request('/locations/provinces');
    return state.locationProvinces;
  }

  async function fetchAreaList(provinceCode) {
    const key = String(provinceCode || '').trim();
    if (!key) return [];
    if (state.locationAreas.has(key)) return state.locationAreas.get(key);
    const rows = await store.request(`/locations/areas?provinceCode=${encodeURIComponent(key)}`);
    state.locationAreas.set(key, rows);
    return rows;
  }

  function findLocationMatch(list, rawValue) {
    const normalized = normalizeLocationText(rawValue);
    if (!normalized) return null;
    const exact = list.find((item) => {
      const variants = [
        item.name,
        `${item.type || ''} ${item.name || ''}`,
        `${item.name || ''} ${item.type || ''}`
      ];
      return variants.some((variant) => normalizeLocationText(variant) === normalized);
    });
    if (exact) return exact;
    const candidates = list.filter((item) => {
      const haystack = normalizeLocationText(`${item.type || ''} ${item.name || ''} ${item.districtName || ''}`);
      return haystack.includes(normalized) || normalized.includes(normalizeLocationText(item.name || ''));
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function filterLocationItems(list, keyword) {
    const normalizedKeyword = normalizeLocationText(keyword);
    if (!normalizedKeyword) return list;
    const tokens = normalizedKeyword.split(/\s+/).filter(Boolean);
    return list.filter((item) => {
      const haystack = normalizeLocationText(`${item.name || ''} ${item.type || ''} ${item.districtName || ''}`);
      return haystack.includes(normalizedKeyword) || tokens.every((token) => haystack.includes(token));
    });
  }

  function locationOptionHtml(item, selectedCode, detailKey = '') {
    return `<button type="button" class="address-option ${selectedCode && selectedCode === item.code ? 'active' : ''}" data-code="${escapeHtml(item.code)}">
      <strong>${escapeHtml(item.name)}</strong>
      ${(item[detailKey] || item.type) ? `<small>${escapeHtml(item[detailKey] || item.type)}</small>` : ''}
    </button>`;
  }

  function setComboboxLabel(labelNode, value, placeholder) {
    if (!labelNode) return;
    const hasValue = Boolean(String(value || '').trim());
    labelNode.textContent = hasValue ? value : placeholder;
    labelNode.classList.toggle('is-placeholder', !hasValue);
  }

  function addressFieldsHtml(prefix, defaults = {}) {
    return `<div class="address-picker-block" id="${prefix}AddressPicker">
      <label class="address-select-shell">
        <span>Tỉnh/Thành phố</span>
        <input type="hidden" name="city" id="${prefix}ProvinceValue" value="${escapeHtml(defaults.city || '')}" />
        <input type="hidden" name="cityCode" id="${prefix}ProvinceCode" value="" />
        <div class="address-combobox" id="${prefix}ProvinceBox">
          <button class="address-combobox-trigger" type="button" id="${prefix}ProvinceTrigger" aria-expanded="false">
            <span class="address-combobox-label" id="${prefix}ProvinceLabel">-- Chọn tỉnh / TP --</span>
            <span class="address-combobox-caret">▾</span>
          </button>
          <div class="address-combobox-menu" id="${prefix}ProvinceMenu" hidden>
            <div class="address-combobox-search">
              <input type="search" id="${prefix}ProvinceSearch" placeholder="Tìm tỉnh / TP" autocomplete="off" />
            </div>
            <div class="address-combobox-options" id="${prefix}ProvinceOptions"></div>
          </div>
        </div>
      </label>
      <label class="address-select-shell">
        <span>Phường/Xã</span>
        <input type="hidden" name="ward" id="${prefix}WardValue" value="${escapeHtml(defaults.ward || defaults.district || '')}" />
        <input type="hidden" name="wardCode" id="${prefix}WardCode" value="" />
        <div class="address-combobox" id="${prefix}WardBox">
          <button class="address-combobox-trigger" type="button" id="${prefix}WardTrigger" aria-expanded="false" disabled>
            <span class="address-combobox-label" id="${prefix}WardLabel">-- Chọn phường / xã --</span>
            <span class="address-combobox-caret">▾</span>
          </button>
          <div class="address-combobox-menu" id="${prefix}WardMenu" hidden>
            <div class="address-combobox-search">
              <input type="search" id="${prefix}WardSearch" placeholder="Tìm phường / xã" autocomplete="off" />
            </div>
            <div class="address-combobox-options" id="${prefix}WardOptions"></div>
          </div>
        </div>
      </label>
      <div class="muted address-picker-hint address-picker-full" id="${prefix}AddressHint">Danh sách hành chính được lấy theo dữ liệu chính thức sau sáp nhập.</div>
      <label class="address-picker-full"><span>Địa chỉ giao hàng chi tiết</span><textarea name="line1" required placeholder="Số nhà, tên đường, tòa nhà...">${escapeHtml(defaults.line1 || '')}</textarea></label>
    </div>`;
  }

  async function bindAddressPicker(form, prefix, defaults = {}) {
    if (!form) return null;
    form.__addressPickers = form.__addressPickers || {};
    if (form.__addressPickers[prefix]) {
      await form.__addressPickers[prefix].applyDefaults(defaults);
      return form.__addressPickers[prefix];
    }

    const root = $(`#${prefix}AddressPicker`, form);
    const provinceBox = $(`#${prefix}ProvinceBox`, form);
    const provinceTrigger = $(`#${prefix}ProvinceTrigger`, form);
    const provinceLabel = $(`#${prefix}ProvinceLabel`, form);
    const provinceValue = $(`#${prefix}ProvinceValue`, form);
    const provinceCode = $(`#${prefix}ProvinceCode`, form);
    const provinceMenu = $(`#${prefix}ProvinceMenu`, form);
    const provinceSearch = $(`#${prefix}ProvinceSearch`, form);
    const provinceOptions = $(`#${prefix}ProvinceOptions`, form);
    const wardBox = $(`#${prefix}WardBox`, form);
    const wardTrigger = $(`#${prefix}WardTrigger`, form);
    const wardLabel = $(`#${prefix}WardLabel`, form);
    const wardValue = $(`#${prefix}WardValue`, form);
    const wardCode = $(`#${prefix}WardCode`, form);
    const wardMenu = $(`#${prefix}WardMenu`, form);
    const wardSearch = $(`#${prefix}WardSearch`, form);
    const wardOptions = $(`#${prefix}WardOptions`, form);
    const hintNode = $(`#${prefix}AddressHint`, form);
    const line1Field = form.elements.line1;
    if (!root || !provinceBox || !provinceTrigger || !provinceLabel || !provinceValue || !provinceCode || !provinceMenu || !provinceSearch || !provinceOptions || !wardBox || !wardTrigger || !wardLabel || !wardValue || !wardCode || !wardMenu || !wardSearch || !wardOptions || !hintNode) return null;

    const registry = window.__bidaAddressPickerRegistry || (() => {
      const next = { instances: new Set() };
      document.addEventListener('pointerdown', (event) => {
        next.instances.forEach((picker) => {
          if (!picker.root?.isConnected) {
            next.instances.delete(picker);
            return;
          }
          if (!picker.root.contains(event.target)) picker.closeMenus();
        });
      });
      window.__bidaAddressPickerRegistry = next;
      return next;
    })();

    const defaultHint = 'Danh sách hành chính được lấy theo dữ liệu chính thức sau sáp nhập.';
    const statePicker = {
      provinces: await fetchProvinceList(),
      wards: [],
      province: null,
      ward: null,
      open: '',
      optionsLoaded: false
    };

    function setHint(text = defaultHint, tone = '') {
      hintNode.textContent = text;
      hintNode.classList.toggle('address-picker-warning', tone === 'warning');
    }

    function setProvinceSelection(item) {
      statePicker.province = item || null;
      provinceValue.value = item?.name || '';
      provinceCode.value = item?.code || '';
      setComboboxLabel(provinceLabel, item?.name || '', '-- Chọn tỉnh / TP --');
      provinceBox.classList.toggle('is-invalid', false);
      if (!item) {
        statePicker.wards = [];
        provinceOptions.innerHTML = '';
      }
      wardTrigger.disabled = !item;
    }

    function setWardSelection(item, legacyText = '') {
      statePicker.ward = item || null;
      wardValue.value = item?.name || legacyText || '';
      wardCode.value = item?.code || '';
      setComboboxLabel(wardLabel, item?.name || legacyText || '', '-- Chọn phường / xã --');
      const isLegacy = Boolean(legacyText) && !item;
      wardBox.classList.toggle('is-invalid', isLegacy);
      if (isLegacy) setHint('Địa chỉ cũ chưa khớp danh mục mới. Hãy chọn lại phường/xã từ danh sách trước khi lưu.', 'warning');
      else setHint();
    }

    async function loadWardOptions() {
      if (!statePicker.province?.code) {
        statePicker.wards = [];
        wardOptions.innerHTML = '<div class="address-option-empty">Chọn tỉnh / TP trước.</div>';
        return [];
      }
      statePicker.wards = await fetchAreaList(statePicker.province.code);
      return statePicker.wards;
    }

    function renderProvinceOptions(keyword = '') {
      const items = filterLocationItems(statePicker.provinces, keyword).slice(0, 120);
      provinceOptions.innerHTML = items.length
        ? items.map((item) => locationOptionHtml(item, provinceCode.value, 'type')).join('')
        : '<div class="address-option-empty">Không tìm thấy tỉnh / TP phù hợp.</div>';
    }

    function renderWardOptions(keyword = '') {
      if (!statePicker.province?.code) {
        wardOptions.innerHTML = '<div class="address-option-empty">Chọn tỉnh / TP trước.</div>';
        return;
      }
      const items = filterLocationItems(statePicker.wards, keyword).slice(0, 180);
      wardOptions.innerHTML = items.length
        ? items.map((item) => locationOptionHtml(item, wardCode.value, 'districtName')).join('')
        : '<div class="address-option-empty">Không tìm thấy phường / xã phù hợp.</div>';
    }

    function closeMenus() {
      statePicker.open = '';
      provinceMenu.hidden = true;
      wardMenu.hidden = true;
      provinceTrigger.setAttribute('aria-expanded', 'false');
      wardTrigger.setAttribute('aria-expanded', 'false');
      provinceBox.classList.remove('is-open');
      wardBox.classList.remove('is-open');
    }

    async function openMenu(kind) {
      if (kind === 'ward' && !statePicker.province?.code) return;
      closeMenus();
      statePicker.open = kind;
      const isProvince = kind === 'province';
      const menu = isProvince ? provinceMenu : wardMenu;
      const box = isProvince ? provinceBox : wardBox;
      const trigger = isProvince ? provinceTrigger : wardTrigger;
      const search = isProvince ? provinceSearch : wardSearch;
      if (!isProvince) await loadWardOptions();
      menu.hidden = false;
      box.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      if (isProvince) renderProvinceOptions(search.value);
      else renderWardOptions(search.value);
      search.focus();
      search.select();
    }

    async function chooseProvince(item) {
      setProvinceSelection(item);
      setWardSelection(null);
      wardSearch.value = '';
      await loadWardOptions();
      closeMenus();
    }

    function chooseWard(item) {
      setWardSelection(item);
      closeMenus();
    }

    provinceTrigger.addEventListener('click', async () => {
      if (statePicker.open === 'province') {
        closeMenus();
        return;
      }
      await openMenu('province');
    });
    wardTrigger.addEventListener('click', async () => {
      if (wardTrigger.disabled) return;
      if (statePicker.open === 'ward') {
        closeMenus();
        return;
      }
      await openMenu('ward');
    });
    provinceSearch.addEventListener('input', () => {
      renderProvinceOptions(provinceSearch.value);
    });
    wardSearch.addEventListener('input', () => {
      renderWardOptions(wardSearch.value);
    });
    wardSearch.addEventListener('keyup', () => {
      renderWardOptions(wardSearch.value);
    });
    wardSearch.addEventListener('search', () => {
      renderWardOptions(wardSearch.value);
    });
    wardSearch.addEventListener('compositionend', () => {
      renderWardOptions(wardSearch.value);
    });
    provinceOptions.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-code]');
      if (!button) return;
      const selected = statePicker.provinces.find((item) => item.code === button.dataset.code);
      if (selected) await chooseProvince(selected);
    });
    wardOptions.addEventListener('click', (event) => {
      const button = event.target.closest('[data-code]');
      if (!button) return;
      const selected = statePicker.wards.find((item) => item.code === button.dataset.code);
      if (selected) chooseWard(selected);
    });

    const api = {
      root,
      form,
      closeMenus,
      async applyDefaults(nextDefaults = {}) {
        const cityText = String(nextDefaults.city || '').trim();
        const wardText = String(nextDefaults.ward || nextDefaults.district || '').trim();
        if (line1Field && Object.prototype.hasOwnProperty.call(nextDefaults, 'line1')) {
          line1Field.value = nextDefaults.line1 || '';
        }
        provinceSearch.value = '';
        wardSearch.value = '';
        const matchedProvince = findLocationMatch(statePicker.provinces, cityText);
        if (!matchedProvince) {
          setProvinceSelection(null);
          if (cityText) {
            provinceValue.value = cityText;
            setComboboxLabel(provinceLabel, cityText, '-- Chọn tỉnh / TP --');
            provinceBox.classList.add('is-invalid');
            setHint('Địa chỉ cũ chưa khớp danh mục mới. Hãy chọn lại tỉnh / TP từ danh sách.', 'warning');
          } else {
            provinceBox.classList.remove('is-invalid');
            setHint();
          }
          setWardSelection(null, wardText);
          wardTrigger.disabled = true;
          return;
        }

        provinceBox.classList.remove('is-invalid');
        setProvinceSelection(matchedProvince);
        await loadWardOptions();
        renderProvinceOptions('');
        const matchedWard = wardText ? findLocationMatch(statePicker.wards, wardText) : null;
        if (matchedWard) setWardSelection(matchedWard);
        else setWardSelection(null, wardText);
      }
    };

    await api.applyDefaults(defaults);
    registry.instances.add(api);
    form.__addressPickers[prefix] = api;
    return api;
  }

  async function validateAddressPickerSelection(form, prefix) {
    const provinceCode = $(`#${prefix}ProvinceCode`, form);
    const wardCode = $(`#${prefix}WardCode`, form);
    if (!provinceCode?.value) return 'Vui lòng chọn tỉnh/thành phố từ danh sách.';
    if (!wardCode?.value) return 'Vui lòng chọn phường/xã từ danh sách.';
    return null;
  }

  function notificationExcerpt(value, limit = 120) {
    const text = String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return 'Thông báo không có nội dung chi tiết.';
    return text.length > limit ? `${text.slice(0, limit).trim()}...` : text;
  }

  function sanitizeNotificationHtml(value) {
    const raw = String(value || '').trim();
    if (!raw) return '<p>Thông báo không có nội dung chi tiết.</p>';
    if (!/[<>]/.test(raw)) {
      return `<p>${escapeHtml(raw).replace(/\n/g, '<br />')}</p>`;
    }
    const template = document.createElement('template');
    template.innerHTML = raw;
    const allowedTags = new Set(['P', 'BR', 'DIV', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'A', 'IMG', 'H3', 'H4', 'BLOCKQUOTE', 'SPAN']);
    const walker = (node) => {
      [...node.children].forEach((child) => {
        if (!allowedTags.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          return;
        }
        [...child.attributes].forEach((attribute) => {
          const name = attribute.name.toLowerCase();
          const value = attribute.value || '';
          if (child.tagName === 'A' && name === 'href') {
            if (/^(https?:\/\/|\/)/i.test(value)) {
              child.setAttribute('href', value);
              child.setAttribute('target', '_blank');
              child.setAttribute('rel', 'noreferrer');
            } else {
              child.removeAttribute(attribute.name);
            }
            return;
          }
          if (child.tagName === 'IMG' && ['src', 'alt', 'title'].includes(name)) {
            if (name === 'src') {
              const resolved = store.resolveMediaUrl(value);
              if (resolved) child.setAttribute('src', resolved);
              else child.removeAttribute('src');
            }
            return;
          }
          if (name === 'style') {
            child.removeAttribute(attribute.name);
            return;
          }
          if (!['class'].includes(name)) {
            child.removeAttribute(attribute.name);
          }
        });
        if (child.tagName === 'IMG') {
          child.setAttribute('loading', 'lazy');
          child.classList.add('notification-detail-image');
        }
        walker(child);
      });
    };
    walker(template.content);
    return template.innerHTML || '<p>Thông báo không có nội dung chi tiết.</p>';
  }

  function effectiveProductPrice(product) {
    return Number(product?.sale_price || product?.price || 0);
  }

  function topAdvisorProducts(limit = 3) {
    return [...(state.products || [])]
      .sort((a, b) => (
        Number(Boolean(b.is_featured)) - Number(Boolean(a.is_featured))
        || Number(b.stock_total || 0) - Number(a.stock_total || 0)
        || Number(b.sold_count || 0) - Number(a.sold_count || 0)
        || Number(b.rating || 0) - Number(a.rating || 0)
      ))
      .slice(0, limit);
  }

  function aiQuickPrompts() {
    return [
      'Tư vấn cơ cho người mới',
      'Cơ carom dưới 5 triệu',
      'Cơ pool tầm trung',
      'Cơ phá nhảy',
      'Phụ kiện nên mua thêm'
    ];
  }

  function ensureAiAdvisorHistory() {
    if (state.aiAdvisorHistory.length) return;
    state.aiAdvisorHistory = [{
      role: 'assistant',
      text: 'Chào bạn. Mình có thể tư vấn nhanh theo nhu cầu, tầm giá và loại cơ trong catalog hiện tại.',
      suggestions: topAdvisorProducts(3),
      followUpPrompts: aiQuickPrompts()
    }];
  }

  function aiProductCard(product) {
    return `<a class="ai-product-card" href="product.html?slug=${encodeURIComponent(product.slug)}">
      <img src="${normalizeImageUrl(product.cover_image, product.name)}" data-fallback-src="${placeholderImage(product.name)}" alt="${escapeHtml(product.name)}" loading="lazy" />
      <div class="ai-product-copy">
        <strong>${escapeHtml(product.name)}</strong>
        <span>${escapeHtml([product.brand, product.category_name || product.type].filter(Boolean).join(' • '))}</span>
        <b>${store.currency(effectiveProductPrice(product))}</b>
      </div>
    </a>`;
  }

  function aiMessageHtml(message) {
    const suggestions = Array.isArray(message?.suggestions) ? message.suggestions.slice(0, 4) : [];
    return `<article class="ai-message ${message.role === 'user' ? 'user' : 'assistant'}">
      <div class="ai-bubble">
        <p>${escapeHtml(message.text || '')}</p>
        ${suggestions.length ? `<div class="ai-suggestion-list">${suggestions.map(aiProductCard).join('')}</div>` : ''}
      </div>
    </article>`;
  }

  function normalizeAdvisorText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .trim();
  }

  function detectAdvisorCategory(question) {
    const normalized = normalizeAdvisorText(question);
    if (/(phu kien|phu-kien|gang tay|bao co|tip|lo|phan|chalk|shaft)/.test(normalized)) return 'phu-kien';
    if (/(pha nhay|pha\/nhay|pha|nhay|break|jump)/.test(normalized)) return 'gay-pha-nhay';
    if (/(carom|3 bang|3bang|libre)/.test(normalized)) return 'gay-carom';
    if (/(pool|lo)/.test(normalized)) return 'gay-pool';
    return '';
  }

  function detectAdvisorBudget(question) {
    const normalized = normalizeAdvisorText(question);
    const values = [];
    normalized.replace(/(\d+(?:[.,]\d+)?)\s*(trieu|tr|m|k|nghin|ngan)?/g, (_match, amount, unit) => {
      const numeric = Number(String(amount).replace(',', '.'));
      if (!Number.isFinite(numeric)) return '';
      let multiplier = 1;
      if (unit === 'trieu' || unit === 'tr' || unit === 'm') multiplier = 1000000;
      if (unit === 'k' || unit === 'nghin' || unit === 'ngan') multiplier = 1000;
      values.push(Math.round(numeric * multiplier));
      return '';
    });
    if (values.length >= 2 && /(tu|khoang|range|den)/.test(normalized)) {
      const sorted = [...values].sort((a, b) => a - b);
      return { min: sorted[0], max: sorted[1] };
    }
    if (values.length >= 1) {
      if (/(duoi|toi da|khong qua)/.test(normalized)) return { max: values[0] };
      if (/(tren|it nhat|tu)/.test(normalized)) return { min: values[0] };
    }
    if (/(gia re|tiet kiem|nguoi moi|nhap mon|beginner)/.test(normalized)) return { max: 7000000 };
    if (/(tam trung|mid-range|mid range)/.test(normalized)) return { min: 7000000, max: 15000000 };
    if (/(cao cap|pro|premium)/.test(normalized)) return { min: 15000000 };
    return {};
  }

  function suggestAdvisorProducts(question) {
    const normalized = normalizeAdvisorText(question);
    const categorySlug = detectAdvisorCategory(normalized);
    const budget = detectAdvisorBudget(normalized);
    const brands = [...new Set((state.products || []).map((product) => String(product.brand || '').trim()).filter(Boolean))];
    const matchedBrand = brands.find((brand) => normalized.includes(normalizeAdvisorText(brand))) || '';
    const tokens = normalized.split(/\s+/).filter((token) => token.length > 1);
    const allProducts = Array.isArray(state.products) ? state.products : [];

    let candidates = [...allProducts];
    if (categorySlug) {
      candidates = candidates.filter((product) => product.category_slug === categorySlug);
    }
    if (matchedBrand) {
      candidates = candidates.filter((product) => normalizeAdvisorText(product.brand).includes(normalizeAdvisorText(matchedBrand)));
    }
    if (budget.min || budget.max) {
      candidates = candidates.filter((product) => {
        const price = effectiveProductPrice(product);
        if (budget.min && price < budget.min) return false;
        if (budget.max && price > budget.max) return false;
        return true;
      });
    }
    if (!candidates.length) {
      return [];
    }

    const scored = candidates.map((product) => {
      const haystack = normalizeAdvisorText([
        product.name,
        product.brand,
        product.type,
        product.category_name,
        product.description,
        product.joint_type,
        product.shaft_material
      ].join(' '));
      const price = effectiveProductPrice(product);
      let score = Number(product.stock_total || 0) > 0 ? 50 : -80;
      if (product.is_featured) score += 18;
      score += Math.min(16, Number(product.sold_count || 0) / 4);
      score += Math.min(10, Number(product.rating || 0) * 2);
      if (categorySlug && product.category_slug === categorySlug) score += 40;
      if (matchedBrand && normalizeAdvisorText(product.brand).includes(normalizeAdvisorText(matchedBrand))) score += 25;
      if (budget.min && price >= budget.min) score += 15;
      if (budget.max && price <= budget.max) score += 18;
      if (budget.min && budget.max && price >= budget.min && price <= budget.max) score += 12;
      score += tokens.reduce((total, token) => total + (haystack.includes(token) ? 4 : 0), 0);
      return { product, score };
    });

    const best = scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.product)
      .slice(0, 4);

    if (best.length) return best;
    if (categorySlug || matchedBrand || budget.min || budget.max) return [];
    if (categorySlug) {
      const categoryFallback = allProducts
        .filter((product) => product.category_slug === categorySlug)
        .sort((a, b) => (
          Number(Boolean(b.is_featured)) - Number(Boolean(a.is_featured))
          || Number(b.sold_count || 0) - Number(a.sold_count || 0)
          || Number(b.rating || 0) - Number(a.rating || 0)
        ))
        .slice(0, 4);
      if (categoryFallback.length) return categoryFallback;
    }
    return topAdvisorProducts(4);
  }

  function buildLocalAdvisorReply(question) {
    const suggestions = suggestAdvisorProducts(question);
    const categorySlug = detectAdvisorCategory(question);
    const budget = detectAdvisorBudget(question);
    let message = 'Mình đã chọn nhanh một vài sản phẩm phù hợp từ catalog hiện tại để bạn tham khảo.';
    if (categorySlug === 'gay-carom') message = 'Mình đã lọc nhanh một vài cơ carom phù hợp từ catalog hiện tại để bạn tham khảo.';
    if (categorySlug === 'gay-pool') message = 'Mình đã lọc nhanh một vài cơ pool phù hợp từ catalog hiện tại để bạn tham khảo.';
    if (categorySlug === 'gay-pha-nhay') message = 'Mình đã lọc nhanh một vài cơ phá nhảy phù hợp để bạn xem nhanh.';
    if (categorySlug === 'phu-kien') message = 'Mình đã chọn nhanh một vài phụ kiện phù hợp để bạn dễ ghép mua cùng.';
    if (budget.max && budget.max <= 7000000) message += ' Ưu tiên đang là các mẫu dễ tiếp cận hơn về giá.';
    if (!categorySlug && !budget.min && !budget.max) {
      message = 'Nhu cầu của bạn còn hơi chung. Mình đề xuất trước vài mẫu nổi bật, bạn có thể hỏi rõ hơn theo loại cơ, tầm giá hoặc thương hiệu.';
    }
    if (!suggestions.length) {
      message = 'Mình chưa thấy sản phẩm phù hợp đúng với yêu cầu này trong catalog hiện tại. Bạn có thể nới ngân sách, đổi danh mục hoặc hỏi theo thương hiệu để mình lọc lại.';
    }
    return {
      message,
      suggestions,
      followUpPrompts: aiQuickPrompts()
    };
  }

  async function submitAiAdvisorQuery(rawQuery) {
    const question = String(rawQuery || '').trim();
    if (!question || state.aiAdvisorLoading) return;

    ensureAiAdvisorHistory();
    state.aiAdvisorOpen = true;
    state.aiAdvisorLoading = true;
    state.aiAdvisorHistory.push({ role: 'user', text: question });
    renderFloatingActions();

    try {
      const result = buildLocalAdvisorReply(question);
      state.aiAdvisorHistory.push({
        role: 'assistant',
        text: String(result?.message || 'Mình đã tìm xong một vài gợi ý phù hợp cho bạn.'),
        suggestions: Array.isArray(result?.suggestions) ? result.suggestions.slice(0, 4) : [],
        followUpPrompts: Array.isArray(result?.followUpPrompts) ? result.followUpPrompts.slice(0, 4) : aiQuickPrompts()
      });
    } catch (error) {
      state.aiAdvisorHistory.push({
        role: 'assistant',
        text: `Mình chưa lấy được gợi ý lúc này: ${error.message}`,
        suggestions: topAdvisorProducts(3),
        followUpPrompts: aiQuickPrompts()
      });
    } finally {
      state.aiAdvisorLoading = false;
      renderFloatingActions();
      const input = $('#aiAdvisorInput');
      if (input) {
        input.value = '';
        input.focus();
      }
      const transcript = $('#aiAdvisorTranscript');
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    }
  }

  function renderFloatingActions() {
    document.querySelector('.floating-actions')?.remove();
    document.querySelector('.ai-advisor-modal')?.remove();

    ensureAiAdvisorHistory();

    const actions = document.createElement('div');
    actions.className = 'floating-actions';
    const items = [
      `<button type="button" class="floating-ai-trigger" id="aiAdvisorToggle" title="AI tư vấn" aria-expanded="${state.aiAdvisorOpen ? 'true' : 'false'}">AI</button>`
    ];
    if (state.settings?.zalo) items.push(`<a href="${state.settings.zalo}" target="_blank" rel="noreferrer" title="Zalo">💬</a>`);
    if (state.settings?.messenger) items.push(`<a href="${state.settings.messenger}" target="_blank" rel="noreferrer" title="Liên hệ">✉️</a>`);
    actions.innerHTML = items.join('');
    document.body.appendChild(actions);

    const latestAssistantPrompts = [...state.aiAdvisorHistory]
      .reverse()
      .find((message) => message?.role === 'assistant' && Array.isArray(message.followUpPrompts))
      ?.followUpPrompts || aiQuickPrompts();
    const promptPool = [...new Set(latestAssistantPrompts.map((prompt) => String(prompt || '').trim()).filter(Boolean))].slice(0, 5);

    const modal = document.createElement('section');
    modal.className = `ai-advisor-modal${state.aiAdvisorOpen ? ' active' : ''}`;
    modal.innerHTML = `<div class="card ai-advisor-card">
      <div class="ai-advisor-header">
        <div>
          <strong>AI tư vấn sản phẩm</strong>
          <p>Hỏi nhu cầu, tầm giá hoặc loại cơ bạn đang tìm.</p>
        </div>
        <button type="button" class="ai-advisor-close" id="aiAdvisorClose" aria-label="Đóng">×</button>
      </div>
      <div class="ai-advisor-body" id="aiAdvisorTranscript">
        ${state.aiAdvisorHistory.map(aiMessageHtml).join('')}
        ${state.aiAdvisorLoading ? '<article class="ai-message assistant"><div class="ai-bubble ai-loading">Đang phân tích nhu cầu và tìm sản phẩm phù hợp...</div></article>' : ''}
      </div>
      <div class="ai-advisor-footer">
        <div class="ai-quick-prompts">
          <span class="ai-prompt-label">Gợi ý nhanh</span>
          <div class="ai-prompt-list">
            ${promptPool.map((prompt) => `<button type="button" class="ai-prompt-chip" data-ai-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('')}
          </div>
        </div>
        <form class="ai-advisor-form" id="aiAdvisorForm">
        <input id="aiAdvisorInput" name="question" type="text" maxlength="700" placeholder="Ví dụ: phụ kiện dưới 10 triệu" ${state.aiAdvisorLoading ? 'disabled' : ''} />
        <button class="btn btn-primary" type="submit" ${state.aiAdvisorLoading ? 'disabled' : ''}>Gửi</button>
        </form>
      </div>
    </div>`;
    document.body.appendChild(modal);
    applyImageFallback(modal);

    $('#aiAdvisorToggle')?.addEventListener('click', () => {
      state.aiAdvisorOpen = !state.aiAdvisorOpen;
      renderFloatingActions();
      if (state.aiAdvisorOpen) $('#aiAdvisorInput')?.focus();
    });
    $('#aiAdvisorClose')?.addEventListener('click', () => {
      state.aiAdvisorOpen = false;
      renderFloatingActions();
    });
    $('#aiAdvisorForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitAiAdvisorQuery($('#aiAdvisorInput')?.value || '');
    });
    $all('[data-ai-prompt]', modal).forEach((button) => {
      button.addEventListener('click', async () => {
        await submitAiAdvisorQuery(button.dataset.aiPrompt || '');
      });
    });

    if (state.aiAdvisorOpen) {
      const transcript = $('#aiAdvisorTranscript');
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    }
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
    const city = String(fd.get('city') || '').trim();
    const ward = String(fd.get('ward') || '').trim();
    const line1 = String(fd.get('line1') || '').trim();
    const paymentMethod = String(fd.get('paymentMethod') || '').trim();

    if (!isValidFullName(fullName)) return 'Họ tên phải có ít nhất 2 ký tự và không được chứa số.';
    if (!isValidGmail(email)) return 'Vui lòng nhập địa chỉ email hợp lệ.';
    if (!/^0\d{9}$/.test(phone)) return 'Số điện thoại phải gồm đúng 10 số và bắt đầu bằng 0.';
    if (!city) return 'Vui lòng chọn tỉnh/thành phố.';
    if (!ward) return 'Vui lòng chọn phường/xã.';
    if (!line1) return 'Vui lòng nhập địa chỉ giao hàng.';
    if (!['cod', 'vnpay'].includes(paymentMethod)) return 'Phương thức thanh toán không hợp lệ.';
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
      if (page === 'checkout') return renderCheckout();
      if (page === 'login') return renderLoginPage();
      if (page === 'register') return renderRegisterPage();
      if (page === 'verify-email') return renderVerifyEmailPage();
      if (page === 'account') return renderAccount();
      if (page === 'notifications') return renderNotificationsPage();
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
    const accountHref = state.me ? 'account.html' : 'login.html';
    document.querySelector('.topbar')?.remove();
    document.querySelector('.floating-actions')?.remove();
    document.querySelector('.ai-advisor-modal')?.remove();
    document.querySelector('.footer')?.remove();
    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML = `<div class="container">
      <a class="logo" href="index.html"><span class="logo-mark">🎱</span><span>${state.settings.siteName}</span></a>
      <nav class="nav">
        <a class="${page === 'home' ? 'active' : ''}" href="index.html">Trang chủ</a>
        <a class="${page === 'products' ? 'active' : ''}" href="products.html">Sản phẩm</a>
        <a class="${['cart', 'checkout'].includes(page) ? 'active' : ''}" href="cart.html">Giỏ hàng</a>
        <a class="${['account','review','login','register','verify-email','notifications'].includes(page) ? 'active' : ''}" href="${accountHref}">Tài khoản</a>
        <a class="${page === 'info' ? 'active' : ''}" href="info.html">Chính sách & Liên hệ</a>
        <a href="admin.html" target="_blank" rel="noreferrer"></a>
      </nav>
      <div class="header-actions">
        <div class="search-box" style="min-width:280px;"><input id="smartSearch" type="search" placeholder="Tìm gậy, thương hiệu, SKU..." /><div class="search-suggest" id="searchSuggest"></div></div>
        <button class="btn" id="themeToggle">🌓</button>
        ${state.me ? `<a class="btn ${page === 'notifications' ? 'btn-primary' : ''}" href="notifications.html" title="Thông báo">🔔 ${unreadCount}</a>` : ''}
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
    renderFloatingActions();
    const footer = document.createElement('footer');
    footer.className = 'footer';
    footer.innerHTML = `<div class="container grid-3"><div><div class="logo" style="margin-bottom:12px;"><span class="logo-mark">🎱</span><span>${state.settings.siteName}</span></div><p class="muted">Showroom: ${state.settings.showroom}</p><p class="muted">Hotline: ${state.settings.hotline}</p></div><div><strong>Chính sách quan trọng</strong><p class="muted">${state.settings.shippingPolicy}</p></div><div><strong>Tài khoản hiện tại</strong><p class="muted">${state.me?.user?.fullName || 'Khách vãng lai'} ${state.me?.user?.membershipLevel ? '• ' + state.me.user.membershipLevel : ''}</p></div></div>`;
    document.body.appendChild(footer);
    applyImageFallback(document);
  }

  const categoryImages = {
    'gay-pool': '/uploads/products/predator-p3-revo-bocote-wrapless-uni-loc-1536x864-1776303192413-ujfyg1.jpg',
    'gay-carom': '/uploads/products/adam-1776302107586-w3xwkc.jpg',
    'gay-pha-nhay': '/uploads/banners/co-pha-nhay-1776303840426-m5ouap.jpg',
    'phu-kien': '/uploads/products/taom-v10-1776303135825-m7vhdg.jpg'
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
      : `<div class="notice"><strong>Đăng nhập để đánh giá</strong><div class="muted">Bạn cần đăng nhập và đánh giá từ chính đơn hàng đã mua.</div><div style="margin-top:10px;"><a class="btn btn-primary" href="login.html">Đăng nhập ngay</a></div></div>`;
    app.innerHTML = `<section class="section"><div class="container"><div class="grid-2"><div><div class="card" style="padding:18px;"><img id="mainImage" src="${normalizeImageUrl(images[0].image_url, product.name)}" data-fallback-src="${placeholderImage(product.name)}" alt="${product.name}" style="width:100%;border-radius:18px;object-fit:cover;" /><div class="inline-actions" style="margin-top:12px;flex-wrap:wrap;">${images.map((img, index) => `<img class="thumb-img" src="${normalizeImageUrl(img.image_url, `${product.name} ${index + 1}`)}" data-fallback-src="${placeholderImage(product.name)}" data-src="${normalizeImageUrl(img.image_url, product.name)}" width="90" style="border-radius:12px;cursor:pointer;object-fit:cover;" />`).join('')}</div></div></div><div><div class="card" style="padding:22px;"><div class="badge">${product.brand}</div><h1>${product.name}</h1><div class="meta-row"><span>SKU: ${product.sku}</span><span>${Number(product.stock_total) > 0 ? 'Còn hàng' : 'Hết hàng'}</span></div><div class="price-row" style="margin:14px 0;"><strong>${store.currency(product.sale_price || product.price)}</strong>${product.sale_price ? `<span class="old-price">${store.currency(product.price)}</span>` : ''}</div><p class="muted">${product.description}</p><form id="addCartForm" class="stack-form" style="margin-top:16px;"><label><span>Biến thể</span><select name="variantId"><option value="">Mặc định</option>${(product.variants || []).map((v) => `<option value="${v.id}">${v.weight || '-'} • ${v.tip_size || '-'} • tồn ${v.stock}</option>`).join('')}</select></label><fieldset><legend>Dịch vụ kèm theo</legend>${(product.services || []).map((s) => `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="services" value="${s.code}" /> ${s.name} (+${store.currency(s.price)})</label>`).join('') || '<div class="muted">Không có dịch vụ thêm.</div>'}</fieldset><label><span>Số lượng</span><input type="number" name="quantity" min="1" value="1" /></label><div class="inline-actions"><button class="btn btn-primary" type="submit">Thêm vào giỏ</button>${state.me ? `<button class="btn" type="button" id="wishlistBtn">♡ Yêu thích</button>` : ''}</div></form></div><div class="card" style="padding:22px;margin-top:18px;"><h2>Bảng thông số kỹ thuật</h2><table class="admin-table"><tbody><tr><td>Loại ren</td><td>${product.joint_type || '-'}</td></tr><tr><td>Ngọn</td><td>${product.shaft_material || '-'}</td></tr><tr><td>Chuôi</td><td>${product.butt_material || '-'}</td></tr><tr><td>Trọng lượng</td><td>${(product.variants || []).map((v) => v.weight).filter(Boolean).join(', ') || '-'}</td></tr><tr><td>Đầu cơ</td><td>${product.tip_size || '-'}</td></tr></tbody></table></div></div></div><div class="section-title" style="margin-top:24px;"><div><h2>Đánh giá khách hàng</h2><p class="muted"></p></div></div><div class="grid-2"><div class="card" style="padding:22px;">${reviewsHtml}</div><div class="card" style="padding:22px;"><h3>Đánh giá từ đơn hàng</h3>${reviewHelpHtml}</div></div><div class="section-title" style="margin-top:24px;"><div><h2>Sản phẩm gợi ý</h2><p class="muted"></p></div></div><div class="product-grid">${(product.collaborativeSuggestions || []).map(productCard).join('')}</div></div></section>`;
    applyImageFallback(app);
    $all('.thumb-img').forEach((img) => img.onclick = () => { $('#mainImage').src = img.dataset.src; });
    $('#addCartForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (!store.getToken()) {
        notify('Vui lòng đăng nhập trước khi thêm sản phẩm vào giỏ hàng.', 'warning');
        location.href = 'login.html';
        return;
      }
      try {
        const cart = await store.addToCart({ productId: product.id, variantId: fd.get('variantId') || null, quantity: Number(fd.get('quantity') || 1), selectedServices: fd.getAll('services') });
        state.cart = cart;
        renderHeader();
        notify('Đã thêm vào giỏ hàng.');
      } catch (error) {
        if (error.status === 401) {
          notify('Vui lòng đăng nhập trước khi thêm sản phẩm vào giỏ hàng.', 'warning');
          location.href = 'login.html';
          return;
        }
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
    const selectedLines = () => lines.filter((line) => line.isSelected);
    const selectedSubtotal = () => selectedLines().reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
    const mustLoginHtml = !state.me ? `<div class="notice" style="margin-bottom:14px;"><strong>Vui lòng đăng nhập để đặt hàng</strong><div class="muted">Bạn vẫn có thể xem giỏ hàng, nhưng phải đăng nhập trước khi thanh toán.</div><div style="margin-top:10px;"><a class="btn btn-primary" href="login.html">Đăng nhập</a><a class="btn" href="register.html">Đăng ký</a></div></div>` : '';

    function renderCartSummary() {
      const selected = selectedLines();
      const subtotal = selectedSubtotal();
      $('#cartSelectedCount').textContent = `${selected.length} mục`;
      $('#cartSubtotal').textContent = store.currency(subtotal);
      $('#cartCheckoutBtn').toggleAttribute('disabled', !state.me || !selected.length);
    }

    app.innerHTML = `<section class="section"><div class="container"><div class="section-title"><div><h1>Giỏ hàng</h1><p class="muted">Chọn sản phẩm muốn mua, sau đó bấm thanh toán để sang trang đặt hàng.</p></div><a class="btn" href="products.html">Tiếp tục mua sắm</a></div>${mustLoginHtml}<div class="cart-layout"><div class="card cart-panel">${lines.length ? lines.map((line) => `<article class="cart-item-row"><label class="cart-item-check"><input type="checkbox" class="cart-check" data-id="${line.id}" ${line.isSelected ? 'checked' : ''} /></label><a class="cart-item-media" href="product.html?slug=${line.product.slug}"><img src="${normalizeImageUrl(line.product.coverImage, line.product.name)}" data-fallback-src="${placeholderImage(line.product.name)}" alt="${escapeHtml(line.product.name)}" /></a><div class="cart-item-info"><a class="cart-item-name" href="product.html?slug=${line.product.slug}">${escapeHtml(line.product.name)}</a><div class="muted">${line.variant ? `${escapeHtml(line.variant.weight || '-')} • ${escapeHtml(line.variant.tipSize || '-')}` : 'Bản mặc định'}</div><div class="muted">Dịch vụ: ${escapeHtml(line.services.map((s) => s.name).join(', ') || 'Không')}</div><div class="muted">Đơn giá: ${store.currency(line.unitPrice)}</div></div><div class="cart-item-qty"><span class="cart-item-label">Số lượng</span><input type="number" min="1" class="cart-qty" data-id="${line.id}" value="${line.quantity}" /></div><div class="cart-item-price"><span class="cart-item-label">Thành tiền</span><strong>${store.currency(line.lineTotal)}</strong></div><div class="cart-item-actions"><button class="btn btn-danger cart-remove" data-id="${line.id}" type="button">Xóa</button></div></article>`).join('') : '<div class="muted">Giỏ hàng đang trống.</div>'}</div><aside class="card checkout-panel"><div class="checkout-panel-head"><h2>Tóm tắt giỏ hàng</h2><p class="muted">Trang thanh toán chỉ mở khi có ít nhất một sản phẩm được chọn.</p></div><div class="kpi-list checkout-summary-list"><div class="list-line"><span>Đã chọn</span><strong id="cartSelectedCount">${selectedLines().length} mục</strong></div><div class="list-line"><span>Tạm tính</span><strong id="cartSubtotal">${store.currency(selectedSubtotal())}</strong></div></div><div class="checkout-actions"><button class="btn btn-primary" type="button" id="cartCheckoutBtn" ${state.me && selectedLines().length ? '' : 'disabled'}>Thanh toán</button><button class="btn" type="button" id="deleteSelected" ${selectedLines().length ? '' : 'disabled'}>Xóa mục đã chọn</button></div></aside></div></div></section>`;

    applyImageFallback(app);
    $('#cartCheckoutBtn').onclick = () => { location.href = 'checkout.html'; };
    $all('.cart-check').forEach((checkbox) => {
      checkbox.onchange = async () => {
        const id = Number(checkbox.dataset.id);
        const line = lines.find((item) => item.id === id);
        if (!line) return;
        line.isSelected = checkbox.checked;
        renderCartSummary();
        try { state.cart = await store.updateCartItem(id, { isSelected: checkbox.checked }); renderHeader(); }
        catch (error) { checkbox.checked = !checkbox.checked; line.isSelected = checkbox.checked; renderCartSummary(); notify(error.message, 'danger'); }
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
    $('#deleteSelected').onclick = async () => {
      try { state.cart = await store.removeSelectedCartItems(); renderHeader(); renderCart(); }
      catch (error) { notify(error.message, 'danger'); }
    };
  }

  async function renderCheckout() {
    state.cart = await store.fetchCart();
    renderHeader();
    const lines = state.cart.items || [];
    const savedAddresses = state.me?.addresses || [];
    const defaultAddress = savedAddresses.find((item) => Number(item.is_default)) || savedAddresses[0] || null;
    const mustLoginHtml = !state.me ? `<div class="notice" style="margin-bottom:14px;"><strong>Vui lòng đăng nhập để đặt hàng</strong><div class="muted">Bạn vẫn có thể thêm sản phẩm vào giỏ, nhưng phải đăng nhập trước khi tạo đơn.</div><div style="margin-top:10px;"><a class="btn btn-primary" href="login.html">Đăng nhập</a><a class="btn" href="register.html">Đăng ký</a></div></div>` : '';

    function selectedLines() { return lines.filter((line) => line.isSelected); }
    function baseShippingAmount() { return selectedLines().length ? Number(state.settings.shipping?.standard || 45000) : 0; }
    if (!selectedLines().length) {
      app.innerHTML = `<section class="section"><div class="container"><div class="card" style="padding:22px;max-width:720px;margin:0 auto;"><h1>Chưa có sản phẩm để thanh toán</h1><p class="muted">Hãy chọn ít nhất một sản phẩm trong giỏ hàng trước khi mở trang thanh toán.</p><div class="inline-actions" style="margin-top:14px;"><a class="btn btn-primary" href="cart.html">Quay lại giỏ hàng</a><a class="btn" href="products.html">Tiếp tục mua sắm</a></div></div></div></section>`;
      return;
    }
    function currentCouponState() {
      const couponInput = $('#checkoutForm [name="couponCode"]');
      const subtotal = selectedLines().reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
      return evaluateCoupon(couponInput ? couponInput.value : '', subtotal);
    }
    function syncAddressFields(addressId) {
      const form = $('#checkoutForm');
      if (!form) return null;
      const address = savedAddresses.find((item) => Number(item.id) === Number(addressId)) || null;
      if (!address) {
        form.fullName.value = state.me?.user?.fullName || '';
        form.phone.value = state.me?.user?.phone || '';
        form.line1.value = '';
        return null;
      }
      form.fullName.value = address.recipient_name || state.me?.user?.fullName || '';
      form.phone.value = address.phone || state.me?.user?.phone || '';
      form.line1.value = address.line1 || '';
      return address;
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

    app.innerHTML = `<section class="section"><div class="container"><div class="section-title"><div><h1>Thanh toán</h1><p class="muted">Nhập thông tin giao hàng và phương thức thanh toán để tạo đơn.</p></div><a class="btn" href="cart.html">Quay lại giỏ hàng</a></div>${mustLoginHtml}<div class="cart-layout"><div class="card cart-panel">${lines.length ? lines.map((line) => `<article class="cart-item-row"><label class="cart-item-check"><input type="checkbox" class="cart-check" data-id="${line.id}" ${line.isSelected ? 'checked' : ''} /></label><a class="cart-item-media" href="product.html?slug=${line.product.slug}"><img src="${normalizeImageUrl(line.product.coverImage, line.product.name)}" data-fallback-src="${placeholderImage(line.product.name)}" alt="${escapeHtml(line.product.name)}" /></a><div class="cart-item-info"><a class="cart-item-name" href="product.html?slug=${line.product.slug}">${escapeHtml(line.product.name)}</a><div class="muted">${line.variant ? `${escapeHtml(line.variant.weight || '-')} • ${escapeHtml(line.variant.tipSize || '-')}` : 'Bản mặc định'}</div><div class="muted">Dịch vụ: ${escapeHtml(line.services.map((s) => s.name).join(', ') || 'Không')}</div><div class="muted">Đơn giá: ${store.currency(line.unitPrice)}</div></div><div class="cart-item-qty"><span class="cart-item-label">Số lượng</span><input type="number" min="1" class="cart-qty" data-id="${line.id}" value="${line.quantity}" /></div><div class="cart-item-price"><span class="cart-item-label">Thành tiền</span><strong>${store.currency(line.lineTotal)}</strong></div><div class="cart-item-actions"><a class="btn" href="cart.html">Sửa</a></div></article>`).join('') : '<div class="muted">Giỏ hàng đang trống.</div>'}</div><div class="card checkout-panel"><div class="checkout-panel-head"><h2>Thông tin thanh toán</h2><p class="muted">Hoàn tất thông tin để tạo đơn nhanh hơn.</p></div><div class="kpi-list checkout-summary-list"><div class="list-line"><span>Tạm tính</span><strong id="cartSubtotal">${store.currency(selectedLines().reduce((sum, line) => sum + Number(line.lineTotal || 0), 0))}</strong></div><div class="list-line"><span>Giảm giá</span><strong id="cartDiscount">${store.currency(0)}</strong></div><div class="list-line"><span>Phí ship chuẩn</span><strong id="cartShipping">${store.currency(baseShippingAmount())}</strong></div><div class="list-line"><span>Tổng thanh toán</span><strong id="cartGrandTotal">${store.currency(selectedLines().reduce((sum, line) => sum + Number(line.lineTotal || 0), 0) + baseShippingAmount())}</strong></div></div><form id="checkoutForm" class="stack-form checkout-form">${savedAddresses.length ? `<div class="checkout-section"><label><span>Chọn địa chỉ đã lưu</span><select name="savedAddressId" id="savedAddressSelect"><option value="">-- Nhập địa chỉ mới --</option>${savedAddresses.map((address) => `<option value="${address.id}" ${defaultAddress && Number(defaultAddress.id) === Number(address.id) ? 'selected' : ''}>${escapeHtml(address.label || 'Địa chỉ')} • ${escapeHtml(address.recipient_name || state.me?.user?.fullName || '')} • ${escapeHtml(formatAddressText(address) || address.line1 || '')}</option>`).join('')}</select></label></div>` : ''}<div class="checkout-section"><h3>Thông tin người nhận</h3><div class="form-grid-2"><label><span>Họ tên</span><input name="fullName" minlength="2" value="${defaultAddress?.recipient_name || state.me?.user?.fullName || ''}" required /></label><label><span>Email</span><input name="email" type="email" value="${state.me?.user?.email || ''}" required /></label></div><div class="form-grid-2"><label><span>Điện thoại</span><input name="phone" inputmode="numeric" maxlength="10" pattern="0[0-9]{9}" placeholder="0901234567" value="${defaultAddress?.phone || state.me?.user?.phone || ''}" required /></label><label><span>Mã giảm giá</span><input name="couponCode" placeholder="BIDA500" /></label></div><div class="muted" id="couponStatus">Nhập mã giảm giá để hệ thống tính lại tổng đơn.</div></div><div class="checkout-section"><h3>Địa chỉ giao hàng</h3>${addressFieldsHtml('checkout', { city: defaultAddress?.city || 'TP.HCM', ward: addressAreaText(defaultAddress), line1: defaultAddress?.line1 || '' })}</div><div class="checkout-section"><h3>Thanh toán</h3><label><span>Phương thức thanh toán</span><select name="paymentMethod" required><option value="cod">COD</option><option value="vnpay">VNPay</option></select></label><label><span>Ghi chú</span><textarea name="note" placeholder="Ví dụ: thay đầu cơ trước khi giao"></textarea></label></div><div class="checkout-actions"><button class="btn btn-primary" type="submit" ${state.me ? '' : 'disabled'}>Đặt hàng</button><a class="btn" href="cart.html">Quay lại giỏ hàng</a></div></form></div></div></div></section>`;

    renderSummary();
    applyImageFallback(app);
    const paymentSelect = $('#checkoutForm [name="paymentMethod"]');
    if (paymentSelect) {
      [...paymentSelect.options].forEach((option) => {
        if (!['cod', 'vnpay'].includes(option.value)) option.remove();
      });
    }
    const checkoutPicker = await bindAddressPicker($('#checkoutForm'), 'checkout', {
      city: defaultAddress?.city || 'TP.HCM',
      ward: addressAreaText(defaultAddress),
      line1: defaultAddress?.line1 || ''
    });
    if ($('#savedAddressSelect')) $('#savedAddressSelect').onchange = async (e) => {
      const address = syncAddressFields(e.target.value);
      await checkoutPicker.applyDefaults({
        city: address?.city || '',
        ward: addressAreaText(address),
        line1: address?.line1 || ''
      });
    };
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
        try { state.cart = await store.updateCartItem(id, { quantity }); renderHeader(); renderCheckout(); }
        catch (error) { notify(error.message, 'danger'); }
      };
    });
    $all('.cart-remove').forEach((btn) => { btn.onclick = async () => { try { state.cart = await store.removeCartItem(Number(btn.dataset.id)); renderHeader(); renderCart(); } catch (error) { notify(error.message, 'danger'); } }; });
    if ($('#deleteSelected')) $('#deleteSelected').onclick = async () => { try { state.cart = await store.removeSelectedCartItems(); renderHeader(); renderCart(); } catch (error) { notify(error.message, 'danger'); } };
    $('#checkoutForm').onsubmit = async (e) => {
      e.preventDefault();
      if (!state.me) { notify('Vui lòng đăng nhập trước khi đặt hàng.', 'warning'); location.href = 'login.html'; return; }
      const selected = selectedLines();
      if (!selected.length) return notify('Chọn ít nhất 1 sản phẩm để thanh toán.', 'warning');
      const fd = new FormData(e.target);
      const validationError = validateCheckoutForm(fd);
      if (validationError) return notify(validationError, 'warning');
      const locationError = await validateAddressPickerSelection(e.target, 'checkout');
      if (locationError) return notify(locationError, 'warning');
      const normalizedFd = new FormData(e.target);
      const coupon = evaluateCoupon(normalizedFd.get('couponCode'), selected.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0));
      if (String(normalizedFd.get('couponCode') || '').trim() && !coupon.valid) return notify(coupon.message || 'Voucher không hợp lệ.', 'warning');
      const payload = { customer: { fullName: String(normalizedFd.get('fullName') || '').trim(), email: String(normalizedFd.get('email') || '').trim(), phone: normalizePhone(normalizedFd.get('phone')), address: { line1: String(normalizedFd.get('line1') || '').trim(), ward: String(normalizedFd.get('ward') || '').trim(), city: String(normalizedFd.get('city') || '').trim() } }, paymentMethod: normalizedFd.get('paymentMethod'), note: String(normalizedFd.get('note') || '').trim(), couponCode: String(normalizedFd.get('couponCode') || '').trim() };
      try {
        const result = await store.request('/orders/checkout', { method: 'POST', body: JSON.stringify(payload) });
        state.cart = await store.fetchCart();
        renderHeader();
        if (result.paymentUrl || result.payment?.redirectUrl) { notify('Đang chuyển sang cổng thanh toán...'); location.href = result.paymentUrl || result.payment.redirectUrl; return; }
        notify(`Đặt hàng thành công: ${result.order.order_code}`); location.href = `info.html?order=${result.order.order_code}`;
      } catch (error) {
        if (error.status === 401) {
          notify(error.message, 'warning');
          location.href = 'login.html';
          return;
        }
        notify(error.message, 'danger');
      }
    };
  }

  function startResendCountdown(button, seconds) {
    if (!button) return;
    let remaining = Math.max(0, Number(seconds || 0));
    const render = () => {
      if (remaining > 0) {
        button.disabled = true;
        button.textContent = `Gửi lại OTP (${remaining}s)`;
      } else {
        button.disabled = false;
        button.textContent = 'Gửi lại OTP';
      }
    };
    render();
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      remaining -= 1;
      render();
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
  }

  function mountEmailVerificationCard(root, email, cooldownSeconds = 60) {
    if (!root || !email) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.padding = '22px';
    card.innerHTML = `<h2>Xác thực email</h2><p class="muted">Nhập mã OTP đã gửi tới <strong>${email}</strong>. Bạn phải xác thực email trước khi đăng nhập và thanh toán.</p><form id="verifyEmailForm" class="stack-form"><label><span>Mã OTP</span><input name="otp" inputmode="numeric" maxlength="6" placeholder="123456" required /></label><div class="inline-actions"><button class="btn btn-primary" type="submit">Xác thực</button><button class="btn" type="button" id="resendOtpBtn">Gửi lại OTP</button></div></form>`;
    root.appendChild(card);

    const resendButton = $('#resendOtpBtn', card);
    startResendCountdown(resendButton, cooldownSeconds);

    $('#verifyEmailForm', card).onsubmit = async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      try {
        const data = await store.request('/auth/verify-email', {
          method: 'POST',
          body: JSON.stringify({ email, otp: String(fd.get('otp') || '').trim() })
        });
        clearPendingVerification();
        store.setToken(data.token);
        notify('Email đã được xác thực thành công.');
        location.href = 'account.html';
      } catch (error) {
        notify(error.message, 'danger');
      }
    };

    resendButton.onclick = async () => {
      try {
        const data = await store.request('/auth/resend-email-otp', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        notify('Đã gửi lại mã OTP.');
        startResendCountdown(resendButton, Number(data.cooldownSeconds || 60));
      } catch (error) {
        if (error.code === 'OTP_COOLDOWN') {
          startResendCountdown(resendButton, Number(error.details?.cooldownSeconds || 60));
        }
        notify(error.message, 'warning');
      }
    };
  }

  function registerFormMarkup() {
    return `<form id="registerForm" class="stack-form" novalidate>
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
</form>`;
  }

  function bindLoginForm(form) {
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const data = await store.request('/auth/login', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }) });
        clearPendingVerification();
        store.setToken(data.token);
        await store.mergeGuestCart();
        location.href = 'account.html';
      } catch (error) {
        if (isEmailVerificationRequiredError(error)) {
          const email = error.details?.email || fd.get('email');
          rememberPendingVerification(email);
          notify(error.message, 'warning');
          location.href = `verify-email.html?email=${encodeURIComponent(String(email || '').trim())}`;
          return;
        }
        notify(error.message, 'danger');
      }
    };
  }

  function bindRegisterForm(form) {
    if (!form) return;
    bindRegisterLiveValidation(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const values = readRegisterValues(form);
      const errors = getRegisterErrors(values);

      if (!applyRegisterErrors(form, errors)) {
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

        if (data.requiresEmailVerification) {
          const email = data.email || values.email;
          rememberPendingVerification(email);
          notify('Đăng ký thành công. Vui lòng nhập mã OTP đã gửi qua email.', 'success');
          location.href = `verify-email.html?email=${encodeURIComponent(String(email || '').trim())}`;
          return;
        }
        if (data.token) {
          clearPendingVerification();
          store.setToken(data.token);
          await store.mergeGuestCart();
          location.href = 'account.html';
          return;
        }
        notify(data.message || 'Đăng ký thành công.', 'success');
      } catch (error) {
        notify(error.message, 'danger');
      }
    });
  }

  async function renderLoginPage() {
    if (state.me) {
      location.href = 'account.html';
      return;
    }
    const pendingEmail = pendingVerificationEmail();
    app.innerHTML = `<section class="section"><div class="container" style="max-width:640px;"><div class="card" style="padding:22px;"><div class="section-title"><div><h1>Đăng nhập</h1><p class="muted">Dùng email và mật khẩu để truy cập tài khoản của bạn.</p></div></div><form id="loginForm" class="stack-form"><label><span>Email</span><input name="email" type="email" required /></label><label><span>Mật khẩu</span><input name="password" type="password" required /></label><button class="btn btn-primary" type="submit">Đăng nhập</button></form><div class="inline-actions" style="margin-top:14px;"><a class="btn" href="register.html">Tạo tài khoản</a>${pendingEmail ? `<a class="btn" href="verify-email.html?email=${encodeURIComponent(pendingEmail)}">Nhập OTP</a>` : ''}</div></div></div></section>`;
    bindLoginForm($('#loginForm'));
  }

  async function renderRegisterPage() {
    if (state.me) {
      location.href = 'account.html';
      return;
    }
    const pendingEmail = pendingVerificationEmail();
    app.innerHTML = `<section class="section"><div class="container" style="max-width:720px;"><div class="card" style="padding:22px;"><div class="section-title"><div><h1>Tạo tài khoản</h1><p class="muted">Đăng ký bằng email để xác thực OTP và theo dõi đơn hàng.</p></div></div>${registerFormMarkup()}<div class="inline-actions" style="margin-top:14px;"><a class="btn" href="login.html">Đã có tài khoản</a>${pendingEmail ? `<a class="btn" href="verify-email.html?email=${encodeURIComponent(pendingEmail)}">Đã có mã OTP</a>` : ''}</div></div></div></section>`;
    bindRegisterForm($('#registerForm'));
  }

  async function renderVerifyEmailPage() {
    if (state.me) {
      location.href = 'account.html';
      return;
    }
    const email = String(param('email') || pendingVerificationEmail() || '').trim().toLowerCase();
    app.innerHTML = `<section class="section"><div class="container" style="max-width:720px;"><div id="verifyEmailRoot"></div></div></section>`;
    if (!email) {
      $('#verifyEmailRoot').innerHTML = `<div class="card" style="padding:22px;"><h1>Xác thực email</h1><div class="alert warning">Không tìm thấy email chờ xác thực.</div><div class="inline-actions"><a class="btn btn-primary" href="register.html">Đăng ký</a><a class="btn" href="login.html">Đăng nhập</a></div></div>`;
      return;
    }
    rememberPendingVerification(email);
    mountEmailVerificationCard($('#verifyEmailRoot'), email, 60);
  }

  async function renderAccount() {
    const me = await store.getMeSafe();
    if (!me) {
      location.href = 'login.html';
      return;
    }
    state.me = me;
    clearPendingVerification();
    const orders = await store.request('/auth/orders');
    const reviewTarget = Number(param('orderItemId') || 0);
    const reviewOrderItem = orders.flatMap((o) => o.items || []).find((item) => item.id === reviewTarget);
    const defaultProfileAddress = me.addresses.find((address) => Number(address.is_default) === 1) || me.addresses[0] || null;
    app.innerHTML = `<section class="section"><div class="container"><div class="section-title"><div><h1>Tài khoản khách hàng</h1><p class="muted">Quản lý địa chỉ, điểm tích lũy và đơn hàng.</p></div><button class="btn" id="logoutBtn">Đăng xuất</button></div>${reviewOrderItem ? `<div class="card" style="padding:22px;margin-bottom:18px;"><h2>Đánh giá sản phẩm</h2><div class="muted">${reviewOrderItem.product_name}</div><form id="reviewOrderItemForm" class="stack-form" style="margin-top:14px;"><input type="hidden" name="orderItemId" value="${reviewOrderItem.id}" /><div class="form-grid-2"><label><span>Điểm</span><select name="rating" required><option value="5">5 sao</option><option value="4">4 sao</option><option value="3">3 sao</option><option value="2">2 sao</option><option value="1">1 sao</option></select></label><label><span>Sản phẩm</span><input value="${reviewOrderItem.product_name}" disabled /></label></div><label><span>Nhận xét</span><textarea name="comment" minlength="10" maxlength="500" required placeholder="Chia sẻ trải nghiệm thực tế, tối thiểu 10 ký tự"></textarea></label><div class="inline-actions"><button class="btn btn-primary" type="submit">Gửi đánh giá</button><a class="btn" href="account.html">Hủy</a></div></form></div>` : ''}<div class="grid-2"><div class="card" style="padding:22px;"><h2>Thông tin</h2><div class="kpi-list"><div class="list-line"><span>Họ tên</span><strong>${me.user.fullName}</strong></div><div class="list-line"><span>Email</span><strong>${me.user.email}</strong></div><div class="list-line"><span>Điểm tích lũy</span><strong>${Number(me.user.points || 0).toLocaleString('vi-VN')}</strong></div><div class="list-line"><span>Hạng</span><strong>${me.user.membershipLevel}</strong></div></div><h3 style="margin-top:18px;">Địa chỉ</h3>${me.addresses.map((a) => `<div class="notice"><strong>${a.label}</strong><div class="muted">${a.recipient_name || me.user.fullName} • ${a.phone || ''}</div><div class="muted">${formatAddressText(a)}</div></div>`).join('') || '<div class="muted">Chưa có địa chỉ lưu.</div>'}<form id="addressForm" class="stack-form" style="margin-top:16px;"><div class="form-grid-2"><label><span>Nhãn địa chỉ</span><input name="label" placeholder="Nhà riêng / Công ty" required /></label><label><span>Người nhận</span><input name="recipientName" value="${me.user.fullName}" required /></label></div><label><span>Số điện thoại</span><input name="phone" inputmode="numeric" maxlength="10" pattern="0[0-9]{9}" placeholder="0901234567" required /></label>${addressFieldsHtml('account', { city: defaultProfileAddress?.city || 'TP.HCM', ward: addressAreaText(defaultProfileAddress), line1: defaultProfileAddress?.line1 || '' })}<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="isDefault" checked /> Đặt làm địa chỉ mặc định</label><button class="btn btn-primary" type="submit">Lưu địa chỉ</button></form><h3 style="margin-top:18px;">Wishlist</h3>${me.wishlist.map((w) => `<div class="list-line"><a href="product.html?slug=${w.slug}">${w.name}</a><strong>${store.currency(w.price)}</strong></div>`).join('') || '<div class="muted">Chưa có wishlist.</div>'}</div><div class="card" style="padding:22px;"><h2>Đơn hàng của tôi</h2>${orders.map((o) => `<div class="notice"><div class="list-line"><strong>${o.order_code}</strong><span>${fmtDate(o.created_at)}</span></div><div class="muted">${store.currency(o.grand_total)} • ${o.order_status} • ${o.payment_status}</div><div class="muted">Vận chuyển: ${o.shipping_provider || '-'} • Mã vận đơn: ${o.tracking_code || '-'}</div><ul style="margin:10px 0 0 18px;">${(o.items || []).map((item) => `<li>${item.product_name} x${item.quantity} • ${store.currency(item.line_total)} ${item.canReview ? (item.hasReview ? '<span class="badge active" style="margin-left:8px;">Đã đánh giá</span>' : `<a class="btn" style="margin-left:8px;" href="review.html?orderItemId=${item.id}">Đánh giá sản phẩm</a>`) : ''}</li>`).join('')}</ul></div>`).join('') || '<div class="muted">Chưa có đơn hàng.</div>'}</div></div></div></section>`;
    $('#logoutBtn').onclick = () => { store.setToken(''); location.reload(); };
    await bindAddressPicker($('#addressForm'), 'account', {
      city: defaultProfileAddress?.city || 'TP.HCM',
      ward: addressAreaText(defaultProfileAddress),
      line1: defaultProfileAddress?.line1 || ''
    });
    $('#addressForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (!isValidFullName(fd.get('recipientName'))) return notify('Tên người nhận phải có ít nhất 2 ký tự và không được chứa số.', 'warning');
      if (!/^0\d{9}$/.test(normalizePhone(fd.get('phone')))) return notify('Số điện thoại địa chỉ phải gồm đúng 10 số.', 'warning');
      const locationError = await validateAddressPickerSelection(e.target, 'account');
      if (locationError) return notify(locationError, 'warning');
      const normalizedFd = new FormData(e.target);
      try {
        await store.request('/auth/addresses', { method: 'POST', body: JSON.stringify({ label: normalizedFd.get('label'), recipientName: normalizedFd.get('recipientName'), phone: normalizePhone(normalizedFd.get('phone')), line1: normalizedFd.get('line1'), ward: normalizedFd.get('ward'), district: '', city: normalizedFd.get('city'), isDefault: normalizedFd.get('isDefault') === 'on' }) });
        notify('Đã lưu địa chỉ.');
        location.reload();
      } catch (error) { notify(error.message, 'danger'); }
    };
    if ($('#reviewOrderItemForm')) $('#reviewOrderItemForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const reviewComment = String(fd.get('comment') || '').trim();
      if (reviewContainsLink(reviewComment)) return notify('Nhận xét không được chứa link hoặc địa chỉ website.', 'warning');
      const reviewError = getReviewError({ rating: Number(fd.get('rating')), comment: reviewComment });
      if (reviewError) return notify(reviewError, 'warning');
      try { await store.request('/auth/reviews', { method: 'POST', body: JSON.stringify({ orderItemId: Number(fd.get('orderItemId')), rating: Number(fd.get('rating')), comment: reviewComment }) }); notify('Đã gửi đánh giá thành công.'); location.href = 'account.html'; }
      catch (error) { notify(error.message, 'danger'); }
    };
  }

  async function renderNotificationsPage() {
    const me = await store.getMeSafe();
    if (!me) {
      location.href = 'login.html';
      return;
    }
    state.me = me;
    const notificationId = Number(param('notification') || 0);
    const payload = await store.request('/auth/notifications');
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const selectedIds = new Set();
    let activeId = items.find((item) => Number(item.id) === notificationId)?.id || items[0]?.id || null;

    function syncUnread(unreadCount) {
      state.me.unreadCount = Number(unreadCount || 0);
      state.me.notifications = items.slice(0, 5);
      renderHeader();
    }

    async function markOneAsRead(id) {
      const current = items.find((item) => Number(item.id) === Number(id));
      if (!current || Number(current.is_read)) return;
      await store.request(`/auth/notifications/${id}/read`, { method: 'POST' });
      current.is_read = 1;
      syncUnread(Math.max(0, Number(state.me?.unreadCount || 0) - 1));
    }

    function activeNotification() {
      return items.find((item) => Number(item.id) === Number(activeId)) || null;
    }

    function renderNotificationCenter() {
      const active = activeNotification();
      const allChecked = items.length > 0 && items.every((item) => selectedIds.has(Number(item.id)));
      app.innerHTML = `<section class="section"><div class="container"><div class="section-title"><div><h1>Thông báo</h1><p class="muted">Chỉ hiển thị tiêu đề ở danh sách. Bấm vào từng tiêu đề để xem chi tiết.</p></div><div class="inline-actions"><button class="btn" id="markAllNotificationsReadBtn" type="button">Đánh dấu tất cả đã đọc</button><a class="btn" href="account.html">Quay lại tài khoản</a></div></div><div class="notification-center"><div class="card notification-list-card"><div class="notification-toolbar"><label class="notification-check-all"><input type="checkbox" id="notificationSelectAll" ${allChecked ? 'checked' : ''} /> Chọn tất cả</label><div class="inline-actions"><button class="btn" id="markSelectedNotificationsBtn" type="button">Đánh dấu đã đọc</button><button class="btn btn-danger" id="deleteSelectedNotificationsBtn" type="button">Xóa</button></div></div><div class="notification-list">${items.length ? items.map((item) => `<article class="notification-row ${Number(item.id) === Number(active?.id) ? 'active' : ''} ${Number(item.is_read) ? 'is-read' : 'is-unread'}"><label class="notification-checkbox"><input type="checkbox" data-notification-select="${item.id}" ${selectedIds.has(Number(item.id)) ? 'checked' : ''} /></label><button class="notification-title-btn" type="button" data-notification-open="${item.id}"><strong>${escapeHtml(item.title)}</strong><span>${fmtDate(item.sent_at)}</span><small>${Number(item.is_read) ? 'Đã đọc' : 'Chưa đọc'}</small></button></article>`).join('') : '<div class="empty-state-inline">Chưa có thông báo nào.</div>'}</div></div><div class="card notification-detail-card">${active ? `<div class="notification-detail-head"><div><h2>${escapeHtml(active.title)}</h2><p class="muted">${fmtDate(active.sent_at)} • ${Number(active.is_read) ? 'Đã đọc' : 'Chưa đọc'}</p></div>${Number(active.is_read) ? '' : '<span class="badge active">Mới</span>'}</div><div class="notification-detail-body">${sanitizeNotificationHtml(active.message)}</div>` : '<div class="empty-state-inline">Chọn một thông báo để xem chi tiết.</div>'}</div></div></section>`;
      applyImageFallback(app);

      $('#notificationSelectAll')?.addEventListener('change', (event) => {
        if (event.target.checked) items.forEach((item) => selectedIds.add(Number(item.id)));
        else selectedIds.clear();
        renderNotificationCenter();
      });
      $all('[data-notification-select]').forEach((input) => {
        input.addEventListener('change', () => {
          const id = Number(input.dataset.notificationSelect);
          if (input.checked) selectedIds.add(id);
          else selectedIds.delete(id);
          renderNotificationCenter();
        });
      });
      $all('[data-notification-open]').forEach((button) => {
        button.addEventListener('click', async () => {
          activeId = Number(button.dataset.notificationOpen);
          try {
            await markOneAsRead(activeId);
          } catch (error) {
            notify(error.message, 'danger');
          }
          renderNotificationCenter();
        });
      });
      $('#markSelectedNotificationsBtn')?.addEventListener('click', async () => {
        const ids = [...selectedIds];
        if (!ids.length) return notify('Hãy chọn ít nhất một thông báo.', 'warning');
        try {
          await store.request('/auth/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
          items.forEach((item) => { if (selectedIds.has(Number(item.id))) item.is_read = 1; });
          syncUnread(items.filter((item) => !Number(item.is_read)).length);
          renderNotificationCenter();
        } catch (error) {
          notify(error.message, 'danger');
        }
      });
      $('#deleteSelectedNotificationsBtn')?.addEventListener('click', async () => {
        const ids = [...selectedIds];
        if (!ids.length) return notify('Hãy chọn ít nhất một thông báo.', 'warning');
        try {
          await store.request('/auth/notifications', { method: 'DELETE', body: JSON.stringify({ ids }) });
          for (let index = items.length - 1; index >= 0; index -= 1) {
            if (selectedIds.has(Number(items[index].id))) items.splice(index, 1);
          }
          selectedIds.clear();
          if (!items.some((item) => Number(item.id) === Number(activeId))) activeId = items[0]?.id || null;
          syncUnread(items.filter((item) => !Number(item.is_read)).length);
          renderNotificationCenter();
        } catch (error) {
          notify(error.message, 'danger');
        }
      });
      $('#markAllNotificationsReadBtn')?.addEventListener('click', async () => {
        try {
          await store.request('/auth/notifications/read-all', { method: 'POST' });
          items.forEach((item) => { item.is_read = 1; });
          syncUnread(0);
          renderNotificationCenter();
        } catch (error) {
          notify(error.message, 'danger');
        }
      });
    }

    syncUnread(payload?.unreadCount || 0);
    if (activeId) {
      try {
        await markOneAsRead(activeId);
      } catch {}
    }
    renderNotificationCenter();
  }

  async function renderReviewPage() {
    const me = await store.getMeSafe();
    if (!me) { location.href = 'login.html'; return; }
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
      const reviewComment = String(fd.get('comment') || '').trim();
      if (reviewContainsLink(reviewComment)) return notify('Nhận xét không được chứa link hoặc địa chỉ website.', 'warning');
      const reviewError = getReviewError({ rating: Number(fd.get('rating')), comment: reviewComment });
      if (reviewError) return notify(reviewError, 'warning');
      try { await store.request('/auth/reviews', { method: 'POST', body: JSON.stringify({ orderItemId: Number(fd.get('orderItemId')), rating: Number(fd.get('rating')), comment: reviewComment }) }); notify('Đã gửi đánh giá thành công.'); location.href = 'account.html'; }
      catch (error) { notify(error.message, 'danger'); }
    };
  }

  async function renderInfo() {
    const orderCode = param('order');
    const paymentResult = param('payment');
    let orderBlock = '';
    if (orderCode) {
      try {
        const order = await store.request(`/orders/${orderCode}`);
        const paymentBanner = paymentResult === 'success' ? '<div class="alert success" style="margin-bottom:14px;">Cổng thanh toán đã trả kết quả thành công. Trạng thái cuối cùng vẫn được xác nhận bởi hệ thống.</div>' : paymentResult === 'failed' ? '<div class="alert danger" style="margin-bottom:14px;">Thanh toán chưa thành công. Bạn có thể thử lại nếu đơn hàng vẫn còn chờ thanh toán.</div>' : '';
        const retryHtml = canRetryOnlinePayment(order) ? `<div class="inline-actions" style="margin-top:14px;"><button class="btn btn-primary" type="button" id="retryPaymentBtn" data-order-code="${order.order_code}">Thanh toán lại VNPAY</button></div>` : '';
        orderBlock = `<div class="card" style="padding:22px;margin-bottom:18px;">${paymentBanner}<h2>Đơn hàng ${order.order_code}</h2><div class="kpi-list"><div class="list-line"><span>Khách hàng</span><strong>${order.customer_name}</strong></div><div class="list-line"><span>Trạng thái đơn</span><strong>${order.order_status}</strong></div><div class="list-line"><span>Thanh toán</span><strong>${order.payment_status}</strong></div><div class="list-line"><span>Tổng tiền</span><strong>${store.currency(order.grand_total)}</strong></div></div>${bankTransferHtml(order)}${retryHtml}</div>`;
      } catch {}
    }
    app.innerHTML = `<section class="section"><div class="container">${orderBlock}<div class="grid-2"><div class="card" style="padding:22px;"><h1>Chính sách bảo hành</h1><p class="muted">${state.settings.warrantyPolicy}</p><h2>Đổi trả & vận chuyển</h2><p class="muted">${state.settings.returnPolicy}</p><p class="muted">${state.settings.shippingPolicy}</p></div><div class="card" style="padding:22px;"><h2>Liên hệ showroom</h2><p class="muted">${state.settings.showroom}</p><p class="muted">Hotline: ${state.settings.hotline}</p><form class="stack-form"><label><span>Họ tên</span><input /></label><label><span>Nội dung</span><textarea placeholder="Để lại lời nhắn"></textarea></label><button class="btn btn-primary" type="button" id="contactBtn">Gửi liên hệ</button></form></div></div></div></section>`;
    $('#contactBtn').onclick = () => notify('Đã ghi nhận lời nhắn.');
    if ($('#retryPaymentBtn')) {
      $('#retryPaymentBtn').onclick = async () => {
        try {
          const orderCodeValue = $('#retryPaymentBtn').dataset.orderCode;
          const result = await store.request(`/orders/${orderCodeValue}/payments/vnpay/retry`, { method: 'POST' });
          location.href = result.paymentUrl;
        } catch (error) {
          notify(error.message, 'danger');
        }
      };
    }
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

