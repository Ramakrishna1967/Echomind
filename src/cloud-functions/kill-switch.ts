import { MongoClient } from 'mongodb';
import { withRetry } from '../utils/retry.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface KillSwitchCFDeps {
  client: MongoClient;
  arize?: { log_event?: (args: any) => Promise<any> };
  dynatrace?: { create_event?: (args: any) => Promise<any> };
  gitlab?: { commit?: (repo: string, msg: string, files: any[]) => Promise<any> };
  firebase?: { verifyIdToken?: (t: string) => Promise<{uid: string}>; sendPush?: (c: string, p: any) => Promise<void> };
  repo?: string;
  dbName?: string;
}

export interface KillResult {
  status: string;
  reason?: string;
  frozenDeals?: string[];
  remainingSeconds?: number;
}

export class KillSwitchCloudFunction {
  private checker: KillSwitchChecker;

  constructor(private deps: KillSwitchCFDeps) {
    this.checker = new KillSwitchChecker(deps.client, deps.dbName || 'echomind');
  }

  private async verifyBiometric(token: string | undefined, creatorId: string): Promise<void> {
    const fb = this.deps.firebase;
    if (!token) throw new Error('biometric_token_required');
    if (fb && typeof fb.verifyIdToken === 'function') {
      const res = await fb.verifyIdToken(token);
      if (res.uid !== creatorId) throw new Error('biometric_mismatch');
    } else {
      // permissive mock fallback
      if (!token.startsWith('bio_') || token.slice(4) !== creatorId) throw new Error('biometric_failed');
    }
  }

  async activate(creatorId: string, region = 'default', biometricToken?: string, reason = 'human', trigger?: string): Promise<KillResult> {
    await this.verifyBiometric(biometricToken, creatorId);

    const db = this.deps.client.db(this.deps.dbName || 'echomind');
    const col = db.collection('creator_config');

    const activatedBy = trigger === 'dynatrace_auto' ? 'dynatrace_auto' : 'creator';

    const updated = await withRetry(
      () => (col as any).findOneAndUpdate(
        { creator_id: creatorId, region, kill_switch: { $ne: true } }, // precondition per AGENTS rule
        {
          $set: {
            kill_switch: true,
            kill_switch_activated_at: new Date(),
            kill_switch_reason: reason,
            kill_switch_activated_by: activatedBy,
            updated_at: new Date()
          }
        },
        { returnDocument: 'after' }
      ),
      'kill-switch-cf',
      'activate_findOneAndUpdate',
      { creatorId, region },
      { maxAttempts: 2 }
    );

    if (!updated) {
      // already true or race; still succeed for idempotency
    }

    // side effects
    const ts = Date.now();
    if (this.deps.arize && this.deps.arize.log_event) {
      await this.deps.arize.log_event({ type: 'kill_switch_event', creator_id: creatorId, timestamp: new Date().toISOString(), reason });
    }
    if (this.deps.dynatrace && this.deps.dynatrace.create_event) {
      await this.deps.dynatrace.create_event({ event_type: 'kill_switch', title: `Kill switch activated for ${creatorId}`, creator_id: creatorId, reason });
    }
    if (this.deps.gitlab && this.deps.gitlab.commit) {
      const msg = `kill_switch_activated_${creatorId}_${ts}`;
      await this.deps.gitlab.commit(this.deps.repo || 'echomind-sovereign', msg, []);
    }

    // invalidate local cache view
    this.checker.invalidate(creatorId, region);

    return { status: 'activated' };
  }

  async deactivate(creatorId: string, region = 'default', biometricToken?: string): Promise<KillResult> {
    await this.verifyBiometric(biometricToken, creatorId);

    const db = this.deps.client.db(this.deps.dbName || 'echomind');
    const cfgCol = db.collection('creator_config');
    const dealsCol = db.collection('active_deals');

    // read current to check cooldown
    const cfg = await withRetry(
      () => cfgCol.findOne({ creator_id: creatorId, region }),
      'kill-switch-cf',
      'deactivate_read_cfg',
      { creatorId },
      { maxAttempts: 2 }
    );

    if (cfg && cfg.kill_switch_activated_at) {
      const activated = new Date(cfg.kill_switch_activated_at).getTime();
      const elapsed = Date.now() - activated;
      if (elapsed < 15 * 60 * 1000) {
        return { status: 'COOLDOWN', remainingSeconds: Math.ceil((15 * 60 * 1000 - elapsed) / 1000) };
      }
    }

    // check frozen deals (per spec)
    const frozen = await withRetry(
      () => dealsCol.find({ creator_id: creatorId, region, stage: 'frozen' }).project({ thread_id: 1 }).toArray(),
      'kill-switch-cf',
      'deactivate_check_frozen',
      { creatorId },
      { maxAttempts: 2 }
    );
    if (frozen.length > 0) {
      return { status: 'PENDING_DEAL_REVIEW', frozenDeals: frozen.map((d: any) => d.thread_id) };
    }

    // preconditioned deactivate
    const updated = await withRetry(
      () => (cfgCol as any).findOneAndUpdate(
        { creator_id: creatorId, region, kill_switch: true }, // precondition
        { $set: { kill_switch: false, kill_switch_activated_at: null, kill_switch_reason: null, kill_switch_activated_by: null, updated_at: new Date() } },
        { returnDocument: 'after' }
      ),
      'kill-switch-cf',
      'deactivate_findOneAndUpdate',
      { creatorId },
      { maxAttempts: 2 }
    );
    if (!updated) {
      // race or already off
    }

    this.checker.invalidate(creatorId, region);

    if (this.deps.gitlab && this.deps.gitlab.commit) {
      await this.deps.gitlab.commit(this.deps.repo || 'echomind-sovereign', `kill_switch_deactivated_${creatorId}_${Date.now()}`, []);
    }

    return { status: 'deactivated' };
  }
}
