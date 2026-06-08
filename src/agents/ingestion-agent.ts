import { MongoClient, ChangeStreamDocument, ObjectId } from 'mongodb';
import { withRetry } from '../utils/retry.js';
import { KillSwitchChecker } from '../utils/kill-switch-checker.js';

export interface ExtractedData {
  topics: string[];
  opinions: Array<{ topic: string; position: string; strength: number; confidence: number }>;
  emotional_state: string;
  vocabulary_signatures: string[];
}

export interface GeminiExtractor {
  extract(content: string, platform: string, creatorName: string): Promise<ExtractedData>;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
}

export interface GitLabCommitter {
  commit(repo: string, message: string, files: Array<{path: string; content: string}>): Promise<{commit_sha: string}>;
}

export interface IngestionAgentOptions {
  mongoUri?: string;
  dbName?: string;
  gemini: GeminiExtractor;
  embedder: Embedder;
  gitlab: GitLabCommitter;
  creatorName?: string;
  repo?: string;
  killSwitchChecker?: KillSwitchChecker;
}

export class IngestionAgent {
  private client: MongoClient;
  private dbName: string;
  private gemini: GeminiExtractor;
  private embedder: Embedder;
  private gitlab: GitLabCommitter;
  private creatorName: string;
  private repo: string;
  private killSwitchChecker?: KillSwitchChecker;

  constructor(opts: IngestionAgentOptions) {
    this.client = new MongoClient(opts.mongoUri || process.env.MONGODB_URI || 'mongodb://localhost:27017');
    this.dbName = opts.dbName || 'echomind';
    this.gemini = opts.gemini;
    this.embedder = opts.embedder;
    this.gitlab = opts.gitlab;
    this.creatorName = opts.creatorName || 'Creator';
    this.repo = opts.repo || 'echomind-sovereign';
    this.killSwitchChecker = opts.killSwitchChecker;
  }

  async start(): Promise<void> {
    await this.client.connect();
    const db = this.client.db(this.dbName);
    const rawContent = db.collection('raw_content');

    const pipeline = [
      { $match: { 'fullDocument.processing_status': 'raw' } }
    ];

    const changeStream = rawContent.watch(pipeline, { fullDocument: 'updateLookup' });

    changeStream.on('change', async (change: ChangeStreamDocument<any>) => {
      if (change.operationType === 'insert' || change.operationType === 'update') {
        const doc = change.fullDocument;
        if (doc && doc.processing_status === 'raw') {
          await this.processDocument(doc);
        }
      }
    });

    // keep alive
    process.on('SIGINT', async () => {
      await changeStream.close();
      await this.client.close();
      process.exit(0);
    });
  }

