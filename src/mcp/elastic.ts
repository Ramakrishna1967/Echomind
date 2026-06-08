import { createStdioServer } from './stdio.js';
import { Client } from '@elastic/elasticsearch';

let es: Client | null = null;

function getClient(): Client {
  if (!es) {
    es = new Client({
      node: process.env.ELASTIC_URL || 'http://localhost:9200',
      auth: process.env.ELASTIC_API_KEY ? { apiKey: process.env.ELASTIC_API_KEY } : undefined
    });
  }
  return es;
}

export const serverName = 'elastic-mcp';
export const tools: { name: string; handler: (args: any) => Promise<any> }[] = [
  {
    name: 'search',
    handler: async (args: any) => {
      const client = getClient();
      const res = await client.search({
        index: args.index,
        size: args.size || 10,
        sort: args.sort,
        query: args.query || { match_all: {} }
      });
      return { hits: res.hits };
    }
  },
  {
    name: 'index_document',
    handler: async (args: any) => {
      const client = getClient();
      const res = await client.index({
        index: args.index,
        id: args.id,
        document: args.document
      });
      return { _id: res._id, result: res.result };
    }
  },
  {
    name: 'bulk',
    handler: async (args: any) => {
      const client = getClient();
      const res = await client.bulk({ operations: args.operations || [] });
      return { took: res.took, errors: res.errors, items: res.items };
    }
  }
];

if (process.env.NODE_ENV !== 'test') {
  createStdioServer({ serverName, tools });
}
