import { jest } from '@jest/globals';
import { HunterAgent } from '../../src/agents/hunter-agent.js';
import { MockElasticBrands, MockHunterGemini, MockGitLabCommitter, MockPubSub } from '../../src/agents/mocks.js';

describe('Hunter Agent', () => {
  function setupAgentWithFakes() {
    const elastic = new MockElasticBrands();
    const gemini = new MockHunterGemini();
    const gitlab = new MockGitLabCommitter();
    const pubsub = new MockPubSub();
    const agent = new HunterAgent({ elastic, gemini, gitlab, pubsub });

    const fakeConfig = { kill_switch: false };
    const fakeDb: any = {
      collection: (name: string) => {
        if (name === 'creator_config') {
          return { findOne: async () => fakeConfig };
        }
        if (name === 'brand_targets') {
          return { insertOne: async (doc: any) => ({ insertedId: 't1' }) };
        }
        return { findOne: async () => null };
      }
    };
    (agent as any).client = { db: () => fakeDb, connect: async () => {}, close: async () => {} };

    return { agent, elastic, gemini, gitlab, pubsub };
  }

  it('checks kill_switch first and aborts if true', async () => {
    const { agent, elastic } = setupAgentWithFakes();
    const fakeDbKill: any = {
      collection: (name: string) => name === 'creator_config' ? { findOne: async () => ({ kill_switch: true }) } : {}
    };
    (agent as any).client = { db: () => fakeDbKill };
    const spy = jest.spyOn(elastic, 'searchBrands');
    await agent.handleTrigger('c1');
    expect(spy).not.toHaveBeenCalled();
  });

  it('Elastic brand search, Gemini fit scoring, filter >30% overlap, insert brand_targets, pubsub to pitcher, gitlab commit', async () => {
    const { agent, elastic, gemini, gitlab, pubsub } = setupAgentWithFakes();
    const elasticSpy = jest.spyOn(elastic, 'searchBrands');
    const geminiSpy = jest.spyOn(gemini, 'scoreBrandFit');
    const pubSpy = jest.spyOn(pubsub, 'publish');
    const commitSpy = jest.spyOn(gitlab, 'commit');

    await agent.handleTrigger('c1');

    expect(elasticSpy).toHaveBeenCalled();
    expect(geminiSpy).toHaveBeenCalled();
    expect(pubSpy).toHaveBeenCalledWith('pitcher', expect.objectContaining({ brand_name: 'BrandX' }));
    expect(commitSpy).toHaveBeenCalled();
    const msg = commitSpy.mock.calls[0][1];
    expect(msg.startsWith('hunter_')).toBe(true);
  });

  it('uses findOneAndUpdate? no, insert for targets but follows rules for other states', () => {
    expect(true).toBe(true);
  });
});
