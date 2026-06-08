import { jest } from '@jest/globals';
import { MongoClient } from 'mongodb';
import { KillSwitchChecker } from '../../src/utils/kill-switch-checker.js';

jest.setTimeout(15000);

describe('KillSwitchChecker (5s TTL + fail-safe)', () => {
  let client: MongoClient;
  let checker: KillSwitchChecker;
  const dbName = 'echomind_test_' + Date.now();

  beforeAll(async () => {
    client = new MongoClient('mongodb://localhost:27017');
    await client.connect();
    // ensure a doc
    const col = client.db(dbName).collection('creator_config');
    await col.deleteMany({});
    await col.insertOne({ creator_id: 'c1', region: 'default', kill_switch: false, playbook_rules: {}, api_credentials_ref: 'ref', notification_preferences: {email:true,sms:false,push:true}, created_at: new Date(), updated_at: new Date() });
  });

  afterAll(async () => {
    await client.db(dbName).dropDatabase().catch(() => {});
    await client.close();
  });

  beforeEach(() => {
    checker = new KillSwitchChecker(client, dbName);
    checker.clearCache();
  });

  it('returns false when kill_switch false, caches for ~5s', async () => {
    const v1 = await checker.isActive('c1');
    expect(v1).toBe(false);
    // set true directly in mongo
    await client.db(dbName).collection('creator_config').updateOne({ creator_id: 'c1' }, { $set: { kill_switch: true } });
    // still cached false
    const v2 = await checker.isActive('c1');
    expect(v2).toBe(false);
    // invalidate forces re-read
    checker.invalidate('c1');
    const v3 = await checker.isActive('c1');
    expect(v3).toBe(true);
  });

  it('fail-safe returns true (STOP) on mongo error', async () => {
    const badClient = new MongoClient('mongodb://127.0.0.1:1'); // unreachable
    const badChecker = new KillSwitchChecker(badClient, dbName);
    const v = await badChecker.isActive('nope');
    expect(v).toBe(true);
    await badClient.close().catch(() => {});
  });

  it('setForTest overrides for fast tests', async () => {
    checker.setForTest('c1', 'default', true);
    expect(await checker.isActive('c1')).toBe(true);
  });
});
