import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { runEvalScenarios } from "@/lib/learning/scenarios";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET() {
  try {
    await resolveWorkspaceUser();
    const latest = await db.evalResult.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
    // group by run timestamp (created within 5s of the newest)
    const runs: Record<string, typeof latest> = {};
    for (const r of latest) {
      const key = new Date(r.createdAt).toISOString().slice(0, 16);
      (runs[key] ||= []).push(r);
    }
    return jsonNoStore({ latest: latest.slice(0, 12) });
  } catch (err) {
    return jsonNoStore({ error: "EVAL_GET_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, "eval"), 4, 60_000);
  if (!rl.allowed) return tooManyRequests(rl);
  try {
    const user = await resolveWorkspaceUser();
    const results = await runEvalScenarios(user.id);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: "EVAL_RUN_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}
