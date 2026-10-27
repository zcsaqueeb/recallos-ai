import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWorkspaceUser } from "@/lib/workspace";
import { jsonNoStore } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await resolveWorkspaceUser();
    const [activities, recentDecisions, openLessons] = await Promise.all([
      db.activityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      db.decision.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 4 }),
      db.lesson.findMany({ where: { status: { in: ["PROPOSED", "SUPPORTED", "APPLIED"] } }, orderBy: { updatedAt: "desc" }, take: 4 }),
    ]);
    return jsonNoStore({ activities, recentDecisions, openLessons });
  } catch (err) {
    return jsonNoStore({ error: "DASHBOARD_FAILED", detail: (err as Error).message }, { status: 500 });
  }
}
