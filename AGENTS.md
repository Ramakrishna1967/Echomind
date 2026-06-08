# EchoMind Sovereign — AGENTS.md

**This repository holds the architecture specification only.** No application code, tests, packages, or build system exist.

## Auto-Loaded Context (opencode)
- `opencode.JSON` forces every session to load this file + `docs/EchoMind_Complete_Architecture.md`.
- The complete production architecture (component diagrams, sequence diagrams, MongoDB schemas, Gemini system prompts, deployment topology, failure modes, scaling model) lives in `docs/EchoMind_Complete_Architecture.md`.

## Absolute Laws — Never Violate
| Law | Key Enforcement |
|---|---|
| **R1** | Never deny being AI when sincerely asked |
| **R2** | Never execute financial transactions without `human_approval=true` in MongoDB |
| **R3** | Never publish contradictions of the creator's explicit public positions |

**Every financial code path MUST check the MongoDB `human_approval` flag. No exceptions.**

## Coding Rules — ALWAYS FOLLOW
1. `npm test` before marking any task done (applies once implementation code exists).
2. **ALL** state transitions: use `findOneAndUpdate` with stage precondition. Null return = race condition; do not proceed.
3. **ALL** platform APIs go through Fivetran MCP only. Never call YouTube/Twitter/etc. directly.
4. All MCP calls: stdio transport, retry ×3 with exponential backoff, dead-letter on final failure.
5. Check `kill_switch` **first** on every agent cycle. Abort immediately if true.
6. R2 gate on **every** financial code path — `human_approval` must be true.
7. Ed25519-sign **all** outgoing inter-agent messages. Verify signatures on all incoming.
8. GitLab commit after every agent action (naming: `{action}_{entity}_{date}`).
9. Arize policy check before every content publish.
10. Cloud Run `concurrency=1` on all services. Agents are stateful; no shared state between requests.
11. Oracle: one batched Gemini call for 50 topics. Never issue 50 separate calls.
12. 5 s TTL cache on `kill_switch` in every agent.
13. MongoDB shard key `{region:1, creator_id:"hashed"}` — always include `region` in queries.

## Working in This Repo
- Changes here define the contract for the entire future system. Keep rules and the full architecture doc in sync.
- See parent `C:\Users\omsai\AGENTS.md` for global stack (Node 22 + TS strict + Jest), agentic workflow (`/plan` before multi-file work, run `code-review` skill on own output), and the rule that per-repo AGENTS.md takes precedence inside subdirectories.
- Do not attempt to run tests, builds, or dev servers — executable sources (package.json, CI, scripts) do not exist yet; examples in the architecture doc are forward-looking only.
