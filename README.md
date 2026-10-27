# RECALLOS
### An AI Decision Agent That Learns From Experience

**Your AI doesn't just remember your past. It learns from it.**

🔗 **Live Demo:** https://recallos.space-z.ai/

**RECALLOS** is a personal AI decision agent with portable, long-term memory. Instead of simply storing conversations, it remembers why decisions were made, retrieves relevant past experiences, examines fresh evidence, evaluates assumptions against actual outcomes, and transforms verified lessons into better future recommendations.

Its defining principle is simple:

> **Memory must change behavior—and every change must be explainable.**

Built for the **Tatum × Walrus Total Recall Hackathon**, RECALLOS combines Walrus Memory for portable, user-owned memory with Tatum's Sui blockchain data gateway to create a transparent, evidence-driven learning system.

Unlike conventional AI assistants that recall previous conversations without necessarily learning from them, RECALLOS closes the loop between **decision, outcome, evidence, and improvement**.

---

## 🚀 The Problem

Today's AI assistants can generate recommendations, summarize conversations, and retrieve previously stored information. But remembering something is not the same as learning from it.

Most AI memory systems struggle to answer fundamental questions:

- **Why?** Why was a particular decision made, and what assumptions supported it?
- **What happened?** Did the decision produce the expected outcome?
- **What was learned?** Which assumptions held up, and which were wrong?
- **What changes next?** How should the new evidence influence future recommendations?
- **Can we trust it?** Is the recalled memory real, and can its source be verified?

Simply appending chat history does not solve these problems.

RECALLOS approaches memory as a structured decision-making and learning system—not merely a conversation archive.

## 💡 The Solution

RECALLOS connects five stages into a continuous learning loop:

**Observe → Remember → Recommend → Verify → Learn → Apply**

1. **Observe:** Gather relevant information, including live Sui blockchain data when configured.
2. **Remember:** Preserve the reasoning behind decisions, including goals, constraints, assumptions, evidence, and expected outcomes.
3. **Recommend:** Retrieve relevant experiences and generate context-aware recommendations.
4. **Verify:** Compare actual outcomes against expectations and evaluate individual assumptions.
5. **Learn:** Convert supported findings into evidence-backed lessons.
6. **Apply:** Use those lessons to influence future recommendations, with the changes made visible to the user.

The result is an AI decision agent designed not just to recall the past, but to use verified experience to improve what it recommends next.

---

## 🧠 Core Features

### 1. Decision DNA — Remember the Reasoning, Not Just the Answer

Most AI memory systems preserve snippets of conversations. RECALLOS captures the structure behind a decision.

Each decision record can include:

- The original question and decision objective
- Goals and constraints
- Key assumptions and supporting evidence
- The recommendation and its rationale
- The expected outcome
- Criteria for evaluating success
- The actual outcome and subsequent evaluation

This structured representation allows RECALLOS to revisit the reasoning behind past decisions and determine what remains useful.

**Why it matters:** A previous recommendation becomes an experience that can be evaluated, challenged, and learned from—not just text retrieved from an old conversation.

### 2. ChainLens — Ground Decisions in Real Sui Data

ChainLens connects RECALLOS to the Sui blockchain through Tatum's Sui gRPC gateway.

It supports blockchain queries for:

- Checkpoints
- Transactions
- Account balances
- On-chain objects

The integration uses Protocol Buffers over HTTP/2, with the Tatum API key handled server-side.

Crucially, ChainLens distinguishes between **observed facts and model-generated interpretations**.

For example, an observed transaction or balance is treated as blockchain data, while any explanation of what that data means is presented separately as an interpretation.

If the Tatum integration is not configured, ChainLens reports that the required credentials are missing. It never substitutes fabricated blockchain responses for live data.

**Why it matters:** Recommendations can be grounded in real observations without confusing retrieved facts with AI-generated conclusions.

### 3. Learning Loop — Turn Outcomes Into Evidence-Backed Lessons

RECALLOS evaluates decisions against their actual outcomes and examines the assumptions that influenced them.

