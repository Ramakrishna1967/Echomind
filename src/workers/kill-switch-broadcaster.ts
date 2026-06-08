import { MongoClient, ChangeStreamDocument } from 'mongodb';
import { MockRedis, MockKillSwitchBus } from '../agents/mocks.js';
import { withRetry } from '../utils/retry.js';

export interface KillSwitchBroadcasterOptions {
  mongoUri?: string;
  dbName?: string;
  redis?: MockRedis;
  bus?: MockKillSwitchBus;
}

export class KillSwitchBroadcaster {
  private client: MongoClient;
  private dbName: string;
  private redis: MockRedis;
  private bus: MockKillSwitchBus;
  private streams: any[] = [];

  constructor(opts: KillSwitchBroadcasterOptions = {}) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.redis = opts.redis || new MockRedis();
    this.bus = opts.bus || new MockKillSwitchBus();
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    for (const s of this.streams) {
      try { await s.close(); } catch {}
    }
    await this.client.close();
  }

  // Start watching creator_config for kill_switch changes (per arch Stream 3)
  async start(): Promise<void> {
    const db = this.client.db(this.dbName);
    const col = db.collection('creator_config');

    const pipeline = [
      {
        $match: {
          $or: [
            {
              operationType: 'update',
              'updateDescription.updatedFields.kill_switch': { $exists: true }
            },
            { operationType: 'replace' }
          ]
        }
      }
    ];

    const stream = col.watch(pipeline, { fullDocument: 'updateLookup' as const });

    this.streams.push(stream);

    stream.on('change', async (event: ChangeStreamDocument<any>) => {
      const full: any = (event as any).fullDocument;
      if (full) {
        const config = full;
        const signal = {
          creator_id: config.creator_id,
          kill_switch: config.kill_switch,
          timestamp: new Date().toISOString()
        };

        const ch = `echomind:kill_switch:${config.creator_id}`;
        await this.redis.publish(ch, JSON.stringify(signal));
        await this.redis.set(`echomind:kill_switch_state:${config.creator_id}`, config.kill_switch ? 'frozen' : 'active', 5);

        // immediate in-proc bus for tests/agents that registered
        this.bus.emit(config.creator_id, signal);

        // best-effort resume token store (in-mem for this mock impl)
        // in real would persist to _change_stream_tokens
      }
    });

    // keep process alive for watch in non-test
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable no-empty
    }
  }

  // Test helper: manually inject a change as if from watch
  async simulateChange(config: { creator_id: string; region?: string; kill_switch: boolean }) {
    const signal = { creator_id: config.creator_id, kill_switch: config.kill_switch, timestamp: new Date().toISOString() };
    const ch = `echomind:kill_switch:${config.creator_id}`;
    await this.redis.publish(ch, JSON.stringify(signal));
    await this.redis.set(`echomind:kill_switch_state:${config.creator_id}`, config.kill_switch ? 'frozen' : 'active', 5);
    this.bus.emit(config.creator_id, signal);
  }

  getBus(): MockKillSwitchBus { return this.bus; }
  getRedis(): MockRedis { return this.redis; }
}
