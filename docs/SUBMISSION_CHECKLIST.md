# RECALLOS — Submission Checklist

> Rule: nothing here is claimed "done" without a verification step. Items marked ⛔ require credentials or external accounts — complete them before submitting.

## 1. Official rules & eligibility ⛔
- [ ] Re-read the current official hackathon rules and published brief (links in the build prompt).
- [ ] Confirm dates, eligibility, team rules, and judging criteria weights; update `docs/RESEARCH.md` if anything changed.
- [ ] Confirm required submission-form fields and licenses.

## 2. Public repository
- [ ] Push to a public GitHub repository.
- [ ] Verify `.env` is NOT committed (`git check-ignore .env`), while `.env.example` IS committed.
- [ ] Verify no secrets in git history (`git log -p | grep -iE "api[_-]?key|delegate[_-]?key|seed"` — expect only placeholder mentions).
- [ ] README renders correctly (badges, tables, links to docs/).
- [ ] `docs/` complete: ARCHITECTURE, LEARNING_ENGINE, INTEGRATIONS, RESEARCH, this checklist.

## 3. Application works end-to-end
- [ ] `bun install && bun run db:push && bun run dev` boots clean on a fresh clone.
- [ ] Landing → workspace → all eight views render without console errors.
- [ ] Production path: write a memory (Walrus-verified) → ask → journal → evaluate → compare → eval suite (6/6 deterministic scenarios pass).
- [ ] `bun test` passes (evidence gates + schemas).
- [ ] `bun run lint` clean.

## 4. Walrus Memory mainnet verification ⛔ (needs credentials)
- [ ] `bun add @mysten-incubation/memwal @mysten/sui @mysten/seal @mysten/walrus ai zod`
- [ ] Set `WALRUS_MEMORY_DELEGATE_KEY`, `WALRUS_MEMORY_ACCOUNT_ID`, `WALRUS_MEMORY_SERVER_URL` (server-side only).
- [ ] Write ≥10 distinct, meaningful, non-sensitive memories via Memory Explorer.
- [ ] Confirm each shows **Walrus verified** with a job id (from `waitForRememberJob`).
- [ ] Recall them back (Memory Explorer recall mode) and confirm content matches.
- [ ] Dashboard verified-counter ≥10; local mirrors excluded from that count.
- [ ] Capture screenshots of verified writes + recall as evidence.
- [ ] If write failures occur, record the disclosed failure reason (do not fake success).

## 5. Tatum integration verification ⛔ (needs API key)
- [ ] Set `TATUM_API_KEY` (server-side only; confirm it never appears in the browser bundle/network responses).
- [ ] ChainLens: latest checkpoint (live), transaction by digest (live), balance + owned objects for a real address.
- [ ] Confirm invalid key → clear auth error; invalid input → validation error; timeouts handled.
- [ ] Re-run `bun scripts/smoke-grpc.ts` at submission time to re-verify the Sui gRPC operations against the live gateway.
- [ ] Capture screenshots of live observations with sourceRef + timestamps.
- [ ] (Optional bonus) Investigate https://ai.tatum.io/ — only claim AI Builder eligibility if a compliant integration path was actually implemented.

## 6. Video & blog
- [ ] Record a 2–3 minute walkthrough video (1280p+, dark theme, compare-diff gets 15s) against a clean production workspace.
- [ ] Publish the technically accurate blog post (problem → portable memory → Walrus integration → Tatum evidence → learning loop → visible behavior change → tests → limitations). Do **not** claim unmeasured improvements or unverified production behavior.
- [ ] Link video + blog in the README.

## 7. Submission form ⛔
- [ ] Fill every required field (repo URL, video, blog, live demo if hosted).
- [ ] State honestly in the form which parts run on real mainnet writes vs blocked states (if credentials were not obtained in time).
- [ ] Submit before the confirmed deadline; keep a receipt/screenshot of the confirmation.

## 8. Security final pass
- [ ] No seed-phrase handling anywhere; chain access is read-only.
- [ ] Secrets only in server-side env vars; `.env.example` placeholders only.
- [ ] Rate limiters active on expensive endpoints.
- [ ] Prompt-injection guards in place for memories/chain data (`src/lib/ai/prompts.ts`).
