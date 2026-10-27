# RECALLOS — Research Notes (verified 2026-10-25)

## Confirmed requirements & sources

| Topic | Finding | Source |
|---|---|---|
| Walrus Memory | Portable memory layer for AI agents; Remember/Recall/Analyze/Ask; memory scoped to a memory space; namespaces; indexer rebuilds from blobs per owner + namespace; onchain ownership + delegate keys via Sui contract | docs.wal.app/walrus-memory |
| Walrus Memory SDK | `@mysten-incubation/memwal`; `MemWal.create({key, accountId, serverUrl, namespace})`; `remember(text) → job`, `waitForRememberJob(job_id)`, `recall({query})`, `restore(namespace)`; peer deps `@mysten/sui @mysten/seal @mysten/walrus ai zod` | github.com/MystenLabs/MemWal README |
| Tatum Sui gateway | `https://sui-mainnet-grpc.gateway.tatum.io` (Protocol Buffers over HTTP/2, TLS 443; testnet/devnet: `sui-{net}-grpc.gateway.tatum.io`); auth via gRPC metadata `x-api-key`; services `LedgerService`/`StateService` from the official `sui/rpc/v2` protos | tatum.io/chain/sui, docs.tatum.io/reference/sui-grpc, github.com/MystenLabs/sui-apis |
| Sui JSON-RPC retirement | The Sui Foundation deprecated legacy JSON-RPC across the ecosystem in favor of gRPC and GraphQL; Tatum transitioned its Sui infra to the dedicated gRPC gateway (verified live: `GetServiceInfo`, `GetCheckpoint(latest)`, `GetTransaction`, `GetBalance`, `ListBalances`, `ListOwnedObjects` return real mainnet data in 47–220 ms). Protos vendored at `vendor/sui-grpc-proto/` | docs.sui.io/references/fullnode-protocol, docs.tatum.io/reference/sui-grpc |
| Hackathon specifics | Dates, prizes, judging weights, submission form fields are **provisional** until confirmed from the official brief/rules — treat the build prompt's references as pointers, not facts | to be verified by the submitter |

## Architecture decisions (and why)

1. **Next.js 16 App Router, single-page workspace.** The product is an interactive research workspace; a single shell with client-side views keeps state (status, workspace) coherent while API routes stay thin and independently testable.
2. **SQLite via Prisma for application state.** Zero-ops, transactional, and sufficient for the app's scale; the schema keeps JSON columns as validated strings (SQLite-safe) and all state is swappable to Postgres by datasource change.
3. **Walrus SDK via dynamic import.** The SDK is the real integration path, but it is a heavy optional dependency; dynamic import lets the app boot and *honestly* report "SDK not installed" rather than breaking, while the same code path activates the moment it is installed and credentials exist.
4. **Local mirror + explicit storage states.** Every memory is persisted locally first (`LOCAL_MIRROR/PENDING_SYNC`) and upgraded to `WALRUS/VERIFIED` only after `waitForRememberJob` confirms. This is what makes "never report persistence until confirmed" mechanically enforceable rather than aspirational.
5. **Deterministic recall scoring + optional semantic merge.** Keyword/category scoring is reproducible and testable with no external dependency; Walrus semantic recall augments it when configured. Conflicts are flagged, never resolved silently.
6. **Server-enforced evidence gates.** Lesson promotion is a pure function of recorded evidence (≥2 observations, ≥1 OUTCOME evidence, 0 contradictions), unit-tested, with refusal reasons surfaced in the UI.
7. **AI as a draft-and-adjudicate assistant, never an authority.** The model drafts lessons (always tentative at n=1), classifies support/contradiction, and separates claims — but gates, confidence, and counters are computed from evidence.
8. **Single server-resolved workspace identity.** The sandbox has no identity provider; accepting a client-supplied user id would violate the security requirement, so identity is resolved server-side and the production auth path is documented as the primary delta.

## Required credentials checklist

- [ ] `WALRUS_MEMORY_DELEGATE_KEY` — from Walrus Memory dashboard (delegate key hex)
- [ ] `WALRUS_MEMORY_ACCOUNT_ID` — Walrus Memory account id
- [ ] `WALRUS_MEMORY_SERVER_URL` — relayer URL
- [ ] `TATUM_API_KEY` — api.tatum.io key (free tier: 100k credits)
- [ ] Optional: `TATUM_SUI_NETWORK` (mainnet default), `WALRUS_MEMORY_NAMESPACE` (recallos default)

## Limitations & open verification items

- [ ] Re-verify Walrus SDK response shapes (recall normalization is defensive; adjust to the installed version).
- [ ] Re-verify Tatum Sui method surface via `/_methods` at submission time.
- [ ] Confirm hackathon judging criteria weights and adjust documentation emphasis if needed.
- [ ] Mainnet acceptance test (≥10 verified writes + recall match) requires the credentials above; the in-app checklist enforces the procedure.
- [ ] Bonus: Tatum AI Builder (https://ai.tatum.io/) requirements were not verified in this environment; core build prioritized per the spec.
