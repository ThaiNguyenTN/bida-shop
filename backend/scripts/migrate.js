import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeBatch } from '../src/lib/db.js';
import { env } from '../src/lib/env.js';

if (String(env.dbProvider || '').toLowerCase() === 'mongodb') {
  await import('./migrate-mongo.js');
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', 'sql');
const sqlFiles = (await fs.readdir(sqlDir))
  .filter((file) => file.endsWith('.sql'))
  .sort((a, b) => {
    if (a === 'schema.sql') return -1;
    if (b === 'schema.sql') return 1;
    return a.localeCompare(b);
  });

for (const file of sqlFiles) {
  const sql = await fs.readFile(path.join(sqlDir, file), 'utf8');
  await executeBatch(sql);
  console.log(`Applied ${file}`);
}

console.log('SQL Server schema migrated');
process.exit(0);
