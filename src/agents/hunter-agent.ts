import { MongoClient } from 'mongodb';
import { withRetry } from '../utils/retry.js';
import { MockElasticBrands, MockHunterGemini, MockGitLabCommitter, MockPubSub } from './mocks.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface HunterAgentOptions {
  mongoUri?: string;
  dbName?: string;
  elastic?: MockElasticBrands;
  gemini?: MockHunterGemini;
  gitlab?: MockGitLabCommitter;
  pubsub?: MockPubSub;
  repo?: string;
  killSwitchChecker?: KillSwitchChecker;
}

export class HunterAgent {
  private client: MongoClient;
  private dbName: string;
  private elastic: MockElasticBrands;
  private gemini: MockHunterGemini;
  private gitlab: MockGitLabCommitter;
  private pubsub: MockPubSub;
  private repo: string;
  private killSwitchChecker?: KillSwitchChecker;

  constructor(opts: HunterAgentOptions = {}) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.elastic = opts.elastic || new MockElasticBrands();
    this.gemini = opts.gemini || new MockHunterGemini();
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

  // Trigger: Cloud Scheduler weekly
  async handleTrigger(creatorId: string, region = 'default'): Promise<void> {
    const start = Date.now();
    const db = this.client.db(this.dbName);
    const configCol = db.collection('creator_config');
    const targetsCol = db.collection('brand_targets');

    // 1. Check kill_switch first (checker preferred for 5s TTL + fail-safe)
    if (this.killSwitchChecker) {
      if (await this.killSwitchChecker.isActive(creatorId, region)) return;
    } else {
      const config = await withRetry(
        () => configCol.findOne({ creator_id: creatorId, region }),
        'hunter-agent',
        'read_kill_switch',
        { creatorId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );
      if (config && config.kill_switch === true) {
        return;
      }
    }

    // 2. Elastic search: trending brands in creator's niche
    const niche = 'tech'; // from config or graph in real
    const brands = await withRetry(
      () => this.elastic.searchBrands(creatorId, niche),
      'hunter-agent',
      'elastic_brand_search',
      { creatorId },
      { maxAttempts: 3, baseDelayMs: 50 }
    );

    // 3. Gemini fit scoring + filter + insert + pubsub
    for (const brand of brands) {
      const personality = {}; // from graph
      const score = await withRetry(
        () => this.gemini.scoreBrandFit(brand, personality),
        'hunter-agent',
        'gemini_fit_score',
        { brand: brand.brand_name },
        { maxAttempts: 3, baseDelayMs: 50 }
      );

      const audienceOverlap = brand.audience_overlap || 0;
      const compatible = score.compatible && audienceOverlap > 0.3;

      if (compatible) {
        // 5. Insert to brand_targets
        await withRetry(
          () => targetsCol.insertOne({
            brand_name: brand.brand_name,
            fit_score: score.fit_score,
            audience_overlap: audienceOverlap,
            niche_tags: brand.niche_tags || [niche],
            status: 'identified',
            creator_id: creatorId,
            region
          }),
          'hunter-agent',
          'insert_brand_target',
          { brand: brand.brand_name },
          { maxAttempts: 3 }
        );

        // 6. Pub/Sub trigger Pitcher
        await withRetry(
          () => this.pubsub.publish('pitcher', { brand_name: brand.brand_name, creator_id: creatorId, region }),
          'hunter-agent',
          'pubsub_pitcher',
          { brand: brand.brand_name },
          { maxAttempts: 3 }
        );

        // GitLab commit per target per spec pattern
        const commitMsg = `hunter_${brand.brand_name}_${Date.now()}`;
        await withRetry(
          () => this.gitlab.commit(this.repo, commitMsg, []),
          'hunter-agent',
          'gitlab_commit',
          { brand: brand.brand_name },
          { maxAttempts: 3 }
        );
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed > 30000) {
      console.warn(`Hunter cycle slow: ${elapsed}ms`);
    }
  }
}
