import sql from 'mssql';
import { env } from './env.js';

const config = {
  user: env.db.user,
  password: env.db.password,
  server: env.db.server,
  port: env.db.port,
  database: env.db.database,
  options: env.db.options,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let poolPromise;

export async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect();
  }
  return poolPromise;
}

function bind(request, params = []) {
  params.forEach((value, index) => {
    request.input(`p${index + 1}`, value);
  });
  return request;
}

function translate(sqlText) {
  return sqlText.replace(/\$(\d+)/g, '@p$1');
}

function normalizeRows(recordset = []) {
  return recordset.map((row) => {
    const next = {};
    Object.keys(row).forEach((key) => {
      const value = row[key];
      next[key] = Buffer.isBuffer(value) ? value.toString('utf8') : value;
    });
    return next;
  });
}

export async function query(text, params = [], tx = null) {
  const pool = await getPool();
  const request = tx ? new sql.Request(tx) : pool.request();
  bind(request, params);
  const result = await request.query(translate(text));
  return { rows: normalizeRows(result.recordset || []), rowsAffected: result.rowsAffected || [] };
}

export async function executeBatch(sqlText) {
  const pool = await getPool();
  return pool.request().batch(sqlText);
}

export async function withTransaction(work) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export { sql };
