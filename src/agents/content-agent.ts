import { MongoClient } from 'mongodb';
import { withRetry } from '../utils/retry.js';
import { MockContentGemini, MockArize, MockFivetranPublisher, MockGitLabCommitter, MockPubSub, ContentPrediction } from './mocks.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface ContentAgentOptions {
  mongoUri?: string;
  dbName?: string;
  gemini?: MockContentGemini;
  arize?: MockArize;
  fivetran?: MockFivetranPublisher;
  gitlab?: MockGitLabCommitter;
  pubsub?: MockPubSub;
  repo?: string;
  killSwitchChecker?: KillSwitchChecker;
}

export class ContentAgent {
  private client: MongoClient;
  private dbName: string;
  private gemini: MockContentGemini;
  private arize: MockArize;
  private fivetran: MockFivetranPublisher;
  private gitlab: MockGitLabCommitter;
  private pubsub: MockPubSub;
  private repo: string;
  private killSwitchChecker?: KillSwitchChecker;

  constructor(opts: ContentAgentOptions = {}) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.gemini = opts.gemini || new MockContentGemini();
    this.arize = opts.arize || new MockArize();
    this.fivetran = opts.fivetran || new MockFivetranPublisher();
    this.gitlab = opts.gitlab || new MockGitLabCommitter();
    this.pubsub = opts.pubsub || new MockPubSub();
    this.repo = opts.repo || 'echomind-sovereign';
    this.killSwitchChecker = opts.killSwitchChecker;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  // Pub/Sub trigger from Oracle (auto-post >0.75)
  async handleTrigger(msg: { prediction_id?: string; creator_id: string; region?: string; suggested_post_text?: string; suggested_platform?: string; topic?: string }): Promise<void> {
    const start = Date.now();
    const db = this.client.db(this.dbName);
    const configCol = db.collection('creator_config');
    const predCol = db.collection('predicted_opinions');
    const vocabCol = db.collection('vocabulary');
    const rawCol = db.collection('raw_content');

    const region = msg.region || 'default';
    const creatorId = msg.creator_id;

    // 1. Kill switch check FIRST (5s TTL checker if injected, else direct)
    if (this.killSwitchChecker) {
      if (await this.killSwitchChecker.isActive(creatorId, region)) return;
    } else {
      const config = await withRetry(
        () => configCol.findOne({ creator_id: creatorId, region }),
        'content-agent',
        'read_kill_switch',
        { creatorId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );
      if (config && config.kill_switch === true) {
        return; // abort immediately
      }
    }

    // 2. Read predicted_opinions (use provided or query)
    let prediction: any = null;
    if (msg.prediction_id) {
      prediction = await withRetry(
        () => (predCol as any).findOne({ _id: msg.prediction_id as any, creator_id: creatorId, region }),
        'content-agent',
        'read_predicted_opinion',
        { creatorId },
        { maxAttempts: 3 }
      );
    }
    if (!prediction && msg.suggested_post_text) {
      // for test direct
      prediction = {
        _id: 'mock-pred-id',
        topic: msg.topic || 'test',
        suggested_post_text: msg.suggested_post_text,
        suggested_platform: msg.suggested_platform || 'twitter',
        creator_id: creatorId,
        region,
        posted: false
      };
    }
    if (!prediction) return;

    // 3. Read vocabulary fingerprint
    const vocabDocs = await withRetry(
      () => vocabCol.find({ creator_id: creatorId, region }).sort({ frequency: -1 }).limit(50).toArray(),
      'content-agent',
      'read_vocabulary',
      { creatorId },
      { maxAttempts: 3 }
    );
    const vocabularySignatures: string[] = vocabDocs.map((v: any) => v.word || v);

    // 4. Gemini voice refinement
    const refinedText = await withRetry(
      () => this.gemini.refinePost(prediction.suggested_post_text, vocabularySignatures, 'reflective'),
      'content-agent',
      'gemini_refine',
      { creatorId },
      { maxAttempts: 3 }
    );

    // 5. Arize R1 + R3 policy check BEFORE publish
    const policy = await withRetry(
      () => this.arize.checkPolicy(creatorId, refinedText, { r1: true, r3: true }),
      'content-agent',
      'arize_policy_check',
      { creatorId },
      { maxAttempts: 3 }
    );
    if (!policy.pass) {
      // do not publish
      return;
    }

    // 6. Publish via Fivetran ONLY (never direct)
    await withRetry(
      () => this.fivetran.publishPost({
        platform: prediction.suggested_platform,
        text: refinedText,
        creator_id: creatorId
      }),
      'content-agent',
      'fivetran_publish',
      { creatorId },
      { maxAttempts: 3 }
    );

    // Log to raw_content as echomind_generated (per arch)
    await withRetry(
      () => rawCol.insertOne({
        doc_id: `gen-${Date.now()}`,
        creator_id: creatorId,
        platform: 'echomind_generated',
        content: refinedText,
        timestamp: new Date(),
        topic_tags: [prediction.topic],
        sentiment_score: 0.5,
        opinion_strength: 0.7,
        emotional_state: 'reflective',
        word_count: refinedText.split(' ').length,
        engagement_signals: { likes: 0, replies: 0, shares: 0, views: 0 },
        raw_url: `internal://echomind/${creatorId}`,
        processing_status: 'graphed',
        region
      }),
      'content-agent',
      'log_published_raw',
      { creatorId },
      { maxAttempts: 3 }
    );

    // Update prediction posted with precondition (state transition rule)
    if (prediction._id) {
      await withRetry(
        () => (predCol as any).findOneAndUpdate(
          { _id: prediction._id, creator_id: creatorId, region, posted: { $ne: true } }, // precondition
          { $set: { posted: true } },
          { returnDocument: 'after' }
        ),
        'content-agent',
        'update_prediction_posted',
        { creatorId },
        { maxAttempts: 3 }
      );
    }

    // 7. GitLab commit
    const commitMsg = `published_${prediction.suggested_platform}_${Date.now()}`;
    await withRetry(
      () => this.gitlab.commit(this.repo, commitMsg, []),
      'content-agent',
      'gitlab_commit',
      { creatorId },
      { maxAttempts: 3 }
    );

    const elapsed = Date.now() - start;
    if (elapsed > 30000) {
      console.warn(`Content agent slow: ${elapsed}ms`);
    }
  }
}