Each assumption receives an explicit verdict:

- `HELD` — The assumption was supported by the observed outcome.
- `PARTIALLY_HELD` — The assumption was only partially supported.
- `NOT_HELD` — The assumption was contradicted by the outcome.
- `INCONCLUSIVE` — Available evidence was insufficient to determine whether the assumption held.

The system then manages lessons through a controlled lifecycle:

`PROPOSED → SUPPORTED → APPLIED → REEVALUATED`

The distinction between generating a lesson and validating it is fundamental.

An LLM can **draft** a potential lesson, but the system's evidence gates determine whether it can be promoted. Lessons must not become trusted guidance merely because a model generated a convincing explanation.

Once a supported lesson is applied, RECALLOS can expose its influence on subsequent recommendations and reevaluate it as new evidence becomes available.

**Why it matters:** Learning becomes an explicit, inspectable process rather than an unsupported claim that the AI has improved.

### 4. Explainable Memory — Make Recall and Influence Visible

RECALLOS makes its memory system inspectable.

For each recommendation, users can examine:

- Which memories were retrieved
- Why those memories were considered relevant
- Which lessons influenced the recommendation
- Whether conflicting memories were detected
- Which facts and assumptions support the result
- What remains uncertain or unknown
- What evidence could change the recommendation

Memory provenance is also explicit.

The application distinguishes among verified Walrus Memory records, local records awaiting synchronization, and information supplied by the user.

A record is labeled **Walrus verified** only when the actual Walrus integration confirms the write. Otherwise, it remains labeled `LOCAL_MIRROR / PENDING_SYNC` or `USER_INPUT`, as appropriate.

**Why it matters:** Users can inspect not only what RECALLOS recommends, but also which experiences influenced the recommendation and how much confidence to place in the underlying memory.

### 5. Learning Lab — Evaluate Whether Memory Actually Helps

RECALLOS includes a Learning Lab for examining the behavior of its memory and learning mechanisms.

It provides:

- Baseline-versus-personalized recommendation comparisons
- Lesson lifecycle management
- Reproducible evaluation scenarios
- Results from deterministic checks
- Visibility into evidence-gating and provenance behavior

The evaluation suite covers six areas:

1. Retrieval relevance
2. Verified provenance integrity
3. Lesson promotion gates
4. Conflict detection and surfacing
5. Persistence and synchronization honesty
6. Separation of claims and evidence

These checks help validate the system's core invariants and make its behavior easier to inspect.

**Why it matters:** RECALLOS is designed to make learning observable and testable, not simply to claim that personalization improves performance.

---

## 🖥️ Explore the Application

RECALLOS provides a unified workspace for managing decisions, memory, blockchain observations, and learning.

| Section | Capabilities |
|---|---|
| **Landing** | Product vision and the complete Observe → Remember → Recommend → Verify → Learn → Apply loop. |
| **Dashboard** | Memory counters, verified-versus-local record counts, integration status, and recent activity. |
| **Ask RECALLOS** | Context-aware recommendations with uncertainty, evidence provenance, recalled memories, and explanations of memory influence. |
| **Decision Journal** | Record decisions, document actual outcomes, and evaluate assumptions individually. |
| **Memory Explorer** | Inspect memory records, source labels, relevance scores, and conflicting information. |
| **ChainLens** | Query Sui checkpoints, transactions, balances, and objects through the Tatum gateway. |
| **Learning Lab** | Manage lessons, compare baseline and personalized recommendations, and run evaluation scenarios. |
| **Settings** | Configure and test Walrus Memory and Tatum integrations, inspect their status, and manage credentials. |

When an external integration is unavailable, the relevant interface displays its actual blocked or unconfigured state and guides the user through setup.

**No synthetic blockchain data. No falsely verified memories. No fabricated integration success.**

---

## 🏗️ Architecture

RECALLOS uses a modular architecture that separates its interface, decision pipeline, memory persistence, blockchain access, and learning mechanisms.

### Technology Stack