  async processDocument(doc: any): Promise<void> {
    const start = Date.now();
    const db = this.client.db(this.dbName);
    const rawCol = db.collection('raw_content');
    const opinionsCol = db.collection('opinions');
    const emotionsCol = db.collection('emotions');
    const vocabCol = db.collection('vocabulary');
    const relsCol = db.collection('relationships');

    const { doc_id, creator_id, platform, content, region = 'default' } = doc;

    // Kill switch check FIRST on every doc (per AGENTS + Phase 8)
    if (this.killSwitchChecker) {
      if (await this.killSwitchChecker.isActive(creator_id, region)) {
        return; // abort, leave as raw per spec
      }
    }

    try {
      // 1. Extract via Gemini (use exact prompt style from spec)
      const extracted = await withRetry(
        () => this.gemini.extract(content, platform, this.creatorName),
        'ingestion-agent',
        'gemini_extract',
        { doc_id },
        { maxAttempts: 3, baseDelayMs: 50 }
      );

      // 2. For each opinion: embed, vector search, route
      for (const op of extracted.opinions) {
        const opinionText = `${op.topic}: ${op.position}`;
        const embedding = await withRetry(
          () => this.embedder.embed(opinionText),
          'ingestion-agent',
          'embed',
          { doc_id, topic: op.topic },
          { maxAttempts: 3, baseDelayMs: 50 }
        );

        // Atlas Vector Search top 5
        const similar = await db.collection('opinions').aggregate([
          {
            $vectorSearch: {
              index: 'opinion_vector_index',
              path: 'embedding',
              queryVector: embedding,
              numCandidates: 100,
              limit: 5,
              filter: { creator_id, region }
            }
          },
          { $addFields: { score: { $meta: 'vectorSearchScore' } } }
        ]).toArray();

        let targetOpinionId: any = null;
        let action: string;

        if (similar.length > 0) {
          const top = similar[0];
          const sim = top.score || 0;

          if (sim > 0.85) {
            // merge: update strength, embedding avg, source_doc_ids
            const newStrength = Math.min(1.0, (top.strength + op.strength) / 2);
            const newEmbedding = this.averageEmbedding(top.embedding, embedding);
            await withRetry(
              () => opinionsCol.findOneAndUpdate(
                { _id: top._id, creator_id, region }, // precondition
                {
                  $set: { strength: newStrength, embedding: newEmbedding, date: new Date() },
                  $addToSet: { source_doc_ids: doc_id }
                },
                { returnDocument: 'after' }
              ),
              'ingestion-agent',
              'merge_opinion',
              { doc_id },
              { maxAttempts: 3 }
            );
            targetOpinionId = top._id;
            action = 'merged';
          } else if (sim >= 0.60) {
            // create relationship edge
            await withRetry(
              () => relsCol.insertOne({
                entity: top.topic || op.topic,
                entity_type: 'topic',
                sentiment: (op.strength + (top.strength || 0.5)) / 2,
                interaction_count: 1,
                history_summary: `Related via ingestion of ${doc_id}`,
                last_interaction: new Date(),
                creator_id,
                region,
                source_doc_ids: [doc_id, ...(top.source_doc_ids || [])]
              }),
              'ingestion-agent',
              'create_relationship',
              { doc_id },
              { maxAttempts: 3 }
            );
            // also create new node
            const insertRes = await withRetry(
              () => opinionsCol.insertOne({
                topic: op.topic,
                position: op.position,
                strength: op.strength,
                confidence: op.confidence,
                date: new Date(),
                platform_origin: platform,
                source_doc_ids: [doc_id],
                evolution_generation: 0,
                embedding,
                creator_id,
                region
              }),
              'ingestion-agent',
              'insert_opinion',
              { doc_id },
              { maxAttempts: 3 }
            );
            targetOpinionId = insertRes.insertedId;
            action = 'related';
          } else {
            // new node
            const insertRes = await withRetry(
              () => opinionsCol.insertOne({
                topic: op.topic,
                position: op.position,
                strength: op.strength,
                confidence: op.confidence,
                date: new Date(),
                platform_origin: platform,
                source_doc_ids: [doc_id],
                evolution_generation: 0,
                embedding,
                creator_id,
                region
              }),
              'ingestion-agent',
              'insert_opinion',
              { doc_id },
              { maxAttempts: 3 }
            );
            targetOpinionId = insertRes.insertedId;
            action = 'new';
          }
        } else {
          // no similar, new
          const insertRes = await withRetry(
            () => opinionsCol.insertOne({
              topic: op.topic,
              position: op.position,
              strength: op.strength,
              confidence: op.confidence,
              date: new Date(),
              platform_origin: platform,
              source_doc_ids: [doc_id],
              evolution_generation: 0,
              embedding,
              creator_id,
              region
            }),
            'ingestion-agent',
            'insert_opinion',
            { doc_id },
            { maxAttempts: 3 }
          );
          targetOpinionId = insertRes.insertedId;
          action = 'new';
        }
      }

      // 3. Write emotions
      await withRetry(
        () => emotionsCol.insertOne({
          trigger: `content from ${platform}`,
          response_type: extracted.emotional_state,
          intensity: 0.7,
          frequency: 1,
          last_seen: new Date(),
          context_tags: extracted.topics.slice(0, 3),
          creator_id,
          region
        }),
        'ingestion-agent',
        'insert_emotion',
        { doc_id },
        { maxAttempts: 3 }
      );

      // 4. Write vocabulary signatures
      const vocabEmbeddings = await Promise.all(
        extracted.vocabulary_signatures.map((sig) => this.embedder.embed(sig))
      );
      for (let i = 0; i < extracted.vocabulary_signatures.length; i++) {
        const sig = extracted.vocabulary_signatures[i];
        const emb = vocabEmbeddings[i];
        await withRetry(
          () => vocabCol.updateOne(
            { word: sig, creator_id, region },
            {
              $inc: { frequency: 1 },
              $setOnInsert: {
                context: content.substring(0, 200),
                platform,
                sentiment_association: 0.0,
                uniqueness_score: 0.8,
                signature_phrase: true,
                embedding: emb,
                creator_id,
                region
              }
            },
            { upsert: true }
          ),
          'ingestion-agent',
          'upsert_vocab',
          { doc_id, sig },
          { maxAttempts: 3 }
        );
      }

      // 5. Update raw_content status with precondition (state transition rule)
      await withRetry(
        () => rawCol.findOneAndUpdate(
          { doc_id, processing_status: 'raw', creator_id, region }, // precondition
          { $set: { processing_status: 'processed' } },
          { returnDocument: 'after' }
        ),
        'ingestion-agent',
        'update_raw_status',
        { doc_id },
        { maxAttempts: 3 }
      );

      // 6. GitLab commit
      const commitMsg = `ingested_${platform}_${doc_id}`;
      await withRetry(
        () => this.gitlab.commit(this.repo, commitMsg, []),
        'ingestion-agent',
        'gitlab_commit',
        { doc_id },
        { maxAttempts: 3 }
      );

      const elapsed = Date.now() - start;
      if (elapsed > 6500) {
        console.warn(`Ingestion exceeded 6.5s SLA: ${elapsed}ms for ${doc_id}`);
      }
    } catch (err: any) {
      // On failure, leave as raw for retry, or could dead letter but per spec just log
      console.error(`Ingestion failed for ${doc_id}:`, err.message);
      // Could write to dead_letter_queue here via mongo
      const dlq = db.collection('dead_letter_queue');
      await dlq.insertOne({
        operation_type: 'ingestion',
        payload: { doc_id, creator_id, platform },
        error: err.message,
        retry_count: 0,
        created_at: new Date(),
        creator_id,
        region: doc.region || 'default'
      });
    }
  }

  private averageEmbedding(a: number[], b: number[]): number[] {
    const len = Math.max(a.length, b.length);
    const res = new Array(len);
    for (let i = 0; i < len; i++) {
      res[i] = ((a[i] || 0) + (b[i] || 0)) / 2;
    }
    return res;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
