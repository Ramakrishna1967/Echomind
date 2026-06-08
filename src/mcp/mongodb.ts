import { createStdioServer } from './stdio.js';
import { MongoClient } from 'mongodb';

let client: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
  if (!client) {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    client = new MongoClient(uri);
    await client.connect();
  }
  return client;
}

export const serverName = 'mongodb-atlas-mcp';
export const tools = [
  {
    name: 'find',
    handler: async (args: any) => {
      const db = (await getClient()).db();
      const coll = db.collection(args.collection);
      const cursor = coll.find(args.filter || {}, {
        projection: args.projection,
        sort: args.sort,
        limit: args.limit
      });
      return await cursor.toArray();
    }
  },
  {
    name: 'insert_one',
    handler: async (args: any) => {
      const db = (await getClient()).db();
      const res = await db.collection(args.collection).insertOne(args.document || {});
      return { inserted_id: res.insertedId.toString() };
    }
  },
  {
    name: 'update_one',
    handler: async (args: any) => {
      const db = (await getClient()).db();
      const res = await db.collection(args.collection).updateOne(args.filter || {}, args.update || {});
      return { matched_count: res.matchedCount, modified_count: res.modifiedCount };
    }
  },
  {
    name: 'find_one_and_update',
    handler: async (args: any) => {
      const db = (await getClient()).db();
      const res = await db.collection(args.collection).findOneAndUpdate(
        args.filter || {},
        args.update || {},
        { returnDocument: args.return_document === 'before' ? 'before' : 'after' }
      );
      return res || null;
    }
  },
  {
    name: 'aggregate',
    handler: async (args: any) => {
      const db = (await getClient()).db();
      const cursor = db.collection(args.collection).aggregate(args.pipeline || []);
      return await cursor.toArray();
    }
  },
  {
    name: 'vector_search',
    handler: async (args: any) => {
      const db = (await getClient()).db();
      const pipeline = [
        {
          $vectorSearch: {
            index: args.index,
            path: 'embedding',
            queryVector: args.query_vector,
            numCandidates: args.num_candidates || 100,
            limit: args.limit || 5,
            filter: args.filter || {}
          }
        },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } }
      ];
      const cursor = db.collection(args.collection).aggregate(pipeline);
      return await cursor.toArray();
    }
  }
];

if (process.env.NODE_ENV !== 'test') {
  createStdioServer({ serverName, tools });
}
