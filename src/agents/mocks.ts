import * as crypto from 'crypto';
import type { KeyObject } from 'crypto';

// Mock Gemini extractor using the exact prompt style from architecture
export class MockGeminiExtractor {
  async extract(content: string, platform: string, creatorName: string): Promise<any> {
    // Simulate structured JSON from prompt
    const topics = ['ai', 'ethics'];
    const opinions = [
      { topic: 'ai', position: 'AI should be transparent and accountable.', strength: 0.85, confidence: 0.9 },
      { topic: 'ethics', position: 'Regulation is necessary for responsible AI.', strength: 0.7, confidence: 0.8 }
    ];
    const emotional_state = content.includes('angry') ? 'angry' : 'reflective';
    const vocabulary_signatures = ['absolutely', 'game changer', 'in my view'];
    return { topics, opinions, emotional_state, vocabulary_signatures };
  }
}

export class MockEmbedder {
  async embed(text: string): Promise<number[]> {
    // Return deterministic 768-dim vector for testability (simulates text-embedding-004)
    const vec = new Array(768).fill(0);
    for (let i = 0; i < text.length && i < 768; i++) {
      vec[i] = (text.charCodeAt(i) % 100) / 100;
    }
    return vec;
  }
}

export class MockGitLabCommitter {
  async commit(repo: string, message: string, files: any[]): Promise<{commit_sha: string}> {
    // Accept previous + collab, negotiation etc per spec
    const valid = ['ingested_', 'oracle_cycle_', 'published_', 'hunter_', 'pitched_', 'negotiation_round_', 'negotiation_escalated_', 'deal_closed_', 'deal_prepared_', 'collab_proposed_', 'collab_agreed_', 'kill_switch_activated_', 'kill_switch_deactivated_'];
    if (!valid.some(p => message.startsWith(p))) {
      throw new Error('Invalid commit naming');
    }
    return { commit_sha: 'sha-' + Date.now() };
  }
}

export class MockElasticTrending {
  async getTrendingTopics(creatorId: string, limit = 50): Promise<string[]> {
    // Simulate search on world_events_stream
    const topics: string[] = [];
    for (let i = 1; i <= limit; i++) {
      topics.push(`trending_topic_${i}`);
    }
    return topics;
  }
}

export interface OraclePrediction {
  topic: string;
  predicted_position: string;
  confidence: number;
  reasoning: string;
  suggested_post_text: string;
  suggested_platform: string;
  risk_flags: string[];
}

export class MockOracleGemini {
  async predictBatch(creatorId: string, topics: string[], adjacentOpinions: any[] = []): Promise<OraclePrediction[]> {
    // ONE batched call for up to 50 topics
    return topics.slice(0, 50).map((topic, idx) => ({
      topic,
      predicted_position: `Predicted stance on ${topic} based on personality graph.`,
      confidence: idx % 3 === 0 ? 0.82 : (idx % 3 === 1 ? 0.62 : 0.35),
      reasoning: 'Batch reasoning from single Gemini call.',
      suggested_post_text: `As an AI, I think about ${topic}...`,
      suggested_platform: 'twitter',
      risk_flags: []
    }));
  }
}

export class MockArize {
  async logPrediction(creatorId: string, predictionId: string, predicted: string, actual: string | null, accuracy: number | null): Promise<{logged: boolean}> {
    return { logged: true };
  }

  async checkPolicy(creatorId: string, content: string, policyRules: {r1?: boolean, r3?: boolean}): Promise<{pass: boolean, violations: string[]}> {
    // Simulate R1 (never deny AI) and R3 (no contradictions)
    const violations: string[] = [];
    if (policyRules.r1 && content.toLowerCase().includes('i am human')) {
      violations.push('R1 violation: claims to be human');
    }
    if (policyRules.r3 && content.includes('contradict previous')) {
      violations.push('R3 violation: contradicts public position');
    }
    return { pass: violations.length === 0, violations };
  }

