import { jest } from '@jest/globals';
import { KillSwitchBroadcaster } from '../../src/workers/kill-switch-broadcaster.js';
import { MongoClient } from 'mongodb';

jest.setTimeout(15000);

describe('KillSwitchBroadcaster (change stream + 5s Redis key + bus)', () => {
  let client: MongoClient;
  let bc: KillSwitchBroadcaster;
  const dbName = 'echomind_bcast_' + Date.now();

  beforeAll(async () => {
    client = new MongoClient('mongodb://localhost:27017');
    await client.connect();
    await client.db(dbName).collection('creator_config').deleteMany({});
    await client.db(dbName).collection('creator_config').insertOne({ creator_id: 'c2', region: 'default', kill_switch: false, playbook_rules: {}, api_credentials_ref: 'r', notification_preferences: {email:true,sms:false,push:true}, created_at: new Date(), updated_at: new Date() });
  });

  afterAll(async () => {
    await client.db(dbName).dropDatabase().catch(() => {});
    await client.close();
  });

  it('simulateChange publishes to redis key (5s) and bus', async () => {
    bc = new KillSwitchBroadcaster({ mongoUri: 'mongodb://localhost:27017', dbName });
    await bc.connect();
    await bc.start();

    let received: any = null;
    bc.getBus().on('c2', (sig) => { received = sig; });

    await bc.simulateChange({ creator_id: 'c2', kill_switch: true });

    const key = await bc.getRedis().get('echomind:kill_switch_state:c2');
    expect(key).toBe('frozen');
    expect(received).toBeTruthy();
    expect(received.kill_switch).toBe(true);

    await bc.close();
  });
});
