import { NextResponse } from "next/server";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { evaluateDecisionOutcome } from "@/lib/learning/engine";
import { evaluateDecisionInputSchema } from "@/lib/validation";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, "evaluate"), 10, 60_000);
  if (!rl.allowed) return tooManyRequests(rl);
  try {
    const user = await resolveWorkspaceUser();
    const parsed = evaluateDecisionInputSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    const result = await evaluateDecisionOutcome({
      userId: user.id,
      decisionId: parsed.data.decisionId,
      actualOutcome: parsed.data.actualOutcome,
      evidenceSummary: parsed.data.evidenceSummary,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = (err as Error).message;
    const status = message === "DECISION_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: "EVALUATE_FAILED", detail: message }, { status });
  }
}
