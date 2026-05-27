export function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(500).json({ ok: false, message: 'Internal server error', details: err.message });
}
