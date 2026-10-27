import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { promoteLesson, rejectLesson, markLessonApplied, gateForPromotion } from "@/lib/learning/engine";
import { lessonActionSchema, parseJsonArray, evidenceRefSchema } from "@/lib/validation";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

const supportingSchema = z.array(z.string());
const exceptionsSchema = z.array(z.string());

export async function GET() {
  try {
    await resolveWorkspaceUser();
    const lessons = await db.lesson.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
    return jsonNoStore({
      lessons: lessons.map((l) => ({
        ...l,
        supportingDecisions: parseJsonArray(l.supportingDecisionsJson, supportingSchema.element),
        evidence: parseJsonArray(l.evidenceJson, evidenceRefSchema),
        exceptions: parseJsonArray(l.exceptionsJson, exceptionsSchema.element),
        gate: gateForPromotion(l),
        supportingDecisionsJson: undefined,
        evidenceJson: undefined,
        exceptionsJson: undefined,
      })),
    });
  } catch (err) {
    return jsonNoStore({ error: "LESSONS_GET_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, "lessons"), 20, 60_000);
  if (!rl.allowed) return tooManyRequests(rl);
  try {
    await resolveWorkspaceUser();
    const parsed = lessonActionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
    }
    const { lessonId, action } = parsed.data;
    if (action === "promote") {
      const result = await promoteLesson(lessonId);
      if (!result.ok) {
        // The gate is the gate — the UI tells the user exactly why promotion was refused.
        return NextResponse.json(
          { error: "PROMOTION_BLOCKED_BY_EVIDENCE_GATE", reasons: result.reasons },
          { status: 409 },
        );
      }
      await db.activityEvent.create({ data: { kind: "LESSON_PROMOTED", summary: `Lesson ${lessonId} promoted to SUPPORTED (evidence gate passed)` } });
      return NextResponse.json({ ok: true, status: "SUPPORTED" });
    }
    if (action === "apply") {
      await markLessonApplied(lessonId);
      await db.activityEvent.create({ data: { kind: "LESSON_APPLIED", summary: `Lesson ${lessonId} marked APPLIED` } });
      return NextResponse.json({ ok: true, status: "APPLIED" });
    }
    if (action === "reject") {
      await rejectLesson(lessonId);
      return NextResponse.json({ ok: true, status: "REJECTED" });
    }
    // reevaluate: clear the demotion by keeping history; user explicitly re-opens review
    const lesson = await db.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) return NextResponse.json({ error: "LESSON_NOT_FOUND" }, { status: 404 });
    await db.lesson.update({ where: { id: lessonId }, data: { status: "PROPOSED", reevaluatedAt: new Date() } });
    return NextResponse.json({ ok: true, status: "PROPOSED" });
  } catch (err) {
    return NextResponse.json({ error: "LESSONS_POST_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}
