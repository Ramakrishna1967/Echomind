import { tools as fivetranTools, serverName as fivetranName } from '../../src/mcp/fivetran.js';

describe('fivetran-mcp', () => {
  it('exports correct server name', () => {
    expect(fivetranName).toBe('fivetran-mcp');
  });

  it('has the three required tools', () => {
    const names = fivetranTools.map((t) => t.name);
    expect(names).toEqual(['sync_connector', 'get_sync_status', 'list_connectors']);
  });

  it('sync_connector requires connector_id', async () => {
    const tool = fivetranTools.find((t) => t.name === 'sync_connector')!;
    await expect(tool.handler({})).rejects.toThrow('connector_id required');
  });

  it('sync_connector succeeds with connector_id', async () => {
    const tool = fivetranTools.find((t) => t.name === 'sync_connector')!;
    const res = await tool.handler({ connector_id: 'c1' });
    expect(res).toHaveProperty('status', 'triggered');
  });

  it('get_sync_status requires connector_id', async () => {
    const tool = fivetranTools.find((t) => t.name === 'get_sync_status')!;
    await expect(tool.handler({})).rejects.toThrow('connector_id required');
  });

  it('list_connectors requires creator_id', async () => {
    const tool = fivetranTools.find((t) => t.name === 'list_connectors')!;
    await expect(tool.handler({})).rejects.toThrow('creator_id required');
  });
});
