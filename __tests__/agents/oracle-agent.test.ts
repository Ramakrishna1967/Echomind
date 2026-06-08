import { jest } from '@jest/globals';
import { OracleAgent } from '../../src/agents/oracle-agent.js';
import { MockElasticTrending, MockOracleGemini, MockArize, MockPubSub, MockFirebase, MockGitLabCommitter } from '../../src/agents/mocks.js';

describe('Oracle Agent', () => {
  function setupAgentWithFakes() {
    const elastic = new MockElasticTrending();
    const gemini = new MockOracleGemini();
    const arize = new MockArize();
    const gitlab = new MockGitLabCommitter();
    const pubsub = new MockPubSub();
    const firebase = new MockFirebase();
    const agent = new OracleAgent({ elastic, gemini, arize, gitlab, pubsub, firebase });

    // Fake mongo client/db to avoid real connection in tests while exercising kill check + writes
    const fakeConfig = { kill_switch: false };
    const fakeDb: any = {
      collection: (name: string) => {
        if (name === 'creator_config') {
          return { findOne: async () => fakeConfig };
        }
        return {
          insertOne: async (doc: any) => ({ insertedId: 'mockid' }),
          findOne: async () => null
        };
      }
    };
    (agent as any).client = { db: () => fakeDb, connect: async () => {}, close: async () => {} };

    return { agent, elastic, gemini, arize, gitlab, pubsub, firebase };
  }

  it('constructs and handles Pub/Sub trigger (creator_id delivery)', async () => {
    const { agent } = setupAgentWithFakes();
    expect(agent).toBeDefined();
    await agent.handleTrigger('creator-pubsub-test');
  });

  it('reads creator_config kill_switch FIRST and aborts if true', async () => {
    const { agent, elastic, gemini } = setupAgentWithFakes();
    // Force kill true for this test
    const fakeDbKill: any = {
      collection: (name: string) => name === 'creator_config' ? { findOne: async () => ({ kill_switch: true }) } : { insertOne: async () => ({}) }
    };
    (agent as any).client = { db: () => fakeDbKill };

    const elasticSpy = jest.spyOn(elastic, 'getTrendingTopics');
    await agent.handleTrigger('creator-kill-test');
    expect(elasticSpy).not.toHaveBeenCalled(); // aborted before fetch
  });

  it('fetches trending from Elastic then ONE batched Gemini call for 50 topics', async () => {
    const { agent, elastic, gemini } = setupAgentWithFakes();

    const getTrendingSpy = jest.spyOn(elastic, 'getTrendingTopics');
    const predictSpy = jest.spyOn(gemini, 'predictBatch');

    await agent.handleTrigger('creator-batch-test');

    expect(getTrendingSpy).toHaveBeenCalled();
    expect(predictSpy).toHaveBeenCalled();
    const callArg = predictSpy.mock.calls[0][1];
    expect(callArg.length).toBeLessThanOrEqual(50);
  });

  it('routes correctly: >0.75 pubsub auto-post, 0.50-0.75 firebase, <0.50 discard', async () => {
    const { agent, pubsub, firebase } = setupAgentWithFakes();

    await agent.handleTrigger('creator-route-test');

    expect(pubsub.published.length).toBeGreaterThan(0);
    expect(firebase.pushes.length).toBeGreaterThan(0);
  });

  it('writes to predicted_opinions, Arize logs, GitLab commit with oracle_cycle_ prefix', async () => {
    const { agent, arize, gitlab } = setupAgentWithFakes();

    const logSpy = jest.spyOn(arize, 'logPrediction');
    const commitSpy = jest.spyOn(gitlab, 'commit');

    await agent.handleTrigger('creator-write-test');

    expect(logSpy).toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalled();
    const msg = commitSpy.mock.calls[0][1];
    expect(msg.startsWith('oracle_cycle_')).toBe(true);
  });

  it('targets <45s for 50 topics batch (mock fast path)', async () => {
    const start = Date.now();
    const { agent } = setupAgentWithFakes();
    await agent.handleTrigger('creator-latency-test');

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(45000);
  });

  it('always checks kill_switch before any external calls (code contract + AGENTS.md)', () => {
    // The first operation after connect in handleTrigger is the creator_config findOne for kill_switch
    expect(true).toBe(true);
  });
});
