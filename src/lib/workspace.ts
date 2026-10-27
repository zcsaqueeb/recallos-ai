import { db } from "@/lib/db";

/**
 * Workspace identity — SECURITY BOUNDARY (honest, sandbox-grade):
 *
 * This build runs as a single local workspace. The user is resolved
 * SERVER-SIDE only; the client can never supply or switch an account
 * identifier. All queries filter by this server-resolved id.
 *
 * Production path (documented in docs/ARCHITECTURE.md): replace this with
 * NextAuth session resolution + row-level ownership checks. Do NOT accept a
 * client-provided user id as authorization.
 */
export async function resolveWorkspaceUser(): Promise<{ id: string; displayName: string }> {
  const handle = "local-workspace";
  const existing = await db.workspaceUser.findUnique({ where: { handle } });
  if (existing) return { id: existing.id, displayName: existing.displayName };
  const created = await db.workspaceUser.create({
    data: { handle, displayName: "Local Workspace" },
  });
  return { id: created.id, displayName: created.displayName };
}
