import mongoose from 'mongoose';
import { env } from './env.js';

let connectionPromise;

export function isMongoEnabled() {
  return String(env.dbProvider || '').toLowerCase() === 'mongodb';
}

export async function connectMongo() {
  if (!connectionPromise) {
    mongoose.set('strictQuery', true);
    connectionPromise = mongoose.connect(env.mongoUri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 10000
    });
  }
  return connectionPromise;
}

export async function withMongoSession(work) {
  await connectMongo();
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export { mongoose };
