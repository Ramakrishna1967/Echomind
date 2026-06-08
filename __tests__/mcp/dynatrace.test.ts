import { tools as dynatraceTools, serverName as dynatraceName } from '../../src/mcp/dynatrace.js';

describe('dynatrace-mcp', () => {
  it('exports correct server name', () => {
    expect(dynatraceName).toBe('dynatrace-mcp');
  });

  it('has the three required tools', () => {
    const names = dynatraceTools.map((t) => t.name);
    expect(names).toEqual(['push_metric', 'create_event', 'query_metrics']);
  });

  it('push_metric requires metric_key', async () => {
    const tool = dynatraceTools.find((t) => t.name === 'push_metric')!;
    await expect(tool.handler({})).rejects.toThrow('metric_key required');
  });

  it('create_event requires event_type and title', async () => {
    const tool = dynatraceTools.find((t) => t.name === 'create_event')!;
    await expect(tool.handler({})).rejects.toThrow('event_type and title required');
  });

  it('query_metrics returns data_points', async () => {
    const tool = dynatraceTools.find((t) => t.name === 'query_metrics')!;
    const res = await tool.handler({ metric_selector: 'cpu' });
    expect(res).toHaveProperty('data_points');
  });
});
