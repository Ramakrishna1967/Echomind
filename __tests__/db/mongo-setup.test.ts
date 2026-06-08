import { collectionDefs, COLLECTIONS, SHARD_KEY, DATABASE_NAME } from '../../src/db/collection-defs.js';

describe('MongoDB 12 collections setup', () => {
  it('defines exactly 12 collections', () => {
    expect(COLLECTIONS).toHaveLength(12);
    expect(collectionDefs).toHaveLength(12);
  });

  it('every collection has strict validator and error action', () => {
    for (const def of collectionDefs) {
      expect(def.validator.validationLevel).toBe('strict');
      expect(def.validator.validationAction).toBe('error');
      expect(def.validator.validator?.$jsonSchema).toBeDefined();
    }
  });

  it('shard key is exactly {region:1, creator_id:"hashed"} for all', () => {
    expect(SHARD_KEY).toEqual({ region: 1, creator_id: 'hashed' });
  });

  it('every collection schema requires creator_id and region', () => {
    for (const def of collectionDefs) {
      const required = (def.validator.validator?.$jsonSchema as any)?.required || [];
      expect(required).toContain('creator_id');
      expect(required).toContain('region');
    }
  });

  it('lists all expected collection names from AGENTS.md', () => {
    const names = collectionDefs.map(d => d.name);
    expect(names).toEqual([
      'raw_content',
      'opinions',
      'emotions',
      'vocabulary',
      'relationships',
      'negotiation_profiles',
      'predicted_opinions',
      'agent_interactions',
      'active_deals',
      'brand_targets',
      'creator_config',
      'dead_letter_queue'
    ]);
  });

  it('creator_config has unique index on creator_id', () => {
    const cfg = collectionDefs.find(d => d.name === 'creator_config')!;
    const uniqueIdx = cfg.indexes.find(i => (i as any).unique && (i.key as any).creator_id === 1);
    expect(uniqueIdx).toBeDefined();
  });

  it('active_deals stage enum includes "frozen" for kill switch', () => {
    const deals = collectionDefs.find(d => d.name === 'active_deals')!;
    const stageProp = (deals.validator.validator?.$jsonSchema as any)?.properties?.stage;
    expect(stageProp?.enum).toContain('frozen');
  });

  it('creator_config has kill_switch audit fields (activated_at, reason, activated_by)', () => {
    const cfg = collectionDefs.find(d => d.name === 'creator_config')!;
    const props = (cfg.validator.validator?.$jsonSchema as any)?.properties || {};
    expect(props.kill_switch_activated_at).toBeDefined();
    expect(props.kill_switch_reason).toBeDefined();
    expect(props.kill_switch_activated_by).toBeDefined();
  });

  it('active_deals has previous_stage, frozen_reason, frozen_at for kill/resume', () => {
    const deals = collectionDefs.find(d => d.name === 'active_deals')!;
    const props = (deals.validator.validator?.$jsonSchema as any)?.properties || {};
    expect(props.previous_stage).toBeDefined();
    expect(props.frozen_reason).toBeDefined();
    expect(props.frozen_at).toBeDefined();
  });

  it('dead_letter_queue has 30-day TTL on created_at', () => {
    const dlq = collectionDefs.find(d => d.name === 'dead_letter_queue')!;
    const ttl = dlq.indexes.find(i => (i as any).expireAfterSeconds === 2592000);
    expect(ttl).toBeDefined();
  });

  it('raw_content has 1-year TTL and doc_id unique index', () => {
    const raw = collectionDefs.find(d => d.name === 'raw_content')!;
    expect(raw.indexes.some(i => (i as any).expireAfterSeconds === 31536000)).toBe(true);
    expect(raw.indexes.some(i => (i as any).unique && (i.key as any).doc_id === 1)).toBe(true);
  });

  it('all indexes include region+creator_id compound for sharding locality', () => {
    for (const def of collectionDefs) {
      const hasRegionCreator = def.indexes.some(i => {
        const k = i.key as any;
        return k.region === 1 && k.creator_id === 1;
      });
      expect(hasRegionCreator).toBe(true);
    }
  });
});
