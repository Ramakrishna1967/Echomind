import { tools as gitlabTools, serverName as gitlabName } from '../../src/mcp/gitlab.js';

describe('gitlab-mcp', () => {
  it('exports correct server name', () => {
    expect(gitlabName).toBe('gitlab-mcp');
  });

  it('has the four required tools', () => {
    const names = gitlabTools.map((t) => t.name);
    expect(names).toEqual(['commit', 'read_file', 'list_commits', 'revert_commit']);
  });

  it('commit requires repo and message', async () => {
    const tool = gitlabTools.find((t) => t.name === 'commit')!;
    await expect(tool.handler({})).rejects.toThrow('repo and message required');
  });

  it('commit returns commit_sha and web_url', async () => {
    const tool = gitlabTools.find((t) => t.name === 'commit')!;
    const res = await tool.handler({ repo: 'echomind', message: 'test' });
    expect(res).toHaveProperty('commit_sha');
    expect(res).toHaveProperty('web_url');
  });

  it('revert_commit requires repo and commit_sha', async () => {
    const tool = gitlabTools.find((t) => t.name === 'revert_commit')!;
    await expect(tool.handler({})).rejects.toThrow('repo and commit_sha required');
  });
});
