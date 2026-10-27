/**
 * DEMO FIXTURES — clearly labeled synthetic data for the guided demo.
 * Per spec §9: deterministic, never mixed with real data, never counted
 * toward Walrus mainnet verification. Every record seeded from here is
 * stored with sourceType=DEMO_FIXTURE / isDemo=true and every UI surface
 * labels it.
 */

export const DEMO_MEMORIES: Array<{
  category: string;
  content: string;
  importance: number;
  tags: string[];
}> = [
  {
    category: "PREFERENCE",
    content: "Demo preference: prefers cold storage for any holdings above $1,000 and avoids keeping funds on exchanges.",
    importance: 5,
    tags: ["demo", "security", "custody"],
  },
  {
    category: "PREFERENCE",
    content: "Demo preference: prefers TypeScript over Python for new services unless a library is Python-only.",
    importance: 4,
    tags: ["demo", "stack"],
  },
  {
    category: "CONSTRAINT",
    content: "Demo constraint: never allocate more than 5% of the portfolio to a single experimental token.",
    importance: 5,
    tags: ["demo", "risk", "allocation"],
  },
  {
    category: "GOAL",
    content: "Demo goal: ship a personal Sui-based savings dashboard by end of quarter.",
    importance: 4,
    tags: ["demo", "project", "sui"],
  },
  {
    category: "EVIDENCE_PATTERN",
    content: "Demo pattern: past swap decisions went better when on-chain liquidity depth was checked before executing.",
    importance: 4,
    tags: ["demo", "liquidity", "pattern"],
  },
  {
    category: "DECISION_SUMMARY",
    content: "Demo decision summary: switched blog hosting to a static site generator in March to cut cost and improve load time.",
    importance: 3,
    tags: ["demo", "hosting"],
  },
  {
    category: "CORRECTION",
    content: "Demo correction: earlier assumption that 'new tokens with high social buzz are safe bets' was invalidated by two failed outcomes.",
    importance: 5,
    tags: ["demo", "correction"],
  },
  {
    category: "PREFERENCE",
    content: "Demo preference: avoid leverage entirely after the March liquidation incident.",
    importance: 5,
    tags: ["demo", "risk"],
  },
];

export const DEMO_DECISIONS = [
  {
    category: "INVESTMENT",
    title: "Demo: Allocate into MEME token launch",
    question: "Should I allocate $500 into the new MEME token launch on the Sui DEX?",
    goal: "Grow speculative sleeve without breaking risk rules",
    constraints: ["Max 5% of portfolio per experimental token", "No leverage"],
    assumptions: [
      { id: "a1", text: "Launch pool liquidity will stay above $250k for the first week" },
      { id: "a2", text: "Team tokens unlock linearly, no cliff dump in month one" },
    ],
    recommendation: "Wait for the first 48h of trading data; only enter if liquidity holds and team wallet activity is stable.",
    confidence: "low",
    expectedOutcome: "Either a disciplined entry with limited downside, or a skipped trade with capital preserved.",
    evaluationCriteria: "Liquidity depth observed; team wallet transfers; position sized under 5%.",
    actualOutcome:
      "Entered after 48h with $400 (under the 5% cap). Liquidity dropped 60% on day 3; exited at -18% (-$72). No leverage used.",
    verdicts: [
      { assumptionId: "a1", verdict: "NOT_HELD", rationale: "Observed pool depth fell from ~$410k to ~$160k on day 3 (demo data)." },
      { assumptionId: "a2", verdict: "INCONCLUSIVE", rationale: "Team wallets were quiet; cannot attribute the drop to unlocks (demo data)." },
    ],
    overallVerdict: "PARTIALLY_HELD",
    lessonStatement:
      "For new token launches, a 48h liquidity check is necessary but not sufficient: depth can collapse after entry. Add an exit trigger tied to a 30% liquidity drop.",
    lessonExceptions: ["Does not apply to deep-liquidity majors", "Not validated on testnet launches"],
  },
  {
    category: "DEV_TOOLING",
    title: "Demo: Choose static site generator for blog",
    question: "Which static site generator should I use for the personal blog rebuild?",
    goal: "Lower cost and faster page loads with minimal maintenance",
    constraints: ["Prefer TypeScript ecosystem", "Budget under $10/month"],
    assumptions: [
      { id: "b1", text: "Static export will cut load time by half vs the old WordPress host" },
      { id: "b2", text: "Monthly hosting cost stays under $10" },
    ],
    recommendation: "Rebuild with a TypeScript-based static generator on a free-tier host with CDN.",
    confidence: "high",
    expectedOutcome: "Load time ~1s, monthly cost ~$0, content workflow still comfortable.",
    evaluationCriteria: "Measured LCP; invoice total; publishing friction after 30 days.",
    actualOutcome: "LCP dropped from 2.8s to 1.1s; monthly cost $0 on free tier; publishing works via git push.",
    verdicts: [
      { assumptionId: "b1", verdict: "HELD", rationale: "Measured LCP improved by ~60% (demo data)." },
      { assumptionId: "b2", verdict: "HELD", rationale: "Cost is $0, under the $10 cap." },
    ],
    overallVerdict: "HELD",
    lessonStatement:
      "For personal content sites, a TypeScript static build on a free CDN tier reliably delivers sub-1.5s LCP and near-zero cost.",
    lessonExceptions: ["Heavy dynamic content would change the tradeoff"],
  },
];

export const DEMO_LESSONS = [
  {
    statement:
      "Demo lesson: check on-chain liquidity depth AND set an exit trigger before entering new token launches — depth alone can collapse within days.",
    category: "INVESTMENT",
    status: "SUPPORTED",
    observationCount: 2,
    confidence: "MEDIUM",
    exceptions: ["Does not apply to deep-liquidity majors", "Not validated on testnet launches"],
  },
  {
    statement:
      "Demo lesson: static TypeScript builds on free CDN tiers are the default choice for personal content sites in this workspace.",
    category: "DEV_TOOLING",
    status: "APPLIED",
    observationCount: 2,
    confidence: "HIGH",
    exceptions: ["Heavy dynamic content changes the tradeoff"],
  },
];

export const DEMO_CHAIN_OBSERVATIONS = [
  {
    kind: "TRANSACTION",
    method: "sui_getTransactionBlock (DEMO FIXTURE)",
    params: { digest: "DEMO_DIGEST_9f2c…a1", options: { showEffects: true, showBalanceChanges: true } },
    result: {
      digest: "DEMO_DIGEST_9f2c…a1",
      checkpoint: "DEMO-12849201",
      balanceChanges: [
        { owner: "0xdemo…user", coinType: "0x2::sui::SUI", amount: "-1250000000" },
        { owner: "0xdemo…pool", coinType: "0x2::sui::SUI", amount: "1250000000" },
      ],
      effects: { status: "success", gasUsed: "2134000" },
    },
    sourceRef: "demo-fixture://sui/tx/DEMO_DIGEST_9f2c…a1",
  },
  {
    kind: "CHECKPOINT",
    method: "sui_getLatestCheckpointSequenceNumber (DEMO FIXTURE)",
    params: {},
    result: { sequenceNumber: "12849201", timestampMs: "1761360000000" },
    sourceRef: "demo-fixture://sui/checkpoint/latest",
  },
];
