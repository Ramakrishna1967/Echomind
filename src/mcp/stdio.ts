import * as readline from 'readline';
import { withRetry, type DeadLetterEntry } from '../utils/retry.js';

export interface ToolDefinition {
  name: string;
  handler: (args: unknown) => Promise<unknown>;
}

export interface StdioServerOptions {
  serverName: string;
  tools: ToolDefinition[];
}

export function createStdioServer(opts: StdioServerOptions): void {
  const toolMap = new Map(opts.tools.map((t) => [t.name, t.handler]));
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line: string) => {
    let msg: any;
    try {
      msg = JSON.parse(line.trim());
    } catch {
      writeResponse({ error: 'invalid_json' });
      return;
    }

    const { id, tool, args } = msg;
    if (!tool || typeof tool !== 'string') {
      writeResponse({ id, error: 'missing_tool' });
      return;
    }

    const handler = toolMap.get(tool);
    if (!handler) {
      writeResponse({ id, error: `unknown_tool:${tool}` });
      return;
    }

    try {
      const result = await withRetry(
        () => handler(args ?? {}),
        opts.serverName,
        tool,
        args,
        { maxAttempts: 3, baseDelayMs: 1 }
      );
      writeResponse({ id, result });
    } catch (err: any) {
      writeResponse({ id, error: err?.message ?? String(err) });
    }
  });

  function writeResponse(obj: any): void {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }

  // graceful shutdown
  process.on('SIGTERM', () => {
    rl.close();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    rl.close();
    process.exit(0);
  });
}
