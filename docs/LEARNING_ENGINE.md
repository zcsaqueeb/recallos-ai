# RECALLOS — Learning Engine

The learning engine converts evaluated decisions into lessons that can demonstrably change later recommendations. It is designed so that **an LLM cannot talk a lesson into being supported** — only recorded evidence can.

## 1. From decisions to lessons

### Step 1 — Record (Decision Journal)
A decision stores the full reasoning context: question, goal, constraints, **assumptions** (each gets a stable id), evidence references, recommendation, qualitative confidence, expected outcome, and evaluation criteria.

### Step 2 — Evaluate (outcome evaluation)
When the user records the actual outcome, the engine:

1. Persists an `OUTCOME` EvidenceItem immediately (the fact must survive even if the model is unavailable).
2. Asks the AI to adjudicate **every assumption** with one of exactly four verdicts:
   - `HELD`, `PARTIALLY_HELD`, `NOT_HELD`, `INCONCLUSIVE`.
   - `INCONCLUSIVE` is mandatory when the outcome or evidence cannot settle the assumption — guessing is prohibited. If the AI is unavailable, all assumptions are honestly marked `INCONCLUSIVE` with the reason.
3. Computes an overall verdict and stores per-assumption rationales that distinguish observed facts from interpretation.
4. Drafts **at most one** lesson from the evaluation. A single-evaluation lesson is always `tentative`, `PROPOSED`, confidence `LOW`, `observationCount = 1`. One failed prediction never becomes a universal rule.

### Step 3 — Cross-assess
The same evaluation is compared against every open lesson in the same category (`PROPOSED`/`SUPPORTED`). The AI classifies each relation as `SUPPORTS` / `CONTRADICTS` / `UNRELATED`:

- `SUPPORTS` → observationCount +1, decision appended to supporters. If the promotion gate now passes, the engine auto-promotes (server-side gate check — not an LLM decision).
- `CONTRADICTS` → a `CONTRADICTION:` evidence entry is appended, which blocks promotion; an `APPLIED` lesson is demoted to `REEVALUATED` and its confidence reset to `LOW`.

## 2. Evidence gates (the core anti-fraud mechanism)

`gateForPromotion()` (server-enforced, `src/lib/learning/engine.ts`):

| Requirement | Threshold |
|---|---|
| Status | must be `PROPOSED` |
| Supporting observations | ≥ **2** (`MIN_OBSERVATIONS`) |
| Evidence quality | ≥ 1 evidence item of kind `OUTCOME` |
| Contradictions | **0** (`MAX_CONTRADICTIONS`) |

Promotion via the API returns `409 PROMOTION_BLOCKED_BY_EVIDENCE_GATE` with the exact failing reasons; the Learning Lab renders those reasons. The gate is a pure function and is unit-tested (`tests/engine.test.ts`).

### Confidence is computed, never asked for
`confidence = LOW` while `PROPOSED`/`REEVALUATED`; `MEDIUM` at ≥2 observations; `HIGH` at ≥4 observations. The LLM never supplies confidence values for lessons.

### Lifecycle

```
PROPOSED ──(gate passes: ≥2 obs, OUTCOME evidence, 0 contradictions)──► SUPPORTED
SUPPORTED ──(referenced as applied in a later recommendation trace)──► APPLIED
APPLIED ──(later outcome contradicts it)──► REEVALUATED (confidence → LOW)
PROPOSED ──(user rejects)──► REJECTED
REEVALUATED ──(user re-opens)──► PROPOSED (history retained in evidence trail)
```

## 3. Baseline vs personalized comparison

`POST /api/learning/compare` runs the **same question twice through the same model**: once with memory context suppressed (baseline) and once memory-informed. The response includes:

- both recommendations,
- `changed` (whether memory produced a different answer),
- the exact memories/lessons that influenced the personalized run, each with an influence note,
- a disclosure block stating that this is a controlled comparison and which real memories were used.

The ask pipeline marks a lesson `APPLIED` when the personalized answer's trace references it — the loop closes only when memory demonstrably changed an answer.

## 4. What counts as evidence

| Kind | Source | Example |
|---|---|---|
| `OUTCOME` | user-reported result + evaluation | "liquidity dropped 60% on day 3; exited at −18%" |
| `BLOCKCHAIN` | ChainLens observation (Tatum) | pool depth, transaction effects |
| `USER` | direct user input at decision time | "prefer cold storage above $1k" |
| `MEMORY` | recalled memory records | prior constraints/preferences |
| `WEB` | (reserved) fetched references | — |

Every evidence item carries `kind`, `sourceRef`, and a human-readable summary. Contradictions are evidence too — they block lesson promotion and demote applied lessons.

## 5. How unsupported conclusions are avoided

1. **Schema-validated outputs** — every AI response is Zod-parsed; malformed output triggers one corrective retry, then honest failure.
2. **Four-way claim separation** — verifiedFacts / assumptions / inferences / unknowns are structurally separate fields in every answer.
3. **Inconclusive is a first-class verdict** — thin evidence yields `INCONCLUSIVE`, not a guess.
4. **Evidence-gated promotion** — enforced server-side, unit-tested, with user-visible refusal reasons.
5. **Provenance everywhere** — memories show their source type; chain observations show method + params; lessons show their full evidence trail.
6. **No unmeasured improvement claims** — the reproducible evaluation suite (`src/lib/learning/scenarios.ts`) asserts deterministic guarantees (retrieval relevance, fixture separation, gating, conflict surfacing, persistence honesty, claim separation) and labels model-dependent checks as such. Results are persisted and viewable in the Learning Lab.
