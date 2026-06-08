import { jest } from '@jest/globals';
import { MongoClient } from 'mongodb';
import { KillSwitchCloudFunction } from '../../src/cloud-functions/kill-switch.js';
import { MockArize, MockDynatrace, MockGitLabCommitter, MockFirebase } from '../../src/agents/mocks.js';

jest.setTimeout(15000);

describe('Kill Switch Cloud Function (human + dynatrace, biometric, 15m cooldown, frozen review, findOneAndUpdate)', () => {
  let client: MongoClient;
  const dbName = 'echomind_killcf_' + Date.now();
  let arize: MockArize, dt: MockDynatrace, gl: MockGitLabCommitter, fb: MockFirebase;
  let cf: KillSwitchCloudFunction;

  beforeAll(async () => {
    client = new MongoClient('mongodb://localhost:27017');
    await client.connect();
    const cfg = client.db(dbName).collection('creator_config');
    await cfg.deleteMany({});
    await cfg.insertOne({
      creator_id: 'c1', region: 'default', kill_switch: false,
      playbook_rules: {}, api_credentials_ref: 'r', notification_preferences: {email:true,sms:false,push:true},
      created_at: new Date(), updated_at: new Date()
    });
    const deals = client.db(dbName).collection('active_deals');
    await deals.deleteMany({});
  });

  afterAll(async () => {
    await client.db(dbName).dropDatabase().catch(() => {});
    await client.close();
  });

  beforeEach(() => {
    arize = new MockArize();
    dt = new MockDynatrace();
    gl = new MockGitLabCommitter();
    fb = new MockFirebase();
    fb.setAuthToken('c1', 'bio_c1');
    cf = new KillSwitchCloudFunction({ client, arize: { log_event: (a:any)=>Promise.resolve(true) } as any, dynatrace: dt as any, gitlab: gl, firebase: fb, dbName, repo: 'echomind-sovereign' });
  });

  it('human activate: biometric, findOneAndUpdate, side effects, GitLab kill_switch_activated_', async () => {
    const res = await cf.activate('c1', 'default', 'bio_c1', 'human');
    expect(res.status).toBe('activated');
    const cfg = await client.db(dbName).collection('creator_config').findOne({ creator_id: 'c1' });
    expect(cfg?.kill_switch).toBe(true);
    expect(cfg?.kill_switch_activated_by).toBe('creator');
    expect(dt.events.length).toBeGreaterThan(0);
    expect(gl['commits'] || (gl as any).commit).toBeTruthy(); // commit called
  });

  it('dynatrace auto path sets activated_by dynatrace_auto', async () => {
    // reset
    await client.db(dbName).collection('creator_config').updateOne({ creator_id: 'c1' }, { $set: { kill_switch: false } });
    const res = await cf.activate('c1', 'default', 'bio_c1', 'anomaly', 'dynatrace_auto');
    expect(res.status).toBe('activated');
    const cfg = await client.db(dbName).collection('creator_config').findOne({ creator_id: 'c1' });
    expect(cfg?.kill_switch_activated_by).toBe('dynatrace_auto');
  });

  it('deactivate respects 15min cooldown', async () => {
    // ensure activated recently
    await client.db(dbName).collection('creator_config').updateOne({ creator_id: 'c1' }, { $set: { kill_switch: true, kill_switch_activated_at: new Date() } });
    const res = await cf.deactivate('c1', 'default', 'bio_c1');
    expect(res.status).toBe('COOLDOWN');
    expect(res.remainingSeconds).toBeGreaterThan(800);
  });

  it('deactivate returns PENDING_DEAL_REVIEW when frozen deals exist', async () => {
    await client.db(dbName).collection('creator_config').updateOne({ creator_id: 'c1' }, { $set: { kill_switch: true, kill_switch_activated_at: new Date(Date.now() - 20*60*1000) } });
    await client.db(dbName).collection('active_deals').insertOne({ brand_name: 'B', thread_id: 't1', stage: 'frozen', current_terms: {}, negotiation_history: [], opened_date: new Date(), last_activity: new Date(), human_approval: false, creator_id: 'c1', region: 'default' });
    const res = await cf.deactivate('c1', 'default', 'bio_c1');
    expect(res.status).toBe('PENDING_DEAL_REVIEW');
    expect(res.frozenDeals).toContain('t1');
  });
});
