import { MongoClient } from 'mongodb';
import { withRetry } from './retry.js';

export class KillSwitchChecker {
  private cache = new Map<string, { val: boolean; ts: number }>();
  private readonly TTL_MS = 5000;

  constructor(private client: MongoClient, private dbName = 'echomind') {}

  private k(creatorId: string, region = 'default'): string {
    return `${creatorId}:${region}`;
  }

  async isActive(creatorId: string, region = 'default'): Promise<boolean> {
    const key = this.k(creatorId, region);
    const hit = this.cache.get(key);
    if (hit && (Date.now() - hit.ts) < this.TTL_MS) {
      return hit.val;
    }
    try {
      const db = this.client.db(this.dbName);
      const col = db.collection('creator_config');
      const cfg = await withRetry(
        () => col.findOne({ creator_id: creatorId, region }),
        'kill-switch-checker',
        'read_kill_switch',
        { creatorId, region },
        { maxAttempts: 2, baseDelayMs: 10 }
      );
      const val = !!(cfg && cfg.kill_switch === true);
      this.cache.set(key, { val, ts: Date.now() });
      return val;
    } catch {
      // fail-safe per architecture: if cannot read kill_switch, assume frozen (STOP)
      return true;
    }
  }

  invalidate(creatorId: string, region = 'default'): void {
    this.cache.delete(this.k(creatorId, region));
  }

  // Force set (used by broadcaster on change event or tests)
  setForTest(creatorId: string, region = 'default', val: boolean): void {
    this.cache.set(this.k(creatorId, region), { val, ts: Date.now() });
  }

  clearCache(): void {
    this.cache.clear();
  }
}
