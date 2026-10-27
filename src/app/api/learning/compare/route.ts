import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { runAsk, recordAskActivity } from "@/lib/ai/ask-pipeline";
import { compareInputSchema } from "@/lib/validation";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

/**
 * Baseline vs personalized comparison (spec §5).
 * Both runs execute on the same model with the same question; the only
 * difference is access to recalled memories/lessons. The response discloses
 * that this is a controlled comparison, and which memories caused each diff.
 */
export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, "compare"), 6, 60_000);
  if (!rl.allowed) return tooManyRequests(rl);
  try {
    const user = await resolveWorkspaceUser();
    const parsed = compareInputSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
    }
    const question = parsed.data.question;

    const [baseline, personalized] = await Promise.all([
      runAsk({ userId: user.id, question, includeBlockchainEvidence: false, baselineOnly: true }),
      runAsk({ userId: user.id, question, includeBlockchainEvidence: false, baselineOnly: false }),
    ]);

    const changed =
      baseline.answer.recommendation.trim() !== personalized.answer.recommendation.trim() ||
      personalized.answer.memoriesUsed.length > 0 ||
      personalized.answer.lessonsApplied.length > 0;

    await db.activityEvent.create({
      data: {
        userId: user.id,
        kind: "COMPARE_RUN",
        summary: `Baseline vs personalized comparison (${changed ? "changed" : "no change"}): ${question.slice(0, 90)}`,
        metaJson: JSON.stringify({ memoriesUsed: personalized.answer.memoriesUsed.length, lessonsApplied: personalized.answer.lessonsApplied.length }),
      },
    });
    await recordAskActivity(user.id, question, personalized.answer);

    return NextResponse.json({
      question,
      baseline: baseline.answer,
      personalized: personalized.answer,
      personalizedTrace: { recalled: personalized.trace.recalled, conflicts: personalized.trace.conflicts, recallError: personalized.trace.recallError },
      changed,
      disclosure: [
        "Controlled comparison: both runs use the same model and the same question; only memory context differs.",
        "Personalized run used the workspace's real memories.",
        changed
          ? "The recommendations differ — see which memories/lessons caused the change."
          : "No difference detected for this question — memory did not (and should not) force a change.",
      ],
    });
  } catch (err) {
    return NextResponse.json({ error: "COMPARE_FAILED", detail: (err as Error).message }, { status: 502 });
  }
}
