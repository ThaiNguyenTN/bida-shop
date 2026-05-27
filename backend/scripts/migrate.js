import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeBatch } from '../src/lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
const sql = await fs.readFile(schemaPath, 'utf8');
await executeBatch(sql);
console.log('SQL Server schema migrated');
process.exit(0);