  async checkBounds(creatorId: string, emailText: string, negotiationProfile: any): Promise<{within_bounds: boolean, violations: string[]}> {
    // Simulate Arize bounds check for pitcher email
    const violations: string[] = [];
    if (emailText.length > 1000) violations.push('too long');
    return { within_bounds: violations.length === 0, violations };
  }
}

export class MockPubSub {
  published: any[] = [];
  pending: any[] = [];
  async publish(topic: string, message: any): Promise<void> {
    this.published.push({ topic, message });
    this.pending.push({ topic, message, creator_id: message.creator_id || message.creatorId });
  }
  nackForCreator(creatorId: string): any[] {
    const nacked = this.pending.filter((p: any) => p.creator_id === creatorId);
    this.pending = this.pending.filter((p: any) => p.creator_id !== creatorId);
    return nacked;
  }
}

export class MockContentGemini {
  async refinePost(originalText: string, vocabularySignatures: string[], emotionalState: string): Promise<string> {
    // Simulate voice refinement using vocab
    const sig = vocabularySignatures[0] || 'in my view';
    return `${originalText} ${sig}. This reflects ${emotionalState} tone.`;
  }
}

export class MockFivetranPublisher {
  published: any[] = [];
  async publishPost(params: {platform: string, text: string, creator_id: string}): Promise<{status: string}> {
    // Simulate publish via Fivetran MCP only (no direct API)
    this.published.push(params);
    return { status: 'published' };
  }
}

export interface ContentPrediction {
  _id?: any;
  topic: string;
  suggested_post_text: string;
  suggested_platform: string;
  creator_id: string;
  region?: string;
  posted?: boolean;
}

export class MockElasticBrands {
  async searchBrands(creatorId: string, niche?: string): Promise<any[]> {
    return [
      { brand_name: 'BrandX', audience_overlap: 0.45, brand_sentiment: 0.8, niche_tags: ['tech'] },
      { brand_name: 'BrandY', audience_overlap: 0.25, brand_sentiment: 0.9, niche_tags: ['tech'] }
    ];
  }
}

export class MockHunterGemini {
  async scoreBrandFit(brand: any, personalityGraph: any): Promise<{fit_score: number, compatible: boolean}> {
    return { fit_score: brand.audience_overlap, compatible: brand.brand_sentiment > 0.5 };
  }
}

export class MockPitcherGemini {
  async writeColdEmail(vocabularySignatures: string[], brandName: string, rateMultiplier: number): Promise<string> {
    const sig = vocabularySignatures[0] || 'in my view';
    return `Hi ${brandName}, ${sig}. Let's collab at ${rateMultiplier}x rate.`;
  }
}

export class MockNegotiatorGemini {
  async parseReply(emailBody: string): Promise<{counter_offer: any, terms: any, sentiment: string}> {
    return { counter_offer: { amount: 1000 }, terms: {}, sentiment: 'positive' };
  }
  async generateCounter(currentTerms: any, reply: any, profile: any): Promise<string> {
    return 'Counter offer text with concessions.';
  }
}

export class MockCloserGemini {
  async fillContract(deal: any, template: string): Promise<string> {
    return `Contract for ${deal.brand_name} at rate ${deal.current_terms?.rate || 1000}`;
  }
}

export class MockSecretManager {
  private keys: Map<string, {publicKey: KeyObject, privateKey: KeyObject}> = new Map();

  generateKeypair(creatorId: string): {publicKey: KeyObject, privateKey: KeyObject} {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    this.keys.set(creatorId, {publicKey, privateKey});
    return {publicKey, privateKey};
  }

  getKeypair(creatorId: string): {publicKey: KeyObject, privateKey: KeyObject} | null {
    if (!this.keys.has(creatorId)) {
      return this.generateKeypair(creatorId);
    }
    return this.keys.get(creatorId)!;
  }
}

export class MockElasticNetwork {
  network: any[] = [];
  messages: any[] = [];

  async publishPresence(presence: any): Promise<void> {
    this.network = this.network.filter(p => p.agent_id !== presence.agent_id);
    this.network.push(presence);
  }

  async queryNetwork(filter: any): Promise<any[]> {
    // Simplified: return matching from published, assume overlap >55% for test candidates
    return this.network.filter(p => (p.collab_openness || 0.7) > 0.60 && !p.blocked).slice(0, 3);
  }

