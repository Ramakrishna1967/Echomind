import { createStdioServer } from './stdio.js';

interface SyncStatus { status: string; last_sync_time?: string; rows_synced?: number }
interface Connector { id: string; name: string; status: string }

export const serverName = 'fivetran-mcp';
export const tools = [
  {
    name: 'sync_connector',
    handler: async (args: any): Promise<SyncStatus> => {
      if (!args.connector_id) throw new Error('connector_id required');
      return { status: 'triggered', last_sync_time: new Date().toISOString() };
    }
  },
  {
    name: 'get_sync_status',
    handler: async (args: any): Promise<SyncStatus> => {
      if (!args.connector_id) throw new Error('connector_id required');
      return { status: 'success', last_sync_time: new Date().toISOString(), rows_synced: 1234 };
    }
  },
  {
    name: 'list_connectors',
    handler: async (args: any): Promise<Connector[]> => {
      if (!args.creator_id) throw new Error('creator_id required');
      return [{ id: 'c1', name: 'youtube', status: 'paused' }];
    }
  }
];

if (process.env.NODE_ENV !== 'test') {
  createStdioServer({ serverName, tools });
}
