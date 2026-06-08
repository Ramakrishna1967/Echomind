import { MongoClient } from 'mongodb';
import { withRetry } from '../utils/retry.js';
import { MockCloserGemini, MockGitLabCommitter, MockFirebase } from './mocks.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface CloserAgentOptions {
  mongoUri?: string;
  dbName?: string;
  gemini?: MockCloserGemini;
  gitlab?: MockGitLabCommitter;
  firebase?: MockFirebase;
  repo?: string;
  killSwitchChecker?: KillSwitchChecker;
}

export class CloserAgent {
  private client: MongoClient;
  private dbName: string;
  private gemini: MockCloserGemini;
  private gitlab: MockGitLabCommitter;
  private firebase: MockFirebase;
  private repo: string;
  private killSwitchChecker?: KillSwitchChecker;

  constructor(opts: CloserAgentOptions = {}) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.gemini = opts.gemini || new MockCloserGemini();
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

  // Trigger: Pub/Sub from Negotiator when terms agreed -> stage=closing
  async handleTrigger(msg: { deal_id?: string; brand_name: string; creator_id: string; region?: string }): Promise<void> {
    const start = Date.now();
    const db = this.client.db(this.dbName);
    const configCol = db.collection('creator_config');
    const dealsCol = db.collection('active_deals');

    const region = msg.region || 'default';
    const creatorId = msg.creator_id;
    const brandName = msg.brand_name;

    // 1. Check kill_switch first
    if (this.killSwitchChecker) {
      if (await this.killSwitchChecker.isActive(creatorId, region)) return;
    } else {
      const config = await withRetry(
        () => configCol.findOne({ creator_id: creatorId, region }),
        'closer-agent',
        'read_kill_switch',
        { creatorId },
        { maxAttempts: 3, baseDelayMs: 50 }
      );
      if (config && config.kill_switch === true) {
        return;
      }
    }

    // 2. Read deal from active_deals (stage must = "closing") with precondition
    const deal = await withRetry(
      () => dealsCol.findOneAndUpdate(
        { brand_name: brandName, creator_id: creatorId, region, stage: 'closing' }, // precondition
        { $set: { last_activity: new Date() } },
        { returnDocument: 'after' }
      ),
      'closer-agent',
      'read_deal_closing',
      { brandName },
      { maxAttempts: 3 }
    );
    if (!deal) {
      // not in closing or race
      return;
    }

    // 3. Gemini fill contract
    const contractText = await withRetry(
      () => this.gemini.fillContract(deal, 'standard_template'),
      'closer-agent',
      'gemini_fill_contract',
      { brandName },
      { maxAttempts: 3 }
    );

    // Simulate generate PDF (just text for mock)
    const contractUrl = `https://mock-contracts/${brandName}.pdf`;

    // 4. Firebase push for human approval
    await withRetry(
      () => this.firebase.sendPush(creatorId, {
        type: 'deal_approval',
        brand: brandName,
        contract_url: contractUrl,
        rate: deal.current_terms?.rate || 1000,
        actions: ['Approve', 'Reject', 'Edit']
      }),
      'closer-agent',
      'firebase_push_approval',
      { brandName },
      { maxAttempts: 3 }
    );

    // 5. WAIT for human tap (in real: listen for update; in mock/test simulate by direct update)
    // For this impl, assume caller or test will call approve separately, but for flow, we simulate wait by checking
    // In practice, this would be event driven, here we just prepare.

    const commitMsg = `deal_prepared_${brandName}`;
    await withRetry(
      () => this.gitlab.commit(this.repo, commitMsg, []),
      'closer-agent',
      'gitlab_commit',
      { brandName },
      { maxAttempts: 3 }
    );

    const elapsed = Date.now() - start;
    if (elapsed > 30000) {
      console.warn(`Closer slow: ${elapsed}ms`);
    }
  }

  // Separate method for human approval (R2 gate) - called after Firebase tap in real
  async approveDeal(brandName: string, creatorId: string, region = 'default', approved: boolean = true): Promise<void> {
    const db = this.client.db(this.dbName);
    const dealsCol = db.collection('active_deals');

    if (!approved) {
      // handle reject, but per spec focus on approve
      return;
    }

    // Re-check kill on approval path
    if (this.killSwitchChecker) {
      if (await this.killSwitchChecker.isActive(creatorId, region)) return;
    } else {
      const cfgCol = db.collection('creator_config');
      const c = await cfgCol.findOne({ creator_id: creatorId, region });
      if (c && c.kill_switch === true) return;
    }

    // set human_approval flag (human approval action)
    await withRetry(
      () => dealsCol.findOneAndUpdate(
        { brand_name: brandName, creator_id: creatorId, region, stage: 'closing' },
        { $set: { human_approval: true, last_activity: new Date() } },
        { returnDocument: 'after' }
      ),
      'closer-agent',
      'set_human_approval',
      { brandName },
      { maxAttempts: 3 }
    );

    // R2: READ human_approval flag from MongoDB and verify it is true before stage=closed transition
    const approvalCheck = await withRetry(
      () => dealsCol.findOne({ brand_name: brandName, creator_id: creatorId, region, stage: 'closing' }),
      'closer-agent',
      'read_verify_human_approval',
      { brandName },
      { maxAttempts: 3 }
    );
    if (!approvalCheck || approvalCheck.human_approval !== true) {
      return;
    }

    // R2 HARD GATE: findOneAndUpdate with precondition (stage + human_approval)
    const updated = await withRetry(
      () => dealsCol.findOneAndUpdate(
        { brand_name: brandName, creator_id: creatorId, region, stage: 'closing', human_approval: true },
        { $set: { stage: 'closed', last_activity: new Date() } },
        { returnDocument: 'after' }
      ),
      'closer-agent',
      'r2_gate_close_deal',
      { brandName },
      { maxAttempts: 3 }
    );
    if (!updated) {
      return;
    }

    const commitMsg = `deal_closed_${brandName}_${Date.now()}`;
    await withRetry(
      () => this.gitlab.commit(this.repo, commitMsg, []),
      'closer-agent',
      'gitlab_commit',
      { brandName },
      { maxAttempts: 3 }
    );
  }
}
