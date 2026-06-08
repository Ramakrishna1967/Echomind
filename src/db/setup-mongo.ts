import { MongoClient } from 'mongodb';
import { collectionDefs, DATABASE_NAME, SHARD_KEY, CollectionName } from './collection-defs.js';

export async function setupMongoDB(uri: string = process.env.MONGODB_URI || 'mongodb://localhost:27017'): Promise<void> {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(DATABASE_NAME);

    // 1. Create collections with validators (strict)
    for (const def of collectionDefs) {
      try {
        await db.createCollection(def.name, def.validator);
      } catch (e: any) {
        if (e.codeName !== 'NamespaceExists') throw e;
        // collection exists; ensure validator is up to date by collMod (best effort)
        await db.command({
          collMod: def.name,
          validator: def.validator.validator,
          validationLevel: 'strict',
          validationAction: 'error'
        });
      }
    }

    // 2. Create indexes
    for (const def of collectionDefs) {
      if (def.indexes.length > 0) {
        await db.collection(def.name).createIndexes(def.indexes);
      }
    }

    // 3. Enable sharding (requires mongos / Atlas cluster with sharding enabled; idempotent)
    const admin = client.db('admin');
    try {
      await admin.command({ enableSharding: DATABASE_NAME });
    } catch (e: any) {
      // ignore if already enabled or not authorized in non-sharded env
      if (e.codeName && !['AlreadyInitialized', 'CommandNotFound', 'Unauthorized'].includes(e.codeName)) {
        // rethrow only unexpected
        if (e.code !== 13) throw e; // 13 = not authorized
      }
    }

    // 4. Shard every collection with exact key from AGENTS.md: {region:1, creator_id:"hashed"}
    for (const def of collectionDefs) {
      try {
        await admin.command({
          shardCollection: `${DATABASE_NAME}.${def.name}`,
          key: SHARD_KEY
        });
      } catch (e: any) {
        const msg = (e.errmsg || e.message || '').toLowerCase();
        if (!msg.includes('already') && !msg.includes('exists') && e.code !== 20 && e.code !== 13) {
          throw e;
        }
      }
    }
  } finally {
    await client.close();
  }
}

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  setupMongoDB().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
