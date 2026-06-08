import { createStdioServer } from '../../src/mcp/stdio.js';
import { tools as fivetranTools } from '../../src/mcp/fivetran.js';
import { tools as mongoTools } from '../../src/mcp/mongodb.js';
import { tools as elasticTools } from '../../src/mcp/elastic.js';
import { tools as arizeTools } from '../../src/mcp/arize.js';
import { tools as gitlabTools } from '../../src/mcp/gitlab.js';
import { tools as dynatraceTools } from '../../src/mcp/dynatrace.js';

describe('all 6 mcp servers - tool surface', () => {
  it('fivetran has 3 tools', () => {
    expect(fivetranTools).toHaveLength(3);
  });
  it('mongodb has 6 tools', () => {
    expect(mongoTools).toHaveLength(6);
  });
  it('elastic has 3 tools', () => {
    expect(elasticTools).toHaveLength(3);
  });
  it('arize has 4 tools', () => {
    expect(arizeTools).toHaveLength(4);
  });
  it('gitlab has 4 tools', () => {
    expect(gitlabTools).toHaveLength(4);
  });
  it('dynatrace has 3 tools', () => {
    expect(dynatraceTools).toHaveLength(3);
  });
});
