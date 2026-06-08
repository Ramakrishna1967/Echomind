import { MongoClient } from 'mongodb';
import { withRetry } from '../utils/retry.js';
import { MockPitcherGemini, MockArize, MockFivetranGmail, MockGitLabCommitter } from './mocks.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface PitcherAgentOptions {
  mongoUri?: string;
  dbName?: string;
  gemini?: MockPitcherGemini;
  arize?: MockArize;
  fivetran?: MockFivetranGmail;
  gitlab?: MockGitLabCommitter;
  repo?: string;
  killSwitchChecker?: KillSwitchChecker;
}

export class PitcherAgent {
  private client: MongoClient;
  private dbName: string;
  private gemini: MockPitcherGemini;
  private arize: MockArize;
  private fivetran: MockFivetranGmail;
  private gitlab: MockGitLabCommitter;
  private repo: string;
  private killSwitchChecker?: KillSwitchChecker;

  constructor(opts: PitcherAgentOptions = {}) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.gemini = opts.gemini || new MockPitcherGemini();
    this.arize = opts.arize || new MockArize();
    this.fivetran = opts.fivetran || new MockFivetranGmail();
    this.gitlab = opts.gitlab || new MockGitLabCommitter();
    this.repo = opts.repo || 'echomind-sovereign';
    this.killSwitchChecker = opts.killSwitchChecker;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  // Trigger: Pub/Sub from Hunter
  async handleTrigger(msg: { brand_name: string; creator_id: string; region?: string }): Promise<void> {
    const start = Date.now();
    const db = this.client.db(this.dbName);
    const configCol = db.collection('creator_config');
    const targetsCol = db.collection('brand_targets');
    const dealsCol = db.collection('active_deals');
    const vocabCol = db.collection('vocabulary');

    const region = msg.region || 'default';
    const creatorId = msg.creator_id;
    const brandName = msg.brand_name;

    // 1. Check kill_switch first
    if (this.killSwitchChecker) {
      if (await this.killSwitchChecker.isActive(creatorId, region)) return;
    } else {
      const config = await withRetry(
        () => configCol.findOne({ creator_id: creatorId, region }),
        'pitcher-agent',
        'read_kill_switch',
        { creatorId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );
      if (config && config.kill_switch === true) {
        return;
      }
    }

    // Load config for rate_card etc (post kill gate)
    const config = await withRetry(
      () => configCol.findOne({ creator_id: creatorId, region }),
      'pitcher-agent',
      'read_config',
      { creatorId },
      { maxAttempts: 3, baseDelayMs: 50 }
    );

    // 2. Read targets (brand_targets for this brand)
    const target = await withRetry(
      () => targetsCol.findOne({ brand_name: brandName, creator_id: creatorId, region, status: 'identified' }),
      'pitcher-agent',
      'read_brand_target',
      { brandName },
      { maxAttempts: 3 }
    );
    if (!target) return;

    // Read creator personality/vocab/rate from creator_config + vocabulary
    const vocabDocs = await withRetry(
      () => vocabCol.find({ creator_id: creatorId, region }).sort({ frequency: -1 }).limit(50).toArray(),
      'pitcher-agent',
      'read_vocabulary',
      { creatorId },
      { maxAttempts: 3 }
    );
    const vocabularySignatures = vocabDocs.map((v: any) => v.word);
    const rateMultiplier = config?.rate_card?.opening_ask_multiplier || 1.5;

    // 3. Gemini cold email in exact voice
    const emailText = await withRetry(
      () => this.gemini.writeColdEmail(vocabularySignatures, brandName, rateMultiplier),
      'pitcher-agent',
      'gemini_cold_email',
      { brandName },
      { maxAttempts: 3, baseDelayMs: 50 }
    );

    // 4. Arize bounds check
    const profile = config; // negotiation profile in real from separate col, here use config
    const bounds = await withRetry(
      () => this.arize.checkBounds(creatorId, emailText, profile),
      'pitcher-agent',
      'arize_bounds_check',
      { brandName },
      { maxAttempts: 3 }
    );
    if (!bounds.within_bounds) {
      return; // escalate in real
    }

    // 5. Send via Fivetran Gmail (MCP)
    await withRetry(
      () => this.fivetran.sendEmail({
        to: `${brandName.toLowerCase()}@example.com`,
        subject: `Collab with ${brandName}`,
        body: emailText,
        creator_id: creatorId
      }),
      'pitcher-agent',
      'fivetran_gmail_send',
      { brandName },
      { maxAttempts: 3 }
    );

    // 6. findOneAndUpdate INSERT active_deals stage=pitched, human_approval=false
    // Use precondition to avoid duplicate (race safe)
    const dealInsert = await withRetry(
      () => dealsCol.findOneAndUpdate(
        { brand_name: brandName, creator_id: creatorId, region, stage: { $exists: false } }, // precondition for new
        {
          $setOnInsert: {
            stage: 'pitched',
            human_approval: false,
            thread_id: `thread-${Date.now()}`,
            current_terms: { rate_multiplier: rateMultiplier },
            negotiation_history: [],
            opened_date: new Date(),
            last_activity: new Date(),
            brand_name: brandName,
            creator_id: creatorId,
            region
          }
        },
        { upsert: true, returnDocument: 'after' }
      ),
      'pitcher-agent',
      'insert_active_deal',
      { brandName },
      { maxAttempts: 3 }
    );
    if (!dealInsert) {
      // race condition, do not proceed
      return;
    }

    // Update target status
    await withRetry(
      () => targetsCol.findOneAndUpdate(
        { brand_name: brandName, creator_id: creatorId, region, status: 'identified' },
        { $set: { status: 'pitched' } },
        { returnDocument: 'after' }
      ),
      'pitcher-agent',
      'update_target_status',
      { brandName },
      { maxAttempts: 3 }
    );

    // 7. GitLab commit
    const commitMsg = `pitched_${brandName}_${Date.now()}`;
    await withRetry(
      () => this.gitlab.commit(this.repo, commitMsg, []),
      'pitcher-agent',
      'gitlab_commit',
      { brandName },
      { maxAttempts: 3 }
    );

    const elapsed = Date.now() - start;
    if (elapsed > 30000) {
      console.warn(`Pitcher slow: ${elapsed}ms for ${brandName}`);
    }
  }
}
