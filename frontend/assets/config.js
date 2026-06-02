(function () {
  const localHosts = ['localhost', '127.0.0.1', ''];
  window.BIDA_API_BASE = localHosts.includes(window.location.hostname)
    ? 'http://localhost:4000/api'
    : 'https://bida-shop-jtrb.onrender.com/api';
})();
