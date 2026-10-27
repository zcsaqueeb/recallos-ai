/**
 * Shared API response helpers.
 *
 * noStore(): every dynamic workspace API answer ships `Cache-Control: no-store`
 * so neither the browser nor any proxy/preview gateway between the app and the
 * client may serve a stale cached copy. Without it, a cached GET (e.g. of
 * /api/chainlens) can hide freshly stored observations — the dashboard tile
 * would keep showing an older checkpoint instead of the latest one.
 */
import { NextResponse } from "next/server";

export function noStoreHeaders(): HeadersInit {
  return { "cache-control": "no-store, max-age=0" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonNoStore(data: any, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...noStoreHeaders() },
  });
}
