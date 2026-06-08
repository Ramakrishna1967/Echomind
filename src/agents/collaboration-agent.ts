import { MongoClient } from 'mongodb';
import * as crypto from 'crypto';
import { withRetry } from '../utils/retry.js';
import { MockSecretManager, MockElasticNetwork, MockGeminiCollaboration, MockGitLabCommitter, MockFirebase } from './mocks.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface CollaborationAgentOptions {
  mongoUri?: string;
  dbName?: string;
  secretManager?: MockSecretManager;
  elastic?: MockElasticNetwork;
  gemini?: MockGeminiCollaboration;
  gitlab?: MockGitLabCommitter;
  firebase?: MockFirebase;
  repo?: string;
  killSwitchChecker?: KillSwitchChecker;
}

export class CollaborationAgent {
  private client: MongoClient;
  private dbName: string;
  private secretManager: MockSecretManager;
  private elastic: MockElasticNetwork;
  private gemini: MockGeminiCollaboration;
  private gitlab: MockGitLabCommitter;
  private firebase: MockFirebase;
  private repo: string;
  private killSwitchChecker?: KillSwitchChecker;

  constructor(opts: CollaborationAgentOptions = {}) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.secretManager = opts.secretManager || new MockSecretManager();
    this.elastic = opts.elastic || new MockElasticNetwork();
    this.gemini = opts.gemini || new MockGeminiCollaboration();
    this.gitlab = opts.gitlab || new MockGitLabCommitter();
    this.firebase = opts.firebase || new MockFirebase();
    this.repo = opts.repo || 'echomind-sovereign';
    this.killSwitchChecker = opts.killSwitchChecker;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  // Trigger: Cloud Scheduler every 12 hours for presence + discovery
  async handleTrigger(creatorId: string, region = 'default'): Promise<void> {
    const start = Date.now();
    const db = this.client.db(this.dbName);
    const configCol = db.collection('creator_config');
    const interactionsCol = db.collection('agent_interactions');

    // 1. Check kill_switch first
    if (this.killSwitchChecker) {
      if (await this.killSwitchChecker.isActive(creatorId, region)) {
        // on freeze, post system_pause per spec + GitLab commit
        await withRetry(() => this.elastic.indexMessage({ type: 'system_pause', reason: 'kill_switch', from: creatorId, timestamp: new Date().toISOString(), region }), 'collaboration-agent', 'elastic_pause_on_kill', { creatorId }, { maxAttempts: 2 });
        const commitMsg = `kill_switch_frozen_collab_${creatorId}_${Date.now()}`;
        await withRetry(() => this.gitlab.commit(this.repo, commitMsg, []), 'collaboration-agent', 'gitlab_kill_freeze', { creatorId }, { maxAttempts: 2 });
        return;
      }
    } else {
      const configEarly = await withRetry(
        () => configCol.findOne({ creator_id: creatorId, region }),
        'collaboration-agent',
        'read_kill_switch',
        { creatorId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );
      if (configEarly && configEarly.kill_switch === true) {
        await withRetry(() => this.elastic.indexMessage({ type: 'system_pause', reason: 'kill_switch', from: creatorId, timestamp: new Date().toISOString(), region }), 'collaboration-agent', 'elastic_pause_on_kill', { creatorId }, { maxAttempts: 2 });
        return;
      }
    }

    // Load config (needed for gemini proposals etc). Safe because we passed kill gate.
    const config = await withRetry(
      () => configCol.findOne({ creator_id: creatorId, region }),
      'collaboration-agent',
      'read_config',
      { creatorId },
      { maxAttempts: 3, baseDelayMs: 50 }
    );

    // 2. Load Ed25519 keypair from Secret Manager
    const keypair = this.secretManager.getKeypair(creatorId);
    if (!keypair) {
      throw new Error('No Ed25519 keypair');
    }

    // 3. Publish presence to Elastic echomind_network
    const presence = {
      agent_id: creatorId,
      niche_tags: ['ai', 'tech'],
      audience_size: 50000,
      collab_openness: 0.8,
      demographics: { age: '25-34', location: 'US' },
      public_key: keypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      timestamp: new Date().toISOString()
    };
    await withRetry(
      () => this.elastic.publishPresence(presence),
      'collaboration-agent',
      'elastic_publish_presence',
      { creatorId },
      { maxAttempts: 3, baseDelayMs: 50 }
    );

    // 4. Query for candidates audience_overlap >55%
    const candidates = await withRetry(
      () => this.elastic.queryNetwork({ audience_overlap: 0.55, collab_openness: 0.6 }),
      'collaboration-agent',
      'elastic_query_network',
      { creatorId },
      { maxAttempts: 3, baseDelayMs: 50 }
    );

    const interactions: any[] = [];
    for (const candidate of candidates) {
      const threadId = `collab-${creatorId}-${candidate.agent_id}-${Date.now()}`;

      // 5. Generate proposal with Gemini
      const proposal = await withRetry(
        () => this.gemini.generateProposal(candidate, config),
        'collaboration-agent',
        'gemini_generate_proposal',
        { candidate: candidate.agent_id },
        { maxAttempts: 3, baseDelayMs: 50 }
      );

      // 6. Sign with Ed25519
      const payloadStr = JSON.stringify(proposal);
      const signature = crypto.sign(null, Buffer.from(payloadStr), keypair.privateKey).toString('base64');

      // 7. Index to echomind_messages
      const message = {
        from: creatorId,
        to: candidate.agent_id,
        thread_id: threadId,
        type: 'proposal',
        round: 1,
        payload: proposal,
        signature,
        timestamp: new Date().toISOString(),
        region
      };
      await withRetry(
        () => this.elastic.indexMessage(message),
        'collaboration-agent',
        'elastic_index_message',
        { threadId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );

      // GitLab commit
      const commitMsg = `collab_proposed_${candidate.agent_id}_${Date.now()}`;
      await withRetry(
        () => this.gitlab.commit(this.repo, commitMsg, []),
        'collaboration-agent',
        'gitlab_commit',
        { threadId },
        { maxAttempts: 3 }
      );

      // 8. Poll incoming (simulated in same cycle for mock)
      const incoming = await withRetry(
        () => this.elastic.queryMessages(creatorId),
        'collaboration-agent',
        'elastic_poll_messages',
        { creatorId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );

      for (const msg of incoming) {
        // Reject >24hr stale
        const msgTime = new Date(msg.timestamp);
        if (Date.now() - msgTime.getTime() > 24 * 60 * 60 * 1000) {
          continue;
        }

        // Verify signature
        const senderPresence = this.elastic.network.find((p: any) => p.agent_id === msg.from);
        if (!senderPresence || !senderPresence.public_key) continue;
        const senderPub = Buffer.from(senderPresence.public_key, 'base64');
        const senderPubKey = crypto.createPublicKey({ key: senderPub, format: 'der', type: 'spki' });
        const isValid = crypto.verify(null, Buffer.from(JSON.stringify(msg.payload)), senderPubKey, Buffer.from(msg.signature, 'base64'));
        if (!isValid) continue;

        // Max 3 rounds
        if (msg.round >= 3) {
          // Dual approval on agreement
          await withRetry(
            () => this.firebase.sendPush(creatorId, { type: 'collab_approval', thread: msg.thread_id, from: msg.from }),
            'collaboration-agent',
            'firebase_dual_approval',
            { threadId: msg.thread_id },
            { maxAttempts: 3 }
          );
          await withRetry(
            () => this.firebase.sendPush(msg.from, { type: 'collab_approval', thread: msg.thread_id, from: creatorId }),
            'collaboration-agent',
            'firebase_dual_approval',
            { threadId: msg.thread_id },
            { maxAttempts: 3 }
          );

          // Simulate both approve -> insert agent_interactions
          await withRetry(
            () => interactionsCol.insertOne({
              creator_id: creatorId,
              counterpart_agent_id: msg.from,
              interaction_type: 'collab',
              outcome: 'agreed',
              rounds: msg.round,
              timestamp: new Date(),
              proposal_json: msg.payload,
              final_terms: msg.payload,
              region
            }),
            'collaboration-agent',
            'insert_agent_interactions',
            { threadId: msg.thread_id },
            { maxAttempts: 3 }
          );

          const agreeCommit = `collab_agreed_${msg.from}_${Date.now()}`;
          await withRetry(
            () => this.gitlab.commit(this.repo, agreeCommit, []),
            'collaboration-agent',
            'gitlab_commit',
            { threadId: msg.thread_id },
            { maxAttempts: 3 }
          );
          continue;
        }

        // Generate counter (round 2)
        const counterProposal = await withRetry(
          () => this.gemini.generateProposal({ agent_id: msg.from }, config),
          'collaboration-agent',
          'gemini_counter_proposal',
          { threadId: msg.thread_id },
          { maxAttempts: 3 }
        );

        const counterSig = crypto.sign(null, Buffer.from(JSON.stringify(counterProposal)), keypair.privateKey).toString('base64');
        const counterMsg = {
          from: creatorId,
          to: msg.from,
          thread_id: msg.thread_id,
          type: 'counter',
          round: msg.round + 1,
          payload: counterProposal,
          signature: counterSig,
          timestamp: new Date().toISOString(),
          region
        };
        await withRetry(
          () => this.elastic.indexMessage(counterMsg),
          'collaboration-agent',
          'elastic_index_counter',
          { threadId: msg.thread_id },
          { maxAttempts: 3 }
        );

        const roundCommit = `collab_proposed_${msg.from}_${Date.now()}`;
        await withRetry(
          () => this.gitlab.commit(this.repo, roundCommit, []),
          'collaboration-agent',
          'gitlab_commit',
          { threadId: msg.thread_id },
          { maxAttempts: 3 }
        );
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed > 30000) {
      console.warn(`Collaboration cycle slow: ${elapsed}ms`);
    }
  }
}
