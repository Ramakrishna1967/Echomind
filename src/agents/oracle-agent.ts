import { MongoClient } from 'mongodb';
import { withRetry } from '../utils/retry.js';
import { MockElasticTrending, MockOracleGemini, MockArize, MockPubSub, MockFirebase, MockGitLabCommitter, OraclePrediction } from './mocks.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface OracleAgentOptions {
  mongoUri?: string;
  dbName?: string;
  elastic?: MockElasticTrending;
  gemini?: MockOracleGemini;
  arize?: MockArize;
  gitlab?: MockGitLabCommitter;
  pubsub?: MockPubSub;
  firebase?: MockFirebase;
  creatorName?: string;
  repo?: string;
  killSwitchChecker?: KillSwitchChecker;
}

export class OracleAgent {
  private client: MongoClient;
  private dbName: string;
  private elastic: MockElasticTrending;
  private gemini: MockOracleGemini;
  private arize: MockArize;
  private gitlab: MockGitLabCommitter;
  private pubsub: MockPubSub;
  private firebase: MockFirebase;
  private repo: string;
  private killSwitchChecker?: KillSwitchChecker;

  constructor(opts: OracleAgentOptions = {}) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.elastic = opts.elastic || new MockElasticTrending();
    this.gemini = opts.gemini || new MockOracleGemini();
    this.arize = opts.arize || new MockArize();
    this.gitlab = opts.gitlab || new MockGitLabCommitter();
    this.pubsub = opts.pubsub || new MockPubSub();
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

  // Pub/Sub trigger entrypoint
  async handleTrigger(creatorId: string, region = 'default'): Promise<void> {
    const start = Date.now();
    const db = this.client.db(this.dbName);
    const configCol = db.collection('creator_config');
    const predictedCol = db.collection('predicted_opinions');

    // 1. Check kill_switch FIRST (abort if true). Use injected 5s TTL checker when present (fail-safe STOP).
    if (this.killSwitchChecker) {
      const k = await this.killSwitchChecker.isActive(creatorId, region);
      if (k) return;
    } else {
      const config = await withRetry(
        () => configCol.findOne({ creator_id: creatorId, region }),
        'oracle-agent',
        'read_kill_switch',
        { creatorId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );
      if (config && config.kill_switch === true) {
        return; // abort immediately
      }
    }

    // 2. Fetch trending topics from Elastic (world_events_stream)
    const trending = await withRetry(
      () => this.elastic.getTrendingTopics(creatorId, 50),
      'oracle-agent',
      'elastic_trending',
      { creatorId },
      { maxAttempts: 3, baseDelayMs: 50 }
    );

    // 3. ONE batched Gemini call for 50 topics
    const predictions: OraclePrediction[] = await withRetry(
      () => this.gemini.predictBatch(creatorId, trending),
      'oracle-agent',
      'gemini_batch_predict',
      { creatorId, count: trending.length },
      { maxAttempts: 3, baseDelayMs: 50 }
    );

    // 4. Route and write
    for (const pred of predictions) {
      const predictionId = `${creatorId}_${pred.topic}_${Date.now()}`;

      // Write to predicted_opinions (with region for shard)
      await withRetry(
        () => predictedCol.insertOne({
          topic: pred.topic,
          predicted_position: pred.predicted_position,
          confidence: pred.confidence,
          predicted_statement_date: new Date(Date.now() + 28 * 24 * 3600 * 1000), // ~4 weeks
          posted: pred.confidence > 0.75,
          approved: pred.confidence <= 0.75 && pred.confidence >= 0.50,
          accuracy_score: null,
          actual_position: null,
          actual_date: null,
          creator_id: creatorId,
          region
        }),
        'oracle-agent',
        'write_predicted_opinion',
        { creatorId, topic: pred.topic },
        { maxAttempts: 3 }
      );

      // Arize log
      await withRetry(
        () => this.arize.logPrediction(creatorId, predictionId, pred.predicted_position, null, null),
        'oracle-agent',
        'arize_log',
        { creatorId, predictionId },
        { maxAttempts: 3 }
      );

      // Route
      if (pred.confidence > 0.75) {
        // auto-post Pub/Sub to Content Agent
        await withRetry(
          () => this.pubsub.publish('content-agent', { prediction_id: predictionId, creator_id: creatorId, region }),
          'oracle-agent',
          'pubsub_auto_post',
          { predictionId },
          { maxAttempts: 3 }
        );
      } else if (pred.confidence >= 0.50) {
        // 0.50-0.75 Firebase push for review
        await withRetry(
          () => this.firebase.sendPush(creatorId, {
            type: 'prediction_review',
            topic: pred.topic,
            suggested_post_text: pred.suggested_post_text,
            confidence: pred.confidence
          }),
          'oracle-agent',
          'firebase_push',
          { predictionId },
          { maxAttempts: 3 }
        );
      } else {
        // <0.50 discard - no action
      }
    }

    // 5. GitLab commit
    const commitMsg = `oracle_cycle_${Date.now()}`;
    await withRetry(
      () => this.gitlab.commit(this.repo, commitMsg, []),
      'oracle-agent',
      'gitlab_commit',
      { creatorId },
      { maxAttempts: 3 }
    );

    const elapsed = Date.now() - start;
    if (elapsed > 45000) {
      console.warn(`Oracle cycle exceeded 45s SLA: ${elapsed}ms for ${creatorId}`);
    }
  }
}
