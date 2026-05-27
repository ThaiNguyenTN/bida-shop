import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './lib/env.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { ordersRouter } from './routes/orders.js';
import { cartRouter } from './routes/cart.js';
import { adminRouter } from './routes/admin.js';
import { errorHandler } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(path.join(uploadsDir, 'products'), { recursive: true });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/cart', cartRouter);
app.use('/api/admin', adminRouter);
app.use(errorHandler);
app.listen(env.port, () => console.log(`Bida shop SQL Server API listening on port ${env.port}`));
