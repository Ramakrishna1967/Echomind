import { tools as arizeTools, serverName as arizeName } from '../../src/mcp/arize.js';

describe('arize-mcp', () => {
  it('exports correct server name', () => {
    expect(arizeName).toBe('arize-mcp');
  });

  it('has the four required tools', () => {
    const names = arizeTools.map((t) => t.name);
    expect(names).toEqual(['check_drift', 'log_prediction', 'check_negotiation_bounds', 'log_event']);
  });

  it('check_drift requires creator_id and output_text', async () => {
    const tool = arizeTools.find((t) => t.name === 'check_drift')!;
    await expect(tool.handler({})).rejects.toThrow('creator_id and output_text required');
  });

  it('log_prediction requires creator_id and prediction_id', async () => {
    const tool = arizeTools.find((t) => t.name === 'log_prediction')!;
    await expect(tool.handler({})).rejects.toThrow('creator_id and prediction_id required');
  });

  it('check_negotiation_bounds returns within_bounds true', async () => {
    const tool = arizeTools.find((t) => t.name === 'check_negotiation_bounds')!;
    const res = await tool.handler({ creator_id: 'c1' });
    expect(res).toEqual({ within_bounds: true, violations: [] });
  });
});
