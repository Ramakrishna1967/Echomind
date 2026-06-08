import { MongoClient, Db, CreateCollectionOptions, IndexDescription } from 'mongodb';

export const DATABASE_NAME = 'echomind';

export const COLLECTIONS = [
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
] as const;

export type CollectionName = typeof COLLECTIONS[number];

export const SHARD_KEY = { region: 1, creator_id: 'hashed' } as const;

export interface CollectionDef {
  name: CollectionName;
  validator: CreateCollectionOptions;
  indexes: IndexDescription[];
}

export const collectionDefs: CollectionDef[] = [
  {
    name: 'raw_content',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['doc_id', 'creator_id', 'platform', 'content', 'timestamp', 'topic_tags', 'sentiment_score', 'opinion_strength', 'emotional_state', 'word_count', 'engagement_signals', 'raw_url', 'processing_status', 'region'],
          properties: {
            doc_id: { bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' },
            creator_id: { bsonType: 'string', minLength: 1 },
            platform: { bsonType: 'string', enum: ['youtube', 'twitter', 'twitch', 'reddit', 'discord', 'patreon', 'email'] },
            content: { bsonType: 'string', minLength: 1, maxLength: 1048576 },
            timestamp: { bsonType: 'date' },
            topic_tags: { bsonType: 'array', items: { bsonType: 'string', minLength: 1, maxLength: 128 } },
            sentiment_score: { bsonType: 'double', minimum: -1.0, maximum: 1.0 },
            opinion_strength: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            emotional_state: { bsonType: 'string', enum: ['neutral', 'excited', 'angry', 'reflective', 'humorous', 'defensive'] },
            word_count: { bsonType: 'int', minimum: 0 },
            engagement_signals: {
              bsonType: 'object',
              required: ['likes', 'replies', 'shares', 'views'],
              properties: {
                likes: { bsonType: 'int', minimum: 0 },
                replies: { bsonType: 'int', minimum: 0 },
                shares: { bsonType: 'int', minimum: 0 },
                views: { bsonType: 'int', minimum: 0 }
              },
              additionalProperties: false
            },
            raw_url: { bsonType: 'string', minLength: 1 },
            processing_status: { bsonType: 'string', enum: ['raw', 'processed', 'graphed'] },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, platform: 1, timestamp: -1 }, name: 'idx_creator_platform_time' },
      { key: { creator_id: 1, processing_status: 1 }, name: 'idx_creator_status' },
      { key: { creator_id: 1, emotional_state: 1, timestamp: -1 }, name: 'idx_creator_emotion_time' },
      { key: { doc_id: 1 }, name: 'idx_doc_id', unique: true },
      { key: { timestamp: 1 }, name: 'idx_ttl_cold_storage', expireAfterSeconds: 31536000 },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'opinions',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['topic', 'position', 'strength', 'confidence', 'date', 'platform_origin', 'source_doc_ids', 'evolution_generation', 'embedding', 'creator_id', 'region'],
          properties: {
            topic: { bsonType: 'string', minLength: 1, maxLength: 512 },
            position: { bsonType: 'string', minLength: 1, maxLength: 4096 },
            strength: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            confidence: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            date: { bsonType: 'date' },
            platform_origin: { bsonType: 'string', minLength: 1 },
            source_doc_ids: { bsonType: 'array', minItems: 1, items: { bsonType: 'string' } },
            evolution_generation: { bsonType: 'int', minimum: 0 },
            embedding: { bsonType: 'binData' },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, topic: 1, date: -1 }, name: 'idx_creator_topic_date' },
      { key: { creator_id: 1, topic: 1, evolution_generation: 1 }, name: 'idx_creator_topic_evolution' },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'emotions',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['trigger', 'response_type', 'intensity', 'frequency', 'last_seen', 'context_tags', 'creator_id', 'region'],
          properties: {
            trigger: { bsonType: 'string', minLength: 1, maxLength: 512 },
            response_type: { bsonType: 'string', minLength: 1, maxLength: 128 },
            intensity: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            frequency: { bsonType: 'int', minimum: 1 },
            last_seen: { bsonType: 'date' },
            context_tags: { bsonType: 'array', items: { bsonType: 'string' } },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, last_seen: -1 }, name: 'idx_creator_last_seen' },
      { key: { creator_id: 1, trigger: 1 }, name: 'idx_creator_trigger' },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'vocabulary',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['word', 'frequency', 'context', 'platform', 'sentiment_association', 'uniqueness_score', 'signature_phrase', 'embedding', 'creator_id', 'region'],
          properties: {
            word: { bsonType: 'string', minLength: 1, maxLength: 256 },
            frequency: { bsonType: 'int', minimum: 1 },
            context: { bsonType: 'string', minLength: 1, maxLength: 2048 },
            platform: { bsonType: 'string', minLength: 1 },
            sentiment_association: { bsonType: 'double', minimum: -1.0, maximum: 1.0 },
            uniqueness_score: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            signature_phrase: { bsonType: 'bool' },
            embedding: { bsonType: 'binData' },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, signature_phrase: 1, frequency: -1 }, name: 'idx_creator_signature_freq' },
      { key: { creator_id: 1, platform: 1 }, name: 'idx_creator_platform' },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'relationships',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['entity', 'entity_type', 'sentiment', 'interaction_count', 'history_summary', 'last_interaction', 'creator_id', 'region'],
          properties: {
            entity: { bsonType: 'string', minLength: 1, maxLength: 512 },
            entity_type: { bsonType: 'string', enum: ['person', 'brand', 'topic', 'platform'] },
            sentiment: { bsonType: 'double', minimum: -1.0, maximum: 1.0 },
            interaction_count: { bsonType: 'int', minimum: 0 },
            history_summary: { bsonType: 'string', maxLength: 8192 },
            last_interaction: { bsonType: 'date' },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, entity_type: 1, sentiment: -1 }, name: 'idx_creator_type_sentiment' },
      { key: { creator_id: 1, entity: 1 }, name: 'idx_creator_entity', unique: true },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'negotiation_profiles',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['deal_type', 'opening_ask_multiplier', 'average_final_close', 'concession_rate', 'rounds_to_close', 'tactics', 'red_lines', 'preferred_deal_structures', 'creator_id', 'region'],
          properties: {
            deal_type: { bsonType: 'string', minLength: 1, maxLength: 128 },
            opening_ask_multiplier: { bsonType: 'double', minimum: 0.0 },
            average_final_close: { bsonType: 'double', minimum: 0.0 },
            concession_rate: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            rounds_to_close: { bsonType: 'double', minimum: 0.0 },
            tactics: { bsonType: 'array', items: { bsonType: 'string' } },
            red_lines: { bsonType: 'array', items: { bsonType: 'string' } },
            preferred_deal_structures: { bsonType: 'array', items: { bsonType: 'string' } },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, deal_type: 1 }, name: 'idx_creator_deal_type', unique: true },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'predicted_opinions',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['topic', 'predicted_position', 'confidence', 'predicted_statement_date', 'posted', 'approved', 'creator_id', 'region'],
          properties: {
            topic: { bsonType: 'string', minLength: 1, maxLength: 512 },
            predicted_position: { bsonType: 'string', minLength: 1, maxLength: 4096 },
            confidence: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            predicted_statement_date: { bsonType: 'date' },
            actual_position: { bsonType: ['string', 'null'], maxLength: 4096 },
            actual_date: { bsonType: ['date', 'null'] },
            accuracy_score: { bsonType: ['double', 'null'], minimum: 0.0, maximum: 1.0 },
            posted: { bsonType: 'bool' },
            approved: { bsonType: 'bool' },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, predicted_statement_date: -1 }, name: 'idx_creator_predicted_date' },
      { key: { creator_id: 1, accuracy_score: 1 }, name: 'idx_creator_accuracy', partialFilterExpression: { accuracy_score: { $ne: null } } },
      { key: { creator_id: 1, approved: 1, posted: 1 }, name: 'idx_creator_approval_queue' },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'agent_interactions',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['counterpart_agent_id', 'interaction_type', 'outcome', 'rounds', 'timestamp', 'proposal_json', 'creator_id', 'region'],
          properties: {
            counterpart_agent_id: { bsonType: 'string', minLength: 1 },
            interaction_type: { bsonType: 'string', enum: ['collab', 'compete', 'deal'] },
            outcome: { bsonType: 'string', minLength: 1, maxLength: 2048 },
            rounds: { bsonType: 'int', minimum: 1 },
            timestamp: { bsonType: 'date' },
            proposal_json: { bsonType: 'object' },
            final_terms: { bsonType: ['object', 'null'] },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, counterpart_agent_id: 1, timestamp: -1 }, name: 'idx_creator_counterpart_time' },
      { key: { creator_id: 1, interaction_type: 1, timestamp: -1 }, name: 'idx_creator_type_time' },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'active_deals',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['brand_name', 'thread_id', 'stage', 'current_terms', 'negotiation_history', 'opened_date', 'last_activity', 'human_approval', 'creator_id', 'region'],
          properties: {
            brand_name: { bsonType: 'string', minLength: 1, maxLength: 256 },
            thread_id: { bsonType: 'string', minLength: 1 },
            stage: { bsonType: 'string', enum: ['pitched', 'negotiating', 'closing', 'closed', 'dead', 'frozen'] },
            current_terms: { bsonType: 'object' },
            negotiation_history: {
              bsonType: 'array',
              items: {
                bsonType: 'object',
                required: ['round', 'proposed_by', 'terms', 'timestamp'],
                properties: {
                  round: { bsonType: 'int', minimum: 1 },
                  proposed_by: { bsonType: 'string', minLength: 1 },
                  terms: { bsonType: 'object' },
                  timestamp: { bsonType: 'date' }
                }
              }
            },
            opened_date: { bsonType: 'date' },
            last_activity: { bsonType: 'date' },
            human_approval: { bsonType: 'bool' },
            contract_draft_url: { bsonType: ['string', 'null'] },
            previous_stage: { bsonType: ['string', 'null'] },
            frozen_reason: { bsonType: ['string', 'null'] },
            frozen_at: { bsonType: ['date', 'null'] },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, stage: 1, last_activity: -1 }, name: 'idx_creator_stage_activity' },
      { key: { last_activity: 1 }, name: 'idx_stale_deal_detection' },
      { key: { creator_id: 1, brand_name: 1 }, name: 'idx_creator_brand' },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'brand_targets',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['brand_name', 'fit_score', 'audience_overlap', 'niche_tags', 'status', 'creator_id', 'region'],
          properties: {
            brand_name: { bsonType: 'string', minLength: 1, maxLength: 256 },
            fit_score: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            audience_overlap: { bsonType: 'double', minimum: 0.0, maximum: 1.0 },
            niche_tags: { bsonType: 'array', minItems: 1, items: { bsonType: 'string' } },
            status: { bsonType: 'string', enum: ['identified', 'pitched', 'rejected'] },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, status: 1, fit_score: -1 }, name: 'idx_creator_status_fit' },
      { key: { creator_id: 1, brand_name: 1 }, name: 'idx_creator_brand_target' },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'creator_config',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['creator_id', 'kill_switch', 'playbook_rules', 'api_credentials_ref', 'notification_preferences', 'created_at', 'updated_at', 'region'],
          properties: {
            creator_id: { bsonType: 'string', minLength: 1 },
            kill_switch: { bsonType: 'bool' },
            kill_switch_activated_at: { bsonType: ['date', 'null'] },
            kill_switch_reason: { bsonType: ['string', 'null'] },
            kill_switch_activated_by: { bsonType: ['string', 'null'] },
            playbook_rules: { bsonType: 'object' },
            api_credentials_ref: { bsonType: 'string', minLength: 1 },
            notification_preferences: {
              bsonType: 'object',
              required: ['email', 'sms', 'push'],
              properties: {
                email: { bsonType: 'bool' },
                sms: { bsonType: 'bool' },
                push: { bsonType: 'bool' },
                webhook_url: { bsonType: ['string', 'null'] },
                escalation_threshold: { bsonType: 'double', minimum: 0.0, maximum: 1.0 }
              }
            },
            created_at: { bsonType: 'date' },
            updated_at: { bsonType: 'date' },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1 }, name: 'idx_creator_id', unique: true },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  },
  {
    name: 'dead_letter_queue',
    validator: {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['operation_type', 'payload', 'error', 'retry_count', 'created_at', 'creator_id', 'region'],
          properties: {
            operation_type: { bsonType: 'string', minLength: 1, maxLength: 128 },
            payload: { bsonType: 'object' },
            error: { bsonType: 'string', minLength: 1, maxLength: 8192 },
            retry_count: { bsonType: 'int', minimum: 0 },
            created_at: { bsonType: 'date' },
            creator_id: { bsonType: 'string', minLength: 1 },
            region: { bsonType: 'string', minLength: 1 }
          },
          additionalProperties: false
        }
      },
      validationLevel: 'strict',
      validationAction: 'error'
    },
    indexes: [
      { key: { creator_id: 1, created_at: -1 }, name: 'idx_creator_created' },
      { key: { created_at: 1 }, name: 'idx_ttl_dlq', expireAfterSeconds: 2592000 },
      { key: { region: 1, creator_id: 1 }, name: 'idx_region_creator' }
    ]
  }
];
