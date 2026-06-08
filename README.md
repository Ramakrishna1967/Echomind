# EchoMind 

> **The world's first fully autonomous AI creator operating system.**
> Ingests your entire digital existence. Posts as you. Closes brand deals. Negotiates collaborations. While you sleep.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8_strict-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-22-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Gemini](https://img.shields.io/badge/Gemini_3-Google_Cloud-4285F4?style=flat-square&logo=google)](https://cloud.google.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb)](https://www.mongodb.com/atlas)
[![Elastic](https://img.shields.io/badge/Elastic-Cloud-005571?style=flat-square&logo=elasticsearch)](https://www.elastic.co/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)]()

---

## What It Does

| Function | Description |
|---|---|
| **Personality Graph** | Ingests every post, video, comment, email you've ever made. Builds a living computational model of your opinions, voice, and emotional patterns. |
| **Oracle Engine** | Predicts what opinions you'll form — 4 weeks before you form them. Posts content in your exact voice with zero human input. |
| **Sovereign Economy** | Autonomously hunts brands, writes cold emails in your voice, negotiates deals, generates contracts, and closes — end to end. |
| **Multi-Agent Civilization** | Discovers other EchoMind instances. Negotiates collaborations. Competes for audience share. Fully automated. |

**Your only interaction: one daily approve/reject push notification.**

---

## System Architecture

```mermaid
graph TB
    subgraph "Creator Interface"
        HUMAN["Creator (Mobile App)"]
        FCM["Firebase Cloud Messaging"]
    end

    subgraph "Data Ingestion"
        FT["Fivetran MCP\n(Platform API Shield)"]
        YT["YouTube"]
        TW["Twitter/X"]
        TW2["Twitch"]
        RD["Reddit"]
        DC["Discord"]
        PT["Patreon"]
    end

    subgraph "Agent Fleet (Cloud Run concurrency=1)"
        ING["Ingestion Agent\n<6.5s per doc"]
        ORA["Oracle Agent\n<45s / 50 topics"]
        CON["Content Agent"]
        HUN["Hunter Agent"]
        PIT["Pitcher Agent"]
        NEG["Negotiator Agent"]
        CLO["Closer Agent"]
        IAG["Inter-Agent"]
        KSW["Kill Switch\n<7.1s freeze"]
    end

    subgraph "AI Layer"
        GEM["Gemini 3\nGoogle Cloud Agent Builder"]
    end

    subgraph "Persistence"
        MDB["MongoDB Atlas MCP\n12 Collections + Vector Search"]
    end

    subgraph "Search & Messaging"
        ES["Elastic Cloud MCP\nTrending + Inter-Agent Msgs"]
    end

    subgraph "Observability"
        ARIZE["Arize MCP\nDrift + Policy Checks"]
        GL["GitLab MCP\nImmutable Audit Log"]
        DT["Dynatrace MCP\nAnomaly Detection"]
    end

    subgraph "Infrastructure"
        PS["Google Cloud Pub/Sub"]
        SCHED["Cloud Scheduler"]
        SM["Secret Manager + KMS"]
    end

    YT & TW & TW2 & RD & DC & PT --> FT
    FT --> MDB
    MDB -->|"Change Stream"| ING
    ING <--> GEM
    ING --> MDB

    SCHED -->|"6h cron"| PS
    PS --> ORA
    ORA <--> GEM
    ORA <--> MDB
    ORA <--> ES
    ORA -->|">0.75 confidence"| PS
    ORA -->|"0.50-0.75"| FCM

    PS --> CON
    CON <--> GEM
    CON --> ARIZE
    CON --> FT

    SCHED -->|"weekly"| HUN
    HUN <--> ES
    HUN <--> GEM
    HUN --> PS
    PS --> PIT
    PIT <--> GEM
    PIT --> ARIZE
    PIT --> MDB

    SCHED -->|"2h cron"| NEG
    NEG <--> GEM
    NEG <--> MDB
    NEG --> FCM

    NEG -->|"terms agreed"| PS
    PS --> CLO
    CLO <--> GEM
    CLO --> FCM
    HUMAN -->|"[Approve]"| CLO
    CLO --> MDB

    SCHED -->|"12h cron"| IAG
    IAG <--> ES
    IAG <--> GEM
    IAG --> FCM

    HUMAN -->|"Kill Switch tap"| KSW
    DT -->|"Anomaly auto-trigger"| KSW
    KSW --> MDB
    MDB -->|"Change Stream broadcast"| ING & ORA & CON & NEG & IAG

    ING & ORA & CON & HUN & PIT & NEG & CLO & IAG --> GL
    ING & ORA & CON & NEG & CLO --> ARIZE
    ING & ORA & CON & KSW --> DT

    FCM --> HUMAN
```

---

## Ingestion → Personality Graph

```mermaid
flowchart TD
    A["Platform Content\nYouTube / Twitter / Twitch / Reddit / Discord / Patreon"]
    B["Fivetran MCP\ndelta sync + cursor tracking"]
    C[("raw_content\nMongoDB")]
    D["MongoDB Change Stream\n<500ms detection"]
    E["Gemini 3\nExtract: topics, opinions,\nemotions, vocabulary_signatures"]
    F["text-embedding-004\n768d vector"]
    G["Atlas Vector Search\nTop 5 similar nodes"]
    H{Similarity Score}
    I["Merge existing node\nstrengthen weights"]
    J["Create relationship edge\nbetween nodes"]
    K["Create new opinion node"]
    L[("personality_graph\nopinions + emotions +\nvocabulary + relationships")]
    M["GitLab commit\ningested_{platform}_{id}"]

    A --> B --> C --> D --> E --> F --> G --> H
    H -->|"> 0.85"| I
    H -->|"0.60 – 0.85"| J
    H -->|"< 0.60"| K
    I & J & K --> L --> M

    style H fill:#1a1a2e,color:#fff
    style I fill:#0d3b1e,color:#fff
    style J fill:#1a2e0d,color:#fff
    style K fill:#2e1a0d,color:#fff
```

---

## Oracle Engine → Auto-Post

```mermaid
flowchart TD
    A["Cloud Scheduler\nevery 6 hours"]
    B["Check kill_switch\ncreator_config"]
    C{Kill Switch?}
    Z["ABORT"]
    D["Elastic: Fetch trending topics\nworld_events_stream index"]
    E["Fetch 20 adjacent opinions\nper topic from personality graph"]
    F["Gemini 3\nBatch 50 topics — ONE API call\npredicted_position + confidence + suggested_post_text"]
    G{Confidence Routing}
    H["Auto-Post Queue\nPub/Sub → Content Agent"]
    I["Firebase Push\nCreator review required"]
    J["Discard"]
    K[("predicted_opinions\nMongoDB")]
    L["Arize\nlog prediction accuracy"]
    M["GitLab commit\noracle_cycle_{timestamp}"]

    A --> B --> C
    C -->|"true"| Z
    C -->|"false"| D --> E --> F --> G
    G -->|"> 0.75"| H
    G -->|"0.50 – 0.75"| I
    G -->|"< 0.50"| J
    H & I & J --> K --> L --> M

    style C fill:#1a1a2e,color:#fff
    style Z fill:#3b0d0d,color:#fff
    style G fill:#1a1a2e,color:#fff
    style H fill:#0d3b1e,color:#fff
    style I fill:#2e2a0d,color:#fff
    style J fill:#3b0d0d,color:#fff
```

---

## Brand Deal Pipeline

```mermaid
stateDiagram-v2
    [*] --> Scouting : Hunter Agent (weekly)
    Scouting --> Pitched : Pitcher sends cold email\nGemini voice + Arize bounds check\nfindOneAndUpdate precondition
    Pitched --> Negotiating : Reply received\nround ≤ 3, bounds pass\nfindOneAndUpdate precondition
    Negotiating --> Negotiating : Counter-response sent\nround++
    Negotiating --> HumanEscalation : round > 3\nOR bounds fail
    Negotiating --> Closing : Terms agreed\nfindOneAndUpdate precondition
    HumanEscalation --> Negotiating : Human resumes
    Closing --> Closed : Human taps Approve \nhuman_approval = true\nR2 HARD GATE
    Closing --> Dead : Human taps Reject
    Pitched --> Dead : No reply / abandoned
    Negotiating --> Frozen : Kill switch activated
    Closing --> Frozen : Kill switch activated
    Frozen --> Negotiating : Kill switch deactivated\n(15min cooldown)
    Closed --> [*]
    Dead --> [*]
```

---

## Inter-Agent Collaboration

```mermaid
sequenceDiagram
    participant A as EchoMind Agent A
    participant ES as Elastic (Shared)
    participant B as EchoMind Agent B
    participant FCM as Firebase
    participant HA as Creator A
    participant HB as Creator B

    Note over A,B: Discovery Phase (every 12h)
    A->>ES: INDEX presence {niche, audience_size, collab_openness}
    B->>ES: INDEX presence {niche, audience_size, collab_openness}

    A->>ES: Query overlap>55% AND openness>60%
    ES-->>A: Agent B matches

    Note over A,B: Negotiation (max 3 rounds)
    A->>A: Gemini: generate proposal
    A->>A: Sign with Ed25519 private key
    A->>ES: INDEX echomind_messages {proposal, signature}

    B->>ES: Poll incoming messages
    ES-->>B: Proposal from A
    B->>B: Verify Ed25519 signature ✓
    B->>B: Gemini: evaluate fit
    B->>B: Generate counter-proposal
    B->>B: Sign with Ed25519
    B->>ES: INDEX echomind_messages {counter, signature}

    A->>ES: Poll — receives counter
    A->>A: Verify signature ✓
    A->>A: Gemini: accept terms
    A->>ES: INDEX {accept, final_terms}

    Note over A,B: Dual Human Approval
    A->>FCM: Push Creator A [Approve][Reject]
    B->>FCM: Push Creator B [Approve][Reject]
    HA-->>A: Approve 
    HB-->>B: Approve 

    Note over A,B: Finalization
    A->>A: INSERT agent_interactions
    A->>A: UPDATE content calendar
    B->>B: INSERT agent_interactions
    B->>B: UPDATE content calendar
```

---

## Kill Switch — Full System Freeze

```mermaid
sequenceDiagram
    participant H as Creator (Mobile)
    participant DT as Dynatrace
    participant CF as Kill Switch Function
    participant MDB as MongoDB Atlas
    participant CS as Change Stream
    participant CR as All Cloud Run Agents
    participant PS as Pub/Sub
    participant GL as GitLab

    Note over H,DT: Two Activation Paths
    alt Human Activation
        H->>CF: POST /kill-switch/activate\n{creator_id, biometric_token}
        CF->>CF: Verify biometric ✓
    else Dynatrace Auto
        DT->>DT: Anomaly detected\n(infinite loop / critical drift)
        DT->>CF: POST /kill-switch/activate\n{reason: "dynatrace_auto"}
    end

    CF->>MDB: findOneAndUpdate\nSET kill_switch=true < 600ms
    MDB-->>CF: Write acknowledged
    CF-->>H: 200 OK

    MDB->>CS: Change event {kill_switch: true} < 500ms

    par Broadcast to all agents < 5s
        CS->>CR: Kill signal (TTL cache invalidation)
    end

    Note over CR: Each agent aborts current operation
    CR->>CR: Oracle: drop prediction queue, no publish
    CR->>MDB: Negotiator: SET stage="frozen" on active_deals
    CR->>CR: Pitcher: abort pending emails
    CR->>CR: Collab: index system_pause message

    PS->>PS: NACK all pending messages\nfor this creator_id

    CR->>GL: COMMIT "kill_switch_activated_{date}"
    DT->>DT: Switch to frozen monitoring mode

    Note over H,CF: TOTAL < 7.1s ✓

    Note over H,CF: Reactivation (min 15min cooldown)
    H->>CF: POST /kill-switch/deactivate\n{biometric_auth}
    CF->>CF: Verify: cooldown elapsed? ✓
    CF->>MDB: SET kill_switch=false
    MDB->>CS: Resume signal
    CS->>CR: All agents resume
```

---

## MCP Transport Architecture

```mermaid
graph LR
    subgraph "Cloud Run Container"
        AW["Agent Worker\n(TypeScript)"]
        subgraph "MCP Sidecars (stdio)"
            FT["fivetran-mcp"]
            MG["mongodb-mcp"]
            EL["elastic-mcp"]
            AR["arize-mcp"]
            GT["gitlab-mcp"]
            DN["dynatrace-mcp"]
        end
    end

    subgraph "External Services"
        FTA["Fivetran API\n(Platform APIs)"]
        MGA["MongoDB Atlas\n(VPC Peering)"]
        ELA["Elastic Cloud"]
        ARA["Arize Cloud"]
        GTA["GitLab.com"]
        DNA["Dynatrace\nOneAgent API"]
    end

    AW -->|"<1ms stdio"| FT & MG & EL & AR & GT & DN
    FT --> FTA
    MG --> MGA
    EL --> ELA
    AR --> ARA
    GT --> GTA
    DN --> DNA

    style AW fill:#1a1a2e,color:#fff
    style FT fill:#0d3b1e,color:#fff
    style MG fill:#0d3b1e,color:#fff
    style EL fill:#0d3b1e,color:#fff
    style AR fill:#0d3b1e,color:#fff
    style GT fill:#0d3b1e,color:#fff
    style DN fill:#0d3b1e,color:#fff
```

> **Why stdio?** Zero network hop. <1ms overhead per MCP call. Agents make 10–50 MCP calls per reasoning cycle — network latency would destroy every SLA.

---

## MongoDB Schema

```mermaid
erDiagram
    creator_config {
        string creator_id PK
        bool kill_switch
        object platforms
        object rate_card
        date kill_switch_activated_at
    }

    raw_content {
        string doc_id PK
        string creator_id FK
        string platform
        string processing_status
        binData embedding
        date created_at
    }

    opinions {
        objectId _id PK
        string creator_id FK
        string topic
        string position
        float strength
        float confidence
        binData embedding
        date last_updated
    }

    predicted_opinions {
        objectId _id PK
        string creator_id FK
        string topic
        string predicted_position
        float confidence
        string suggested_post_text
        string status
        date predicted_at
    }

    active_deals {
        objectId _id PK
        string creator_id FK
        string brand_name
        string thread_id
        string stage
        object current_terms
        array negotiation_history
        bool human_approval
        string contract_draft_url
        date last_activity
    }

    agent_interactions {
        objectId _id PK
        string creator_id FK
        string counterpart_agent_id
        string interaction_type
        string outcome
        int rounds
        object final_terms
        date timestamp
    }

    dead_letter_queue {
        objectId _id PK
        string creator_id FK
        string operation_type
        string error
        int retry_count
        date created_at
    }

    creator_config ||--o{ raw_content : "owns"
    creator_config ||--o{ opinions : "owns"
    creator_config ||--o{ predicted_opinions : "owns"
    creator_config ||--o{ active_deals : "owns"
    creator_config ||--o{ agent_interactions : "owns"
    raw_content ||--o{ opinions : "generates"
    opinions ||--o{ predicted_opinions : "drives"
```

---

## CI/CD Pipeline

```mermaid
flowchart LR
    A["git push\nmain branch"] --> B["test\nnpm test\n(Jest)"]
    B -->|"pass"| C["build\ndocker build\n+ push GCR"]
    B -->|"fail"| X["❌ blocked"]
    C --> D["deploy-staging\ngcloud run deploy\nechomind-staging"]
    D --> E["integration-test\nnpm run test:integration\n--env=staging"]
    E -->|"pass"| F["deploy-prod\n⚠️ MANUAL GATE\nhuman approval"]
    E -->|"fail"| Y["❌ blocked"]
    F --> G["Production\nechomind-prod"]

    style F fill:#2e1a0d,color:#fff
    style G fill:#0d3b1e,color:#fff
    style X fill:#3b0d0d,color:#fff
    style Y fill:#3b0d0d,color:#fff
```

---

## Hard Laws

```mermaid
flowchart TD
    A["Agent Action"] --> B{"R1 Check\nAI Identity"}
    B -->|"sincerely asked if AI"| C["MUST disclose\nGemini prompt +\nArize classifier +\ncontent agent gate"]
    B -->|"pass"| D{"R2 Check\nFinancial Gate"}
    D -->|"financial transaction"| E["REQUIRES\nhuman_approval=true\nin MongoDB\nCloser hard gate"]
    D -->|"pass"| F{"R3 Check\nOpinion Contradiction"}
    F -->|"contradicts creator"| G["ABORT\nArize contradiction\ndetection +\nopinion graph check"]
    F -->|"pass"| H["Action Proceeds"]

    style C fill:#2e1a0d,color:#fff
    style E fill:#2e1a0d,color:#fff
    style G fill:#3b0d0d,color:#fff
    style H fill:#0d3b1e,color:#fff
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Reasoning | Gemini 3 via Google Cloud Agent Builder |
| Data Ingestion | Fivetran MCP (stdio) |
| Persistence | MongoDB Atlas MCP + Vector Search (stdio) |
| Search & Messaging | Elastic Cloud MCP (stdio) |
| AI Observability | Arize MCP (stdio) |
| Audit & Versioning | GitLab MCP (stdio) |
| Infrastructure Monitoring | Dynatrace MCP (stdio) |
| Compute | Google Cloud Run (concurrency=1) |
| Messaging | Google Cloud Pub/Sub (shared topic, attribute filtering) |
| Scheduling | Google Cloud Scheduler |
| Secrets | Google Cloud Secret Manager + KMS (CSFLE) |
| Notifications | Firebase Cloud Messaging |
| Runtime | Node.js 22 + TypeScript 5.8 strict |
| Testing | Jest |

---

## Scaling Thresholds

| Creators | Action Required |
|---|---|
| 5 | MongoDB M10 → M30 |
| 20 | MongoDB M30 → M50 |
| 50 | Add MongoDB read replicas for Oracle |
| 100 | Deploy dedicated Vector Search nodes (S30) |
| 100 | Elastic 3-node cluster |
| 200 | MongoDB 3-shard cluster |
| 500 | Elastic: per-creator → shared index + routing |
| 1,000 | Request Gemini 5,000 RPM quota |

---

## Project Structure

```
Echomind/
├── src/
│   ├── agents/
│   │   ├── ingestion/
│   │   ├── oracle/
│   │   ├── content/
│   │   ├── deal/
│   │   │   ├── hunter/
│   │   │   ├── pitcher/
│   │   │   ├── negotiator/
│   │   │   └── closer/
│   │   └── inter-agent/
│   ├── cloud-functions/
│   │   └── kill-switch.ts
│   ├── db/
│   │   └── collection-defs.ts
│   ├── mcp/
│   │   ├── fivetran.ts
│   │   ├── mongodb.ts
│   │   ├── elastic.ts
│   │   ├── arize.ts
│   │   ├── gitlab.ts
│   │   └── dynatrace.ts
│   ├── utils/
│   │   └── kill-switch-checker.ts
│   └── workers/
│       └── kill-switch-broadcaster.ts
├── __tests__/
├── infra/
│   ├── cloud-run/
│   ├── pubsub/
│   ├── scheduler/
│   ├── secrets/
│   └── vpc/
├── docs/
│   └── EchoMind_Complete_Architecture.md
├── .gitlab-ci.yml
├── AGENTS.md
└── opencode.json
```

---

## Monitoring

| Metric | SLA | Alert Threshold |
|---|---|---|
| Agent Cycle Completion Rate | 99.9% | < 99.0% over 15min |
| MongoDB Query Latency P99 | < 200ms | > 500ms over 5min |
| Elastic Query Latency P99 | < 100ms | > 250ms over 5min |
| Gemini API Latency P99 | < 3,000ms | > 5,000ms over 5min |
| Kill Switch Latency | < 7s | > 10s |
| DLQ Size | < 10 | > 50 |
| Prediction Accuracy (30d) | > 0.70 | < 0.65 |
| Drift Events | < 5/day | > 10/day |
| Negotiation Bounds Violations | — | > 3/day |

---

## Security

- **Credential isolation** — each creator has isolated Secret Manager secrets via Workload Identity
- **CSFLE** — `contract_draft_url`, `oauth_tokens`, `rate_card` encrypted at field level via KMS
- **Ed25519** — all inter-agent messages cryptographically signed and verified before processing
- **Zero hardcoded credentials** — enforced via GitLab CI secret scanning
- **Immutable audit log** — every agent action commits to GitLab. Tamper-proof by design.
- **Triple enforcement** — R1/R2/R3 enforced at Gemini prompt, Arize observability, and MongoDB precondition layers simultaneously

---

<div align="center">
  <strong>EchoMind </strong><br/>
</div>
