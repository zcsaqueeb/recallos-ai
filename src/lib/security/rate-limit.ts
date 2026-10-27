/**
 * Simple in-memory token bucket for expensive endpoints.
 * Per-IP, process-local (documented as a dev-grade guard; production should
 * use a shared store behind real auth).
 */

type Bucket = { tokens: number; lastRefill: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: limit, lastRefill: now };
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    bucket.tokens = Math.min(limit, bucket.tokens + (elapsed / windowMs) * limit);
    bucket.lastRefill = now;
  }
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const retryAfterSec = Math.ceil(((1 - bucket.tokens) * windowMs) / limit / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSec: 0 };
}

export function clientKey(req: Request, scope: string): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "local";
  return `${scope}:${fwd.split(",")[0]?.trim() || "local"}`;
}

/** Standard 429 response for blocked requests. */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded. Expensive operations are throttled to protect provider quotas.",
      retryAfterSec: result.retryAfterSec,
    }),
    {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(result.retryAfterSec) },
    },
  );
}
