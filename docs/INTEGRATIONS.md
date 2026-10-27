# RECALLOS — Integrations

Real integration details, authentication, supported methods, and verification procedures.

---

## 1. Walrus Memory (persistent, portable, onchain-owned memory)

**What it is:** a memory layer for AI agents built on Walrus storage, where ownership and delegate access are enforced onchain via a Sui smart contract. Memory is portable across apps and sessions, and the indexer can rebuild from blobs per owner + namespace.

**Verified sources** (checked 2026-10):
- Docs: https://docs.wal.app/walrus-memory (Remember / Recall / Analyze / Ask; namespaces; delegate access)
- SDK: https://github.com/MystenLabs/MemWal — package `@mysten-incubation/memwal`
- API reference: https://memory.walrus.xyz/docs/sdk-api-reference

### How RECALLOS integrates it

```ts
import { MemWal } from "@mysten-incubation/memwal";

const memwal = MemWal.create({
  key: process.env.WALRUS_MEMORY_DELEGATE_KEY,  // delegate key (hex)
  accountId: process.env.WALRUS_MEMORY_ACCOUNT_ID,
  serverUrl: process.env.WALRUS_MEMORY_SERVER_URL, // relayer URL
  namespace: process.env.WALRUS_MEMORY_NAMESPACE ?? "recallos",
});

const job = await memwal.remember(text);       // enqueue write
await memwal.waitForRememberJob(job.job_id);   // confirmation
const found = await memwal.recall({ query });  // semantic recall
```

- The SDK is loaded via **dynamic import** so the app boots (honestly reporting "SDK not installed") when the optional dependency is absent.
- A memory becomes `WALRUS / VERIFIED` **only** after `waitForRememberJob` completes; otherwise it stays `LOCAL_MIRROR / PENDING_SYNC` and the UI says so.
- Recall merges real Walrus results into the scored local results, deduplicated by content, each carrying provenance.

### Environment variables

| Variable | Meaning |
|---|---|
| `WALRUS_MEMORY_DELEGATE_KEY` | Delegate key granting RECALLOS scoped access (create in the Walrus Memory dashboard) |
| `WALRUS_MEMORY_ACCOUNT_ID` | Your Walrus Memory account id |
| `WALRUS_MEMORY_SERVER_URL` | Relayer service URL |
| `WALRUS_MEMORY_NAMESPACE` | Namespace (default `recallos`) |

### Verification procedure (mainnet acceptance test)

1. Configure the four env vars and `bun add @mysten-incubation/memwal @mysten/sui @mysten/seal @mysten/walrus ai zod`.
2. Settings → Walrus shows *Configured* (real check of env + SDK presence — no fabricated status).
3. Write **≥10 distinct, meaningful, non-sensitive** memories via Memory Explorer → *Write memory*.
4. Each confirmed write renders "Walrus verified" plus the Walrus job id; unconfirmed writes explicitly show the failure reason.
5. Memory Explorer → recall mode → confirm recalled content matches what was written.
6. Dashboard counters split verified vs mirror — the mainnet requirement counts only the verified bucket.
7. Activity log retains per-write/per-recall evidence (ids + timestamps).

If credentials are unavailable, the app keeps reporting *blocked: credentials required* — it never seeds a real account with synthetic data or counts fixtures toward the requirement.

---

## 2. Tatum (Sui blockchain data)

**Verified sources** (checked 2026-10):
- Sui chain page: https://tatum.io/chain/sui
- Sui gRPC reference: https://docs.tatum.io/reference/sui-grpc (endpoint, auth, services, grpcurl quickstart)
- Proto contracts: https://github.com/MystenLabs/sui-apis (`sui/rpc/v2/*.proto`)

### Interface

- Gateway: `https://sui-mainnet-grpc.gateway.tatum.io` (testnet: `sui-testnet-grpc…`, devnet: `sui-devnet-grpc…`)
- Auth: gRPC metadata `x-api-key: <TATUM_API_KEY>` (server-side only)
- Protocol: **Sui gRPC — Protocol Buffers over HTTP/2 (TLS, port 443)**
  - The Sui Foundation deprecated legacy JSON-RPC across the ecosystem in favor of gRPC and GraphQL, and Tatum transitioned its Sui infrastructure to the dedicated Sui gRPC gateway (https://docs.tatum.io/reference/sui-grpc).
  - Proto contracts: the official `sui/rpc/v2` protos (MystenLabs/sui-apis) are **vendored at `vendor/sui-grpc-proto/`** and loaded at runtime by `@grpc/grpc-js` + `@grpc/proto-loader` (both kept external to the Next.js bundle; the proto tree ships via `outputFileTracingIncludes`).
  - All operations below were live-verified with real mainnet responses (47–220 ms per call; see `scripts/smoke-grpc.ts`).

### Operations used by RECALLOS

| Observation | gRPC operation | Notes |
|---|---|---|
| Latest checkpoint | `LedgerService.GetCheckpoint` with no `checkpoint_id` (+ `read_mask` `sequence_number,digest,summary.epoch,summary.timestamp`) | no id = latest |
| Chain info / probe | `LedgerService.GetServiceInfo` | chainId (genesis digest), chain, epoch, checkpoint height |
| Transaction | `LedgerService.GetTransaction { digest }` (+ `read_mask` for sender/status/timestamp/balance_changes) | `NOT_FOUND` if digest unknown |
| Address balance | `StateService.GetBalance { owner, coinType: "0x2::sui::SUI" }` + `ListBalances { owner, pageSize: 12 }` | SUI + all coin types |
| Owned objects | `StateService.ListOwnedObjects { owner, pageSize: 10 }` (+ `read_mask`) | first page, 10 items |

The client **records the exact operation + parameters used** on every stored observation (provenance is auditable; `sourceRef` prefix `tatum:sui-grpc:`). Proto field masks use canonical snake_case paths; proto-loader's `_field` oneof mirror keys are stripped before anything is stored.

### Error handling

- Invalid credentials → clear `TATUM_AUTH_FAILED` (gRPC `UNAUTHENTICATED`/`PERMISSION_DENIED`; never silently retried)
- Rate limits → `TATUM_RATE_LIMITED` (gRPC `RESOURCE_EXHAUSTED`; surfaced; client-side buckets also protect the quota)
- Timeouts → hard gRPC deadline at 12 s (configurable `TATUM_TIMEOUT_MS`)
- Invalid input → Zod-level rejection before any network call (digest/address format checks)

### Facts vs interpretation

Every ChainLens result is stored raw with method + params + sourceRef and rendered with the standing note: *activity on-chain does not prove quality, legitimacy, or future performance*. When Tatum is unconfigured, queries fail with `NOT_CONFIGURED` and the UI shows a guided "add a key" panel — synthetic chain data is never generated or stored.

---

## 3. AI provider (server-side)

`z-ai-web-dev-sdk` is used **exclusively in backend code** (`src/lib/ai/*`). Outputs are schema-validated with Zod (one corrective retry on malformed JSON). All untrusted context (memories, chain data) is delimiter-wrapped with explicit "data, not instructions" guards, and system rules re-assert: never invent blockchain results; keep facts/assumptions/inferences/unknowns separate; always give an actionable recommendation with uncertainty.
