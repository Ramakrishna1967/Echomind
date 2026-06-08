import { createStdioServer } from './stdio.js';

export const serverName = 'dynatrace-mcp';
export const tools = [
  {
    name: 'push_metric',
    handler: async (args: any) => {
      if (!args.metric_key) throw new Error('metric_key required');
      return { accepted: true };
    }
  },
  {
    name: 'create_event',
    handler: async (args: any) => {
      if (!args.event_type || !args.title) throw new Error('event_type and title required');
      return { event_id: 'evt-' + Date.now() };
    }
  },
  {
    name: 'query_metrics',
    handler: async (args: any) => {
      if (!args.metric_selector) throw new Error('metric_selector required');
      return { data_points: [{ timestamp: new Date().toISOString(), value: 42.5 }] };
    }
  }
];

if (process.env.NODE_ENV !== 'test') {
  createStdioServer({ serverName, tools });
}
