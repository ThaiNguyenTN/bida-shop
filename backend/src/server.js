import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './lib/env.js';
import { isMongoEnabled, connectMongo } from './lib/mongo.js';
import { publicRouter } from './routes/public.js';
import { mongoPublicRouter } from './routes/mongo/public.js';
import { authRouter } from './routes/auth.js';
import { mongoAuthRouter } from './routes/mongo/auth.js';
import { ordersRouter } from './routes/orders.js';
import { mongoOrdersRouter } from './routes/mongo/orders.js';
import { cartRouter } from './routes/cart.js';
import { mongoCartRouter } from './routes/mongo/cart.js';
import { adminRouter } from './routes/admin.js';
import { mongoAdminRouter } from './routes/mongo/admin.js';
import { errorHandler } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(path.join(uploadsDir, 'products'), { recursive: true });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
if (isMongoEnabled()) {
  await connectMongo();
  app.use('/api', mongoPublicRouter);
  app.use('/api/auth', mongoAuthRouter);
  app.use('/api/orders', mongoOrdersRouter);
  app.use('/api/cart', mongoCartRouter);
  app.use('/api/admin', mongoAdminRouter);
} else {
  app.use('/api', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/admin', adminRouter);
}
app.use(errorHandler);
app.listen(env.port, () => console.log(`Bida shop ${env.dbProvider} API listening on port ${env.port}`));
