# Bida Pro Shop

Website bán hàng cho cửa hàng bida, gồm frontend tĩnh cho khách hàng, trang quản trị nội bộ và backend REST API. Dự án hiện dùng MongoDB làm database chính, backend deploy trên Render và frontend deploy trên Vercel.

## Tính năng chính

- Xem danh sách sản phẩm, lọc, tìm kiếm và xem chi tiết sản phẩm.
- Quản lý giỏ hàng cho khách vãng lai và tài khoản đã đăng nhập.
- Tách riêng trang giỏ hàng và trang checkout.
- Đăng ký, đăng nhập, xác thực email bằng OTP qua SMTP.
- Quản lý tài khoản, địa chỉ giao hàng, wishlist, thông báo và lịch sử đơn hàng.
- Tạo đơn hàng với COD hoặc VNPay sandbox.
- Trang admin cho sản phẩm, đơn hàng, khách hàng, voucher, banner, blog, tồn kho, review và cài đặt.
- Seed dữ liệu mẫu cho tài khoản, danh mục, sản phẩm, voucher, banner và blog.

## Công nghệ

- Frontend: HTML, CSS, Vanilla JavaScript.
- Backend: Node.js, Express.
- Database: MongoDB Atlas hoặc MongoDB local.
- ODM: Mongoose.
- Auth: JWT, bcryptjs.
- Email: Nodemailer SMTP, Gmail App Password.
- Payment: VNPay sandbox.
- Deploy: Render cho backend, Vercel cho frontend.

## Cấu trúc thư mục

```text
frontend/
  index.html
  products.html
  product.html
  cart.html
  checkout.html
  login.html
  register.html
  verify-email.html
  account.html
  admin.html
  assets/
    config.js
    store.js
    frontend.js
    admin.js
    styles.css
  vercel.json

backend/
  package.json
  Dockerfile
  scripts/
    migrate.js
    migrate-mongo.js
    seed.js
    seed-mongo.js
    seed-extra-products.js
    smtp-test.js
  src/
    server.js
    lib/
      auth.js
      env.js
      http.js
      mongo.js
    middleware/
      auth.js
      error.js
    models/
      mongo.js
    routes/
      mongo/
        public.js
        auth.js
        cart.js
        orders.js
        admin.js
    services/
      auth/
      payments/
```

## Chạy local

### 1. Cài backend

```bash
cd backend
npm install
```

### 2. Tạo file `backend/.env`

```env
NODE_ENV=development
PORT=4000
JWT_SECRET=replace-with-long-random-secret
APP_BASE_URL=http://localhost:8080
FRONTEND_URL=http://localhost:8080

DB_PROVIDER=mongodb
MONGO_URI=mongodb://127.0.0.1:27017/bida_shop

VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_TMN_CODE=your-vnpay-tmn-code
VNPAY_HASH_SECRET=your-vnpay-hash-secret
VNPAY_RETURN_URL=http://localhost:4000/api/orders/payments/vnpay/return
VNPAY_IPN_URL=http://localhost:4000/api/orders/payments/vnpay/ipn

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM="Bida Shop <your-gmail@gmail.com>"
```

Với MongoDB Atlas, dùng URI dạng:

```env
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
```

Không commit file `.env`. File này đang được `.gitignore`.

### 3. Migrate và seed dữ liệu

```bash
npm run migrate
npm run seed
node scripts/seed-extra-products.js
```

### 4. Chạy backend

```bash
npm run dev
```

API local:

```text
http://localhost:4000/api
```

Kiểm tra health:

```bash
curl http://localhost:4000/api/health
```

### 5. Chạy frontend

Nếu muốn chạy frontend local và gọi backend local, sửa `frontend/assets/config.js` hoặc tạm bỏ dòng `window.BIDA_API_BASE`.

```bash
cd frontend
python -m http.server 8080
```

Đường dẫn:

- Website khách: `http://localhost:8080/index.html`
- Admin: `http://localhost:8080/admin.html`

## Tài khoản mẫu

```text
admin@bidaproshop.vn / admin123
manager@bidaproshop.vn / manager123
kho@bidaproshop.vn / kho123
cskh@bidaproshop.vn / cskh123
khach1@example.com / Customer@123
```

## API chính

```text
GET    /api/health
GET    /api/products
GET    /api/products/:slug
GET    /api/categories
POST   /api/auth/register
POST   /api/auth/verify-email
POST   /api/auth/resend-email-otp
POST   /api/auth/login
GET    /api/auth/me
GET    /api/cart
POST   /api/cart/items
PATCH  /api/cart/items/:id
DELETE /api/cart/items/:id
POST   /api/orders/checkout
GET    /api/orders/:orderCode
GET    /api/admin/dashboard
GET    /api/admin/products
GET    /api/admin/orders
GET    /api/admin/customers
```

## Deploy backend trên Render

Render service hiện tại:

```text
https://bida-shop-jtrb.onrender.com
```

Start command khuyến nghị:

```bash
cd backend && npm install && npm start
```

Environment variables trên Render:

```env
NODE_ENV=production
PORT=4000
JWT_SECRET=<long-random-secret>
APP_BASE_URL=https://bida-shop.vercel.app
FRONTEND_URL=https://bida-shop.vercel.app

DB_PROVIDER=mongodb
MONGO_URI=<mongodb-atlas-uri-with-database-name>

VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_TMN_CODE=<vnpay-tmn-code>
VNPAY_HASH_SECRET=<vnpay-hash-secret>
VNPAY_RETURN_URL=https://bida-shop-jtrb.onrender.com/api/orders/payments/vnpay/return
VNPAY_IPN_URL=https://bida-shop-jtrb.onrender.com/api/orders/payments/vnpay/ipn

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<gmail>
SMTP_PASS=<gmail-app-password>
SMTP_FROM="Bida Shop <gmail>"
```

Sau khi deploy, kiểm tra:

```text
https://bida-shop-jtrb.onrender.com/api/health
```

MongoDB Atlas cần allow IP của Render. Để test nhanh có thể mở `0.0.0.0/0`, sau đó siết lại nếu cần.

## Deploy frontend trên Vercel

Project frontend hiện trỏ API qua:

```js
window.BIDA_API_BASE = 'https://bida-shop-jtrb.onrender.com/api';
```

File nằm tại:

```text
frontend/assets/config.js
```

Cấu hình Vercel:

```text
Framework Preset: Other
Root Directory: frontend
Build Command: để trống
Output Directory: để trống hoặc .
Project name: bida-shop
```

Domain mong muốn:

```text
https://bida-shop.vercel.app
```

## Seed thêm sản phẩm

Script thêm/cập nhật sản phẩm mẫu:

```bash
cd backend
node scripts/seed-extra-products.js
```

Script này dùng SKU để upsert, nên chạy lại sẽ cập nhật sản phẩm cũ thay vì tạo trùng.

## Lưu ý bảo mật

- Không commit `.env`.
- Không dùng `JWT_SECRET=replace-with-long-random-secret` ở production.
- Nếu đã lộ SMTP app password, MongoDB URI hoặc VNPay secret, cần đổi secret mới và cập nhật lại trên Render.
- MongoDB Atlas nên dùng user riêng cho app, không dùng mật khẩu đơn giản.

## Trạng thái hiện tại

- Backend MongoDB đã chạy được trên Render.
- Frontend đã cấu hình để deploy trên Vercel.
- Database đã có dữ liệu seed và nhiều sản phẩm mẫu.
- Admin MongoDB đã có các endpoint đọc chính và một số thao tác cập nhật cơ bản.
