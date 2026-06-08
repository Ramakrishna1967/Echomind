import { createStdioServer } from './stdio.js';

export const serverName = 'arize-mcp';
export const tools = [
  {
    name: 'check_drift',
    handler: async (args: any) => {
      if (!args.creator_id || !args.output_text) throw new Error('creator_id and output_text required');
      return { similarity_score: 0.92, pass: true, drift_details: {} };
    }
  },
  {
    name: 'log_prediction',
    handler: async (args: any) => {
      if (!args.creator_id || !args.prediction_id) throw new Error('creator_id and prediction_id required');
      return { logged: true };
    }
  },
  {
    name: 'check_negotiation_bounds',
    handler: async (args: any) => {
      if (!args.creator_id) throw new Error('creator_id required');
      return { within_bounds: true, violations: [] };
    }
  },
  {
    name: 'log_event',
    handler: async (args: any) => {
      return { logged: true };
    }
  }
];

if (process.env.NODE_ENV !== 'test') {
  createStdioServer({ serverName, tools });
}
