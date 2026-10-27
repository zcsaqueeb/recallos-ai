import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { decisionInputSchema, parseJsonArray, assumptionVerdictSchema, assumptionSchema, evidenceRefSchema, constraintTextSchema } from "@/lib/validation";
import { jsonNoStore } from "@/lib/http";
import { writeMemory } from "@/lib/memory/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await resolveWorkspaceUser();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const decisions = await db.decision.findMany({
      where: { userId: user.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return jsonNoStore({
      decisions: decisions.map((d) => ({
        ...d,
        constraints: parseJsonArray(d.constraintsJson, constraintTextSchema),
        assumptions: parseJsonArray(d.assumptionsJson, assumptionSchema),
        evidenceRefs: parseJsonArray(d.evidenceRefsJson, evidenceRefSchema),
        verdicts: parseJsonArray(d.verdictsJson, assumptionVerdictSchema),
        constraintsJson: undefined,
        assumptionsJson: undefined,
        evidenceRefsJson: undefined,
        verdictsJson: undefined,
        userId: undefined,
      })),
    });
  } catch (err) {
    return jsonNoStore({ error: "DECISIONS_GET_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await resolveWorkspaceUser();
    const body = await req.json();
    const parsed = decisionInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const decision = await db.decision.create({
      data: {
        userId: user.id,
        category: input.category,
        title: input.title,
        question: input.question,
        goal: input.goal,
        constraintsJson: JSON.stringify(input.constraints),
        assumptionsJson: JSON.stringify(input.assumptions),
        evidenceRefsJson: JSON.stringify(input.evidenceRefs),
        recommendation: input.recommendation,
        confidence: input.confidence,
        expectedOutcome: input.expectedOutcome,
        evaluationCriteria: input.evaluationCriteria,
        reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
        status: "ACTIVE",
      },
    });

    // Durable memory: a compact decision summary goes through the write policy.
    const memoryResult = await writeMemory({
      userId: user.id,
      category: "DECISION_SUMMARY",
      content: `Decision "${input.title}" (${input.category}): ${input.question.slice(0, 160)} → chose: ${input.recommendation.slice(0, 200)} (confidence: ${input.confidence}, qualitative)`,
      importance: 4,
      tags: ["decision", input.category.toLowerCase()],
      decisionId: decision.id,
    });

    await db.activityEvent.create({
      data: { userId: user.id, kind: "DECISION_CREATED", summary: `Decision recorded: ${input.title}` },
    });

    return NextResponse.json({ decision, memoryResult }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "DECISIONS_POST_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}
