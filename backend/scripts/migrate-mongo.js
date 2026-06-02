import { connectMongo, mongoose } from '../src/lib/mongo.js';
import { collections } from '../src/models/mongo.js';

await connectMongo();

for (const [name, Model] of Object.entries(collections)) {
  await Model.syncIndexes();
  console.log(`Synced MongoDB indexes for ${name}`);
}

// MongoDB creates a unique _id index automatically; no custom index is needed for counters.

console.log('MongoDB schema migrated');
await mongoose.disconnect();
