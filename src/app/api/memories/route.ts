import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { writeMemory, recallMemories, parseEvidence } from "@/lib/memory/service";
import { memoryWriteSchema, parseJsonArray } from "@/lib/validation";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

const tagsSchema = z.array(z.string());

export async function GET(req: Request) {
  try {
    const user = await resolveWorkspaceUser();
    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    const category = url.searchParams.get("category");

    if (q) {
      const { memories, walrusRecallError, walrusExtra } = await recallMemories(user.id, q, {
        limit: 30,
      });
      return jsonNoStore({ memories, walrusRecallError, walrusExtra, mode: "RECALL" });
    }

    const memories = await db.memoryRecord.findMany({
      where: {
        userId: user.id,
        ...(category ? { category } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });
    return jsonNoStore({
      memories: memories.map((m) => ({
        ...m,
        tags: parseJsonArray(m.tagsJson, tagsSchema.element),
        tagsJson: undefined,
        userId: undefined,
        evidence: parseEvidence(m.evidenceJson),
        evidenceJson: undefined,
      })),
    });
  } catch (err) {
    return jsonNoStore({ error: "MEMORIES_GET_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, "memory-write"), 20, 60_000);
  if (!rl.allowed) return tooManyRequests(rl);
  try {
    const user = await resolveWorkspaceUser();
    const parsed = memoryWriteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    const result = await writeMemory({
      userId: user.id,
      category: parsed.data.category,
      content: parsed.data.content,
      importance: parsed.data.importance,
      tags: parsed.data.tags,
      decisionId: parsed.data.decisionId ?? null,
    });
    await (await import("@/lib/db")).db.activityEvent.create({
      data: {
        userId: user.id,
        kind: "MEMORY_WRITE",
        summary: `Memory written (${result.sourceType}/${result.storageState}): ${parsed.data.content.slice(0, 80)}`,
      },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "MEMORIES_POST_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}
