Frontend tĩnh dùng chung cho bản SQL Server local.

- Web khách: index.html
- Admin: admin.html
- API mặc định: http://localhost:4000/api

Nếu backend không chạy trên localhost:4000, đặt biến toàn cục trước khi load assets/store.js:
window.BIDA_API_BASE = 'http://your-host:4000/api';
