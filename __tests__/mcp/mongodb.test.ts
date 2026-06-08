import { tools as mongoTools, serverName as mongoName } from '../../src/mcp/mongodb.js';

describe('mongodb-atlas-mcp', () => {
  it('exports correct server name', () => {
    expect(mongoName).toBe('mongodb-atlas-mcp');
  });

  it('exposes all six required tools', () => {
    const names = mongoTools.map((t) => t.name);
    expect(names).toEqual([
      'find',
      'insert_one',
      'update_one',
      'find_one_and_update',
      'aggregate',
      'vector_search'
    ]);
  });

  it('find_one_and_update is present (critical for state machine rules)', () => {
    const hasFindOneAndUpdate = mongoTools.some((t) => t.name === 'find_one_and_update');
    expect(hasFindOneAndUpdate).toBe(true);
  });
});