  async indexMessage(msg: any): Promise<void> {
    this.messages.push(msg);
  }

  async queryMessages(to: string, since?: Date): Promise<any[]> {
    return this.messages.filter(m => m.to === to && (!since || new Date(m.timestamp) > since));
  }
}

export class MockGeminiCollaboration {
  async generateProposal(candidate: any, creatorProfile: any): Promise<any> {
    return {
      format: 'collab_post',
      topic: 'AI ethics cross-promotion',
      platform: 'twitter',
      revenue_split: 0.5,
      timeline: '2 weeks'
    };
  }
}

export class MockFivetranGmail {
  sent: any[] = [];
  replies: any[] = [];
  async sendEmail(params: {to: string, subject: string, body: string, creator_id: string}): Promise<{status: string}> {
    this.sent.push(params);
    return { status: 'sent' };
  }
  async checkReplies(creatorId: string): Promise<any[]> {
    // Simulate polling Gmail replies via Fivetran
    return this.replies.filter(r => r.creator_id === creatorId);
  }
  addReply(reply: any) {
    this.replies.push(reply);
  }
}

// ===== Kill Switch Phase 8 mocks =====

export class MockRedis {
  store = new Map<string, {val: string; exp: number}>();
  async get(key: string): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() > e.exp) { this.store.delete(key); return null; }
    return e.val;
  }
  async set(key: string, val: string, ttlSec = 5): Promise<void> {
    this.store.set(key, {val, exp: Date.now() + ttlSec*1000});
  }
  async setEx(key: string, ttlSec: number, val: string): Promise<void> { return this.set(key, val, ttlSec); }
  async del(key: string): Promise<void> { this.store.delete(key); }
  async publish(channel: string, msg: string): Promise<void> {
    // no-op in base; tests can spy or use bus
  }
}

export class MockKillSwitchBus {
  listeners = new Map<string, Array<(sig: any)=>void>>();
  on(creatorId: string, fn: (sig: any)=>void) {
    if (!this.listeners.has(creatorId)) this.listeners.set(creatorId, []);
    this.listeners.get(creatorId)!.push(fn);
  }
  emit(creatorId: string, sig: any) {
    (this.listeners.get(creatorId) || []).forEach(fn => fn(sig));
  }
  clear() { this.listeners.clear(); }
}

export class MockFirebase {
  pushes: any[] = [];
  authTokens: Map<string, string> = new Map(); // for test setup: set creatorId -> token
  async sendPush(creatorId: string, payload: any): Promise<void> {
    this.pushes.push({ creatorId, payload });
  }
  // Biometric verify mock (Phase 8)
  async verifyIdToken(token: string): Promise<{uid: string}> {
    // In tests, pre-seed authTokens with 'valid-token-for-c1' etc, or default allow if token matches pattern
    for (const [uid, t] of this.authTokens) {
      if (t === token) return { uid };
    }
    // fallback permissive for simple tests: if token looks like "bio_<creator>", accept
    if (token && token.startsWith('bio_')) {
      return { uid: token.slice(4) };
    }
    throw new Error('Biometric verification failed');
  }
  setAuthToken(creatorId: string, token: string) {
    this.authTokens.set(creatorId, token);
  }
}

export class MockDynatrace {
  events: any[] = [];
  frozenCreators = new Set<string>();
  async create_event(args: any) {
    this.events.push(args);
    if (args && /frozen|kill/i.test(args.title || args.event_type || '')) {
      if (args.creator_id) this.frozenCreators.add(args.creator_id);
    }
    return { event_id: 'evt-' + Date.now() };
  }
  async push_metric(args: any) { return {accepted: true}; }
  isFrozen(creatorId: string) { return this.frozenCreators.has(creatorId); }
  reset() { this.frozenCreators.clear(); this.events.length=0; }
}

// Extend gitlab valid prefixes for kill switch commits (used by MockGitLabCommitter)
export const KILL_GITLAB_PREFIXES = ['kill_switch_activated_', 'kill_switch_deactivated_'];
