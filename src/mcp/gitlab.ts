import { createStdioServer } from './stdio.js';

export const serverName = 'gitlab-mcp';
export const tools = [
  {
    name: 'commit',
    handler: async (args: any) => {
      if (!args.repo || !args.message) throw new Error('repo and message required');
      return { commit_sha: 'abc123def', web_url: `https://gitlab.com/${args.repo}/-/commit/abc123def` };
    }
  },
  {
    name: 'read_file',
    handler: async (args: any) => {
      if (!args.repo || !args.file_path) throw new Error('repo and file_path required');
      return { content: '# placeholder file content from GitLab MCP' };
    }
  },
  {
    name: 'list_commits',
    handler: async (args: any) => {
      if (!args.repo) throw new Error('repo required');
      return [{ id: 'abc123', short_id: 'abc123', title: 'test commit', created_at: new Date().toISOString() }];
    }
  },
  {
    name: 'revert_commit',
    handler: async (args: any) => {
      if (!args.repo || !args.commit_sha) throw new Error('repo and commit_sha required');
      return { revert_commit_sha: 'revert-xyz' };
    }
  }
];

if (process.env.NODE_ENV !== 'test') {
  createStdioServer({ serverName, tools });
}
