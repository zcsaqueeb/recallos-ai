# RECALLOS — 2-Minute Demo Script (LIVE build)

**Setup before recording (5 min):**
- Dev server running (`bun run dev`), `.env` loaded (Tatum key + MemWal delegate key).
- One fresh memory written a few minutes earlier (Memory → *Write memory*) so the Dashboard proof strip shows a recent certification.
- Two browser tabs pre-opened behind the app: one WalrusCan blob page, one aggregator read — you will open them live instead; tabs are just insurance.
- Optional second display / split screen: app on the left, explorer on the right. Seeing the chain and the app together is the whole trick.

---

### 0:00 — The thesis (Landing)
Open the app. Tagline: *"Your AI doesn't just remember your past. It learns from it."*
Say: "Most AI assistants forget, or fake memory by replaying chat logs. RECALLOS stores **why** you decided, keeps that memory on Walrus — you own it, on-chain — and turns what actually happened into lessons that visibly change future advice. Everything you're about to see is live on mainnet. Watch for the receipts."

### 0:15 — The receipt, first (Dashboard)
Click **Enter the workspace**. The counters card shows `N Walrus-verified` and the footer line "N memories confirmed by the real Walrus Memory integration."
Say: "This is not a mock. These counters only move when the Walrus Memory integration confirms a real write — nothing is simulated. Let me write one, live, and show you its on-chain certification."

### 0:35 — Write → certify → read it back (Memory)
Go to **Memory** → **Write memory**. Type something with the judge's own words in it — e.g. *"The judge prefers demos where every claim is independently checkable."* Submit.
The dialog polls and flips to **WALRUS / VERIFIED** with a green panel: blob id + **Read blob from aggregator ↗** + **On-chain proof ↗**.
Click **Read blob from aggregator ↗** → raw bytes appear. (For relayer writes this is ciphertext — say so: "encrypted end-to-end; the chain proves existence and integrity, only your key can read the content.")
Say: "Written through the MemWal relayer, certified on-chain in seconds, and anyone can read the blob from any public aggregator — no API key, no trust in me. And if a write ever fails, the record honestly says PENDING, never VERIFIED."

### 1:00 — Memory changing an answer (Ask)
Go to **Ask**. Run the suggested question (e.g. keeping funds on an exchange). Point at the **Memories recalled** panel:
- each cited memory carries its source badge — the verified ones carry a **Walrus proof ↗** chip,
- each carries an **Influence** note: exactly which memory moved which sentence.
Say: "Same model as any chatbot — but your preferences, constraints, and lessons are in the loop, and the answer shows its sources with on-chain proof."

### 1:20 — From outcomes to lessons, with a gate (Journal)
Open **Journal** → *Demo: Allocate into MEME token launch*. Show the evaluated outcome: assumption 1 **NOT HELD**, assumption 2 **INCONCLUSIVE** ("thin evidence gives INCONCLUSIVE, not a guess").
Say: "That evaluation drafted a tentative lesson. It needs **two independent observations and zero contradictions** before promotion — the LLM cannot talk a lesson into being supported."

### 1:40 — Proof of change (Learning Lab)
Open **Learning Lab** → run **Baseline vs memory-informed** on a fresh question. Show `changed: true`: baseline gives generic due-diligence advice; the memory-informed answer adopts your recorded constraints — with the exact memories and the applied lesson listed as the cause.
Say: "The delta between the two answers is caused by memories you just saw certified on-chain. That's the loop: observe, remember, recommend, verify, learn — with receipts at every step."

### 2:00 — Close
Back to the Dashboard. Say: "RECALLOS — memory that changes behavior, visibly, and every claim is one click from its Walrus certification. The badges stay honest: if the chain didn't confirm it, the app won't claim it."

---

## Fallback plans (rehearse once)

| Failure | Move |
|---|---|
| Relayer write hangs > 20 s | The write transparently fails over to the Tatum Storage API — the dialog still reaches VERIFIED; the evidence line reads "Transport direct upload". Say: "dual transports, automatic failover." |
| Both transports fail | Dialog honestly shows PENDING_SYNC + the reason. Say: "this is the honesty feature working — no fake green badges," then use the pre-written memory's proof strip. |
| WalrusCan slow | Use the pre-opened tab; or click **Read blob ↗** only (aggregator is a plain GET). |
| AI answer slow | The trace streams "Recalling memories → checking evidence → composing recommendation…" — narrate the pipeline while it runs. |

## One-liner if you get cut off
"Every memory RECALLOS writes is certified on Walrus mainnet, independently verifiable in one click, and measurably changes the AI's advice — with an honesty model that refuses to fake any of it."
