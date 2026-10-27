# RECALLOS — Architecture

## 1. System overview

RECALLOS is a Next.js 16 App Router application. All user-facing views are rendered by a single-page workspace (`src/app/page.tsx`) with client-side view navigation; all backend behavior lives in `/api/*` route handlers. Application state is SQLite via Prisma; persistent agent memory is Walrus Memory (when configured) mirrored into SQLite for recall and audit.

```
Browser (single-page workspace)
   │  fetch /api/*
   ▼
Next.js route handlers ── rate limiter (expensive endpoints)
   │
   ├─ lib/ai/ask-pipeline ──► MemoryService.recall ──► SQLite (local durable store)
   │        │                    └─► Walrus SDK recall (when configured)
   │        ├─► TatumService (optional fresh Sui evidence)
   │        └─► z-ai-web-dev-sdk (guarded, schema-validated JSON output)
   ├─ lib/learning/engine ──► outcome evaluation, lesson lifecycle, evidence gates
   └─ lib/memory/service ──► write policy (dedupe → local mirror → Walrus confirm)
```

## 2. Components

| Module | Responsibility |
|---|---|
| `src/app/page.tsx` + `src/components/recallos/*` | Landing, Dashboard, Ask, Journal, Memory Explorer, ChainLens, Learning Lab, Settings. Every integration chip, badge, and counter renders true state from `/api/status`. |
| `src/app/api/*` | Thin, validated endpoints. Zod at every boundary; per-IP token buckets on `ask`, `compare`, `evaluate`, `chainlens`, `memory-write`, `eval`. |
| `src/lib/memory/walrus-client.ts` | Official `@mysten-incubation/memwal` SDK loaded via dynamic import (optional heavy dependency). Exposes `remember` + `waitForRememberJob` + `recall` with explicit confirmation semantics. |
| `src/lib/memory/service.ts` | Write policy (dedupe → durable local record → Walrus write → verified only after job confirmation) and recall policy (deterministic keyword/category scoring + optional Walrus recall merge + explicit conflict detection). |
| `src/lib/tatum/*` | Sui gRPC client for `sui-{network}-grpc.gateway.tatum.io` (Protocol Buffers over HTTP/2 via `@grpc/grpc-js` + `@grpc/proto-loader`, official `sui/rpc/v2` protos vendored at `vendor/sui-grpc-proto/`), `x-api-key` metadata auth, hard deadlines, and typed status-code → error mapping. The Sui Foundation deprecated legacy JSON-RPC in favor of gRPC and GraphQL, and Tatum transitioned its Sui infra to the gRPC gateway — all reads run on `LedgerService`/`StateService`, live-verified. Normalized observations persisted with operation + parameters + sourceRef. |
| `src/lib/ai/*` | `z-ai-web-dev-sdk` wrapper with retry, JSON extraction + Zod validation (one corrective retry), system prompts, and untrusted-content guards. |
| `src/lib/learning/*` | Outcome evaluation (per-assumption verdicts), lesson drafting, evidence gates, cross-assessment (SUPPORTS/CONTRADICTS), fixed evaluation scenarios. |
| `src/lib/security/rate-limit.ts` | In-memory token buckets per client for expensive operations. |
| `src/lib/validation.ts` | All shared Zod schemas + JSON column codecs (parse defensively, never trust stored shape). |

## 3. Data model (Prisma / SQLite)

- **Decision** — full Decision DNA: question, goal, constraints, assumptions, evidence refs, recommendation, qualitative confidence, expected outcome, evaluation criteria, review date; after evaluation: actual outcome, per-assumption verdicts, overall verdict.
- **MemoryRecord** — category, content, `sourceType` (`WALRUS` | `LOCAL_MIRROR` | `USER_INPUT`), `storageState` (`VERIFIED` | `PENDING_SYNC` | `FAILED`), optional Walrus `externalId` + namespace, importance, tags, decision link.
- **Lesson** — statement, category, supporting decision ids, evidence trail, observation count, computed confidence, status (`PROPOSED` → `SUPPORTED` → `APPLIED` → `REEVALUATED` / `REJECTED`), exceptions.
- **EvidenceItem** — typed provenance records (`BLOCKCHAIN`, `WEB`, `USER`, `MEMORY`, `OUTCOME`) linked to decisions/lessons.
- **ChainObservation** — every query: kind, exact method, params, raw result, network, latency.
- **ActivityEvent** — operational audit trail (writes, recalls, evaluations, promotions, comparisons, eval runs).
- **EvalResult** — stored evaluation-suite runs.

