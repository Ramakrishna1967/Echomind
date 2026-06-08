import { tools as elasticTools, serverName as elasticName } from '../../src/mcp/elastic.js';

describe('elastic-mcp', () => {
  it('exports correct server name', () => {
    expect(elasticName).toBe('elastic-mcp');
  });

  it('exposes the three required tools', () => {
    const names = elasticTools.map((t) => t.name);
    expect(names).toEqual(['search', 'index_document', 'bulk']);
  });
});