| Layer | Technology |
|---|---|
| Frontend and application framework | Next.js 16, React, TypeScript |
| Styling and UI components | Tailwind CSS 4, shadcn/ui |
| Database and persistence | Prisma, SQLite |
| Input validation | Zod |
| AI integration | `z-ai-web-dev-sdk` |
| Portable memory | Walrus Memory via `@mysten-incubation/memwal` |
| Blockchain data access | Tatum Sui gRPC gateway |
| gRPC implementation | `@grpc/grpc-js` and vendored official Sui Protocol Buffer definitions |
| Testing | Bun test suite |
| Security | Rate limiting and validated API boundaries |

### System Overview

```text
                       ┌─────────────────────────┐
                       │      RECALLOS UI        │
                       │                         │
                       │ Dashboard · Ask         │
                       │ Decision Journal        │
                       │ Memory Explorer         │
                       │ ChainLens · Learning Lab│
                       └────────────┬────────────┘
                                    │
                       ┌────────────▼────────────┐
                       │      API LAYER         │
                       │                         │
                       │ Validation · Security  │
                       │ Decision Orchestration │
                       └────────────┬────────────┘
                                    │
               ┌────────────────────┼────────────────────┐
               │                    │                    │
    ┌──────────▼─────────┐ ┌────────▼─────────┐ ┌────────▼─────────┐
    │   MEMORY SERVICE   │ │   AI PIPELINE    │ │  CHAINLENS       │
    │                    │ │                  │ │                  │
    │ Recall and Ranking │ │ Recommendations  │ │ Live Sui Queries │
    │ Deduplication      │ │ Evidence Analysis│ │ Tatum gRPC       │
    │ Conflict Detection │ │ Guarded Prompts  │ │ Fact Separation  │
    └──────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
               │                    │                    │
       ┌───────┴────────┐            │            ┌───────▼────────┐
       │                │            │            │  Sui Network   │
┌──────▼───────┐ ┌──────▼────────┐   │            └────────────────┘
│ Walrus Memory│ │ Local SQLite  │   │
│              │ │ Mirror        │   │
│ Portable     │ │ Pending Sync  │   │
│ Memory       │ │               │   │
└──────────────┘ └───────────────┘   │
                                     │
                         ┌───────────▼───────────┐
                         │    LEARNING ENGINE    │
                         │                       │
                         │ Outcome Evaluation    │
                         │ Assumption Verdicts   │
                         │ Evidence-Gated Lessons│
                         │ Recommendation Updates│
                         └───────────────────────┘
```

### Source Structure

```text
src/
├── app/
│   └── api/
│       ├── status
│       ├── dashboard
│       ├── ask
│       ├── memories
│       ├── decisions
│       ├── lessons
│       ├── chainlens
│       ├── eval
│       └── learning/compare
│
├── components/
│   └── recallos/
│       ├── Landing
│       ├── Dashboard
│       ├── Ask
│       ├── Journal
│       ├── MemoryExplorer
│       ├── ChainLens
│       ├── LearningLab
│       └── Settings
│
└── lib/
    ├── memory/
    │   ├── Walrus client
    │   └── MemoryService
    ├── tatum/
    │   ├── Tatum Sui gRPC client
    │   └── ChainLens service
    ├── ai/
    │   ├── Provider wrapper
    │   ├── Guarded prompts
    │   └── Ask pipeline
    ├── learning/
    │   ├── Outcome evaluation
    │   ├── Lesson engine
    │   ├── Evidence gates
    │   └── Evaluation scenarios
    ├── security/
    │   └── Rate limiting
    └── validation.ts

docs/
├── ARCHITECTURE.md
├── LEARNING_ENGINE.md
├── INTEGRATIONS.md
├── RESEARCH.md
└── SUBMISSION_CHECKLIST.md

tests/
└── Evidence gates and validation schemas
```

---

## 🔗 Walrus Memory × Tatum × Sui

RECALLOS combines portable memory with blockchain data access to support transparent, evidence-driven decision-making.

### Walrus Memory: Portable, User-Owned Memory

Walrus Memory provides the external memory integration used to persist and retrieve decision experiences beyond the local application database.

