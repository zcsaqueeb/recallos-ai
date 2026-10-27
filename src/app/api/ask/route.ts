import { NextResponse } from "next/server";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { runAsk, recordAskActivity } from "@/lib/ai/ask-pipeline";
import { askInputSchema } from "@/lib/validation";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, "ask"), 12, 60_000);
  if (!rl.allowed) return tooManyRequests(rl);
  try {
    const user = await resolveWorkspaceUser();
    const parsed = askInputSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    const { question, includeBlockchainEvidence, suiRef } = parsed.data;

    const result = await runAsk({
      userId: user.id,
      question,
      includeBlockchainEvidence,
      suiRef,
      baselineOnly: false,
    });

    await recordAskActivity(user.id, question, result.answer);
    return NextResponse.json(result);
  } catch (err) {
    const detail = (err as Error).message;
    return NextResponse.json(
      {
        error: "ASK_FAILED",
        detail,
        hint: detail.includes("AI provider unavailable")
          ? "The AI provider could not be reached. The answer was NOT generated; nothing was saved as a memory."
          : undefined,
      },
      { status: 502 },
    );
  }
}
