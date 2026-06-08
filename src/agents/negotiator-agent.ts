import { MongoClient } from 'mongodb';
import { withRetry } from '../utils/retry.js';
import { MockFivetranGmail, MockNegotiatorGemini, MockArize, MockGitLabCommitter, MockFirebase } from './mocks.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface NegotiatorAgentOptions {
  mongoUri?: string;
  dbName?: string;
  fivetran?: MockFivetranGmail;
  gemini?: MockNegotiatorGemini;
  arize?: MockArize;
  gitlab?: MockGitLabCommitter;
  firebase?: MockFirebase;
  repo?: string;
  killSwitchChecker?: KillSwitchChecker;
}

export class NegotiatorAgent {
  private client: MongoClient;
  private dbName: string;
  private fivetran: MockFivetranGmail;
  private gemini: MockNegotiatorGemini;
  private arize: MockArize;
  private gitlab: MockGitLabCommitter;
  private firebase: MockFirebase;
  private repo: string;
  private killSwitchChecker?: KillSwitchChecker;

  constructor(opts: NegotiatorAgentOptions = {}) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.fivetran = opts.fivetran || new MockFivetranGmail();
    this.gemini = opts.gemini || new MockNegotiatorGemini();
    this.arize = opts.arize || new MockArize();
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

  // Trigger: Cloud Scheduler every 2 hours
  async handleTrigger(creatorId: string, region = 'default'): Promise<void> {
    const start = Date.now();
    const db = this.client.db(this.dbName);
    const configCol = db.collection('creator_config');
    const dealsCol = db.collection('active_deals');
    const profilesCol = db.collection('negotiation_profiles'); // assume exists

    // 1. Check kill_switch first
    if (this.killSwitchChecker) {
      if (await this.killSwitchChecker.isActive(creatorId, region)) {
        await this.freezeActiveDeals(creatorId, region, dealsCol);
        return;
      }
    } else {
      const config = await withRetry(
        () => configCol.findOne({ creator_id: creatorId, region }),
        'negotiator-agent',
        'read_kill_switch',
        { creatorId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );
      if (config && config.kill_switch === true) {
        // best effort freeze (defensive for test fakes that only stub config)
        if (dealsCol && typeof dealsCol.find === 'function') {
          await this.freezeActiveDeals(creatorId, region, dealsCol);
        }
        return;
      }
    }

    // 2. Read active_deals WHERE stage IN ["pitched","negotiating"]
    const activeDeals = await withRetry(
      () => dealsCol.find({ creator_id: creatorId, region, stage: { $in: ['pitched', 'negotiating'] } }).toArray(),
      'negotiator-agent',
      'read_active_deals',
      { creatorId },
      { maxAttempts: 3 }
    );

    // 3. Poll Gmail via Fivetran
    const replies = await withRetry(
      () => this.fivetran.checkReplies(creatorId),
      'negotiator-agent',
      'fivetran_poll_gmail',
      { creatorId },
      { maxAttempts: 3 }
    );

    for (const deal of activeDeals) {
      const brand = deal.brand_name;
      const round = deal.negotiation_history?.length || 0;
      const reply = replies.find((r: any) => r.brand === brand);

      if (!reply) continue;

      // 4. Gemini parse reply
      const parsed = await withRetry(
        () => this.gemini.parseReply(reply.body),
        'negotiator-agent',
        'gemini_parse_reply',
        { brand },
        { maxAttempts: 3 }
      );

      // Read negotiation profile
      const profile = await withRetry(
        () => profilesCol.findOne({ creator_id: creatorId, deal_type: 'sponsorship' }) || ({} as any),
        'negotiator-agent',
        'read_negotiation_profile',
        { creatorId },
        { maxAttempts: 3 }
      );

      // 5. Gemini generate counter
      const counter = await withRetry(
        () => this.gemini.generateCounter(deal.current_terms, parsed, profile),
        'negotiator-agent',
        'gemini_generate_counter',
        { brand },
        { maxAttempts: 3 }
      );

      // 6. Arize bounds check
      const bounds = await withRetry(
        () => this.arize.checkBounds(creatorId, counter, profile),
        'negotiator-agent',
        'arize_bounds_check',
        { brand },
        { maxAttempts: 3 }
      );

      if (bounds.within_bounds && round < 3) {
        // Send counter via Fivetran Gmail
        await withRetry(
          () => this.fivetran.sendEmail({
            to: `${brand.toLowerCase()}@example.com`,
            subject: `Re: Collab with ${brand}`,
            body: counter,
            creator_id: creatorId
          }),
          'negotiator-agent',
          'fivetran_send_counter',
          { brand },
          { maxAttempts: 3 }
        );

        // findOneAndUpdate stage=negotiating with precondition
        const updated = await withRetry(
          () => (dealsCol as any).findOneAndUpdate(
            { brand_name: brand, creator_id: creatorId, region, stage: { $in: ['pitched', 'negotiating'] } }, // precondition
            {
              $set: { stage: 'negotiating', last_activity: new Date() },
              $push: { negotiation_history: { round: round + 1, proposed_by: 'agent', terms: parsed.counter_offer, timestamp: new Date() } }
            },
            { returnDocument: 'after' }
          ),
          'negotiator-agent',
          'update_deal_negotiating',
          { brand },
          { maxAttempts: 3 }
        );
        if (!updated) {
          // race condition
          continue;
        }

        const commitMsg = `negotiation_round_${round + 1}_${brand}`;
        await withRetry(
          () => this.gitlab.commit(this.repo, commitMsg, []),
          'negotiator-agent',
          'gitlab_commit',
          { brand },
          { maxAttempts: 3 }
        );
      } else {
        // Escalate to Firebase
        await withRetry(
          () => this.firebase.sendPush(creatorId, {
            type: 'negotiation_escalation',
            brand,
            round: round + 1
          }),
          'negotiator-agent',
          'firebase_escalate',
          { brand },
          { maxAttempts: 3 }
        );

        const commitMsg = `negotiation_escalated_${brand}`;
        await withRetry(
          () => this.gitlab.commit(this.repo, commitMsg, []),
          'negotiator-agent',
          'gitlab_commit',
          { brand },
          { maxAttempts: 3 }
        );
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed > 30000) {
      console.warn(`Negotiator cycle slow: ${elapsed}ms`);
    }
  }

  private async freezeActiveDeals(creatorId: string, region: string, dealsCol: any): Promise<void> {
    if (!dealsCol || typeof dealsCol.find !== 'function') return;
    // Per spec: on kill, move active pitched/negotiating/... to frozen (use findOneAndUpdate + precondition)
    let active: any[] = [];
    try {
      active = await withRetry(
        () => dealsCol.find({ creator_id: creatorId, region, stage: { $in: ['pitched', 'negotiating', 'closing', 'escalated'] } }).toArray(),
        'negotiator-agent',
        'freeze_read_active',
        { creatorId },
        { maxAttempts: 2 }
      );
    } catch { return; }
    for (const deal of active || []) {
      try {
        await withRetry(
          () => (dealsCol as any).findOneAndUpdate(
            { brand_name: deal.brand_name, creator_id: creatorId, region, stage: deal.stage }, // precondition
            { $set: { stage: 'frozen', previous_stage: deal.stage, frozen_reason: 'KILL_SWITCH', frozen_at: new Date(), last_activity: new Date() } },
            { returnDocument: 'after' }
          ),
          'negotiator-agent',
          'freeze_deal',
          { brand: deal.brand_name },
          { maxAttempts: 2 }
        );
      } catch {}
    }
    // GitLab freeze commit (best effort)
    try {
      if ((this as any).gitlab && typeof this.gitlab.commit === 'function') {
        const msg = `kill_switch_frozen_deals_${creatorId}_${Date.now()}`;
        await withRetry(() => this.gitlab!.commit((this as any).repo || 'echomind-sovereign', msg, []), 'negotiator-agent', 'gitlab_kill_freeze', {}, { maxAttempts: 2 });
      }
    } catch {}
  }
}