RECALLOS uses a local SQLite mirror alongside the external integration. These storage layers have different trust statuses and are not treated as interchangeable.

- Confirmed external writes can be labeled as Walrus verified.
- Local records awaiting synchronization remain explicitly unverified.
- Missing credentials produce a blocked integration state.
- Memory provenance is preserved in the application interface.

The objective is to make memory portable while retaining visibility into where each record actually resides.

### Tatum: Real Sui Blockchain Observations

Tatum provides the Sui blockchain data gateway used by ChainLens.

The integration supports live queries when valid credentials and the required network configuration are available.

Blockchain observations are kept distinct from AI-generated interpretations, helping the decision pipeline reason about on-chain activity without presenting inferences as directly observed facts.

### Why the Combination Matters

Together, these integrations establish a foundation for an AI agent that can:

1. Preserve decision context as structured memory.
2. Retrieve relevant historical experiences.
3. Incorporate fresh blockchain observations.
4. Compare expectations with actual outcomes.
5. Generate lessons subject to evidence-based promotion rules.
6. Explain how past experiences and new evidence influence future recommendations.

The result is a practical exploration of how portable memory and live data access can support more accountable AI decision-making.

---

## ⚙️ Getting Started

### Prerequisites

Install the following before running the application:

- [Bun](https://bun.sh/)
- Node.js, if required by your environment
- Git
- An SQLite-compatible Prisma setup
- Optional: Walrus Memory credentials
- Optional: a Tatum API key for Sui queries

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment Variables

Create your local environment file:

```bash
cp .env.example .env
```

Configure the variables relevant to your setup.

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | SQLite database connection | Yes |
| `WALRUS_MEMORY_DELEGATE_KEY` | Authorizes Walrus Memory writes | For real Walrus writes |
| `WALRUS_MEMORY_ACCOUNT_ID` | Identifies the Walrus Memory account | For real Walrus writes |
| `WALRUS_MEMORY_SERVER_URL` | Specifies the Walrus Memory relayer | For real Walrus writes |
| `WALRUS_MEMORY_NAMESPACE` | Selects the memory namespace; defaults to `recallos` | Optional |
| `TATUM_API_KEY` | Authenticates ChainLens requests | For live Sui queries |
| `TATUM_SUI_NETWORK` | Selects `mainnet`, `testnet`, or `devnet` | Optional; defaults to `mainnet` |

**Security note:** Keep credentials in server-side environment variables or the application's protected settings mechanism. Never commit secrets to source control or expose them through client-side code.

### 3. Initialize the Database

```bash
bun run db:push
```

This applies the Prisma schema to the configured database.

### 4. Start the Development Server

```bash
bun run dev
```

Open the application at:

http://localhost:3000

### 5. Enable the External Integrations

To activate the real Walrus Memory SDK path, install the required peer dependencies:

```bash
bun add @mysten-incubation/memwal @mysten/sui @mysten/seal @mysten/walrus ai zod
```

Add the appropriate credentials through the environment configuration or the application's Settings interface.

Once configured, test each integration and verify its reported status before relying on external memory persistence or live blockchain observations.

---

## 🧪 Running Tests

### Run the Test Suite

```bash
bun test
```

The existing tests cover deterministic parts of the system, including:

- Lesson promotion gates
- Validation schemas
- Core evidence-handling rules

### Run the Lint Checks

```bash
bun run lint
```

### Run the Learning Evaluation Suite

Open **Learning Lab → Run evaluation** in the application.

The evaluation executes six fixed scenarios covering retrieval relevance, provenance integrity, evidence-gated lesson promotion, conflict detection, persistence honesty, and claim separation.

### Verify Walrus Memory Integration

The Settings interface includes a Walrus mainnet acceptance-test checklist.

The test requires at least ten verified writes and a successful recall operation. It becomes eligible to run when the necessary credentials and dependencies are configured.

Until the integration is available and the test succeeds, its status remains blocked rather than reporting a fabricated pass.

---

## 🛡️ Honest Degradation and Trust Boundaries

RECALLOS is designed to remain usable when external services are unavailable without pretending those services are working.

| Scenario | Expected behavior |
|---|---|
| Walrus credentials are missing | Local persistence remains available; records are not labeled as Walrus verified. |
| Tatum credentials are missing | ChainLens reports `NOT_CONFIGURED` rather than returning synthetic blockchain data. |
| An external write has not been confirmed | The record remains a local mirror pending synchronization. |
| A user supplies information manually | Its provenance remains identified as user input. |
| An LLM proposes a lesson | The lesson cannot bypass the configured evidence-promotion rules. |
| Evidence conflicts with a previous assumption | The system can surface the conflict for inspection and evaluation. |
| Available evidence is insufficient | The system can report uncertainty or an inconclusive verdict. |
| An integration is unavailable | The UI exposes the blocked state and provides configuration guidance. |

These behaviors reflect a core design commitment:

**An unavailable integration must never be disguised as a successful one.**

Likewise, a plausible AI-generated explanation must never be confused with independently verified evidence.

---

## 🔬 Verification, Evaluation, and Limitations

RECALLOS combines deterministic tests, application-level evaluations, and integration acceptance checks.

Each serves a different purpose:

- **Unit tests** check selected deterministic rules, including evidence gates and input validation.
- **Learning evaluations** exercise predefined scenarios to check important application behaviors.
- **Integration acceptance tests** verify external operations when the required services and credentials are available.

Passing these checks does not, by itself, establish that every recommendation is accurate or that personalization always improves decision quality.

The current implementation also has documented boundaries, including single-workspace identity and other sandbox-specific limitations. These are described in `docs/ARCHITECTURE.md`, under the Boundaries section.

The goal is to make the system's actual capabilities, dependencies, and limitations visible rather than overstate what has been validated.

---

## 🗺️ Documentation

Explore the implementation details and design decisions:

- `docs/ARCHITECTURE.md` — System architecture, components, boundaries, and design decisions.
- `docs/LEARNING_ENGINE.md` — Outcome evaluation, lesson lifecycle, and evidence-promotion rules.
- `docs/INTEGRATIONS.md` — Walrus Memory and Tatum integration details.
- `docs/RESEARCH.md` — Research notes and supporting context.
- `docs/SUBMISSION_CHECKLIST.md` — Hackathon submission and verification checklist.

---

## 🌟 What Makes RECALLOS Different?

RECALLOS is built around a distinction that matters for the future of personal AI:

**Remembering an experience is not the same as learning from it.**

A conventional memory system might retrieve a previous recommendation. RECALLOS aims to go further by examining why that recommendation was made, checking what happened, evaluating its underlying assumptions, and using supported lessons to inform future decisions.

Its distinguishing principles are:

- **Structured decision memory:** Preserve the reasoning behind decisions, not just their conversational history.
- **Outcome-driven evaluation:** Revisit assumptions against observed results.
- **Evidence-gated learning:** Separate proposed lessons from supported conclusions.
- **Portable memory:** Integrate with Walrus Memory while preserving source and verification status.
- **Live blockchain context:** Use Tatum to access Sui data when properly configured.
- **Explainable personalization:** Make recalled memories and their influence on recommendations visible.
- **Honest system behavior:** Never substitute synthetic data for unavailable external services.

Together, these principles make RECALLOS a foundation for personal AI that can be inspected, evaluated, and improved through experience.

---

## 🔮 Vision

We believe the next generation of AI assistants should do more than answer questions and retain conversation history.

They should build a structured understanding of past decisions, recognize when their assumptions fail, preserve lessons supported by evidence, and explain how those lessons influence future recommendations.

RECALLOS explores that vision through portable memory, blockchain data access, and an explicit learning lifecycle.

The long-term goal is an AI decision agent whose personalization is not a black box: users should be able to inspect what it remembers, understand what it learned, and see why its recommendations change.

### **RECALLOS — Remember the decision. Verify the outcome. Learn the lesson. Change the next decision.**

🔗 **Try the live demo:** https://recallos.space-z.ai/