JSON-shaped columns are stored as strings and parsed through Zod codecs at the application boundary (SQLite-safe).

## 4. Memory lifecycle

**Write:** input → dedupe (normalized-text match within category) → SQLite row (`LOCAL_MIRROR/PENDING_SYNC`) → Walrus `remember()` → `waitForRememberJob()` → on confirmation the row is upgraded to `WALRUS/VERIFIED` with the job id. On any failure the row stays pending and the caller receives the failure reason — the UI never reports mainnet persistence that did not happen.

**Recall:** deterministic scoring over the local store (keyword overlap + category boosts + importance) → conflict detection (contradictory statements in the same category are flagged via `conflictWith`, never silently resolved) → optional real Walrus recall merged by content overlap → top-K with full provenance. Recall failures are surfaced in the answer trace.

**Lesson lifecycle:** see `docs/LEARNING_ENGINE.md`.

## 5. Evidence model

Every claim-bearing object carries provenance:

- Decision assumptions → evaluated against `OUTCOME` evidence (+ any `BLOCKCHAIN` evidence observed via ChainLens).
- Lessons → evidence trail with kind + sourceRef + summary; contradictions are stored as `CONTRADICTION:` entries and block promotion.
- ChainLens observations → exact gRPC operation, parameters, raw result, timestamp, network.
- AI answers → four-way separation (verifiedFacts / assumptions / inferences / unknowns) plus `memoriesUsed[].influence` and `wouldChangeIf`.

## 6. Security boundaries

- **Secrets**: read server-side only (`process.env`); `.env` git-ignored; `.env.example` contains placeholders; API keys never serialized into client responses.
- **Untrusted input**: memories, chain data, and any fetched content are wrapped in `<<<UNTRUSTED … >>>` delimiters with explicit "data, not instructions" guards; system rules are re-asserted after blocks.
- **Read-only chain access**: Tatum is used for observation only. No transaction signing, no seed phrases, ever.
- **Authorization**: this build resolves a single server-side workspace identity (`resolveWorkspaceUser`); clients cannot supply or switch an account id. Production multi-user requires a real session provider (e.g., NextAuth) plus row-level ownership checks — documented as the primary production delta.
- **Abuse protection**: token buckets on AI- and chain-heavy endpoints; bounded query sizes; timeouts on all outbound calls (`AbortController`).
- **Error handling**: failures are normalized (`TatumError` codes, AI unavailable, Walrus failure reasons) and disclosed to the user instead of being hidden or guessed around.
- **Logging**: operational events land in `ActivityEvent`; secrets are never logged.

## 7. Deployment path

`bun run build` produces a standalone Next.js build (`next.config.ts` output). Required env vars are listed in `.env.example`. SQLite requires a writable file path (`DATABASE_URL`); swap to Postgres by changing the Prisma datasource for multi-instance deployments. No cron/worker needed — all heavy operations are request-scoped and rate-limited.

## 8. Honest boundaries of this build

- **Single workspace identity** (sandbox): multi-user auth is the documented production step (§6).
- **Walrus/Tatum credentials absent in the sandbox**: the real integration paths are implemented and verified against mainnet; if credentials are removed, the UI reports `blocked` states and unconfigured services fail honestly (`NOT_CONFIGURED`) — synthetic data is never substituted. The Settings page contains the step-by-step mainnet acceptance test.
- **Walrus recall merge** normalizes defensively across SDK response shapes; re-verify against the current SDK version when credentials are configured (see `docs/RESEARCH.md`).
- **Sui full-node access is gRPC** (the Sui Foundation deprecated legacy JSON-RPC across the ecosystem in favor of gRPC and GraphQL; Tatum transitioned its Sui infra to `sui-mainnet-grpc.gateway.tatum.io`). All query shapes come from the official `sui/rpc/v2` protos vendored at `vendor/sui-grpc-proto/` (MystenLabs/sui-apis) and are live-verified with real mainnet responses.
- **Rate limiting** is per-process (dev-grade); use a shared store behind real auth in production.
