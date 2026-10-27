/**
 * Client-side API fetch helper — the single hardened gateway for every
 * workspace panel.
 *
 * Why it exists: the app is served behind a preview gateway. When a long
 * request is cut short (gateway timeout) or the server restarts mid-request,
 * the gateway answers with an HTML error page instead of JSON. Panels that
 * called `res.json()` directly surfaced the raw parser failure to users:
 *   "Unexpected token '<', \"<html> <h\"... is not valid JSON"
 *
 * apiFetch never hands a non-JSON body to JSON.parse and turns every failure
 * mode into an honest, human-readable message:
 *   - network failure        → "Could not reach the server…"
 *   - HTML/proxy error page  → "The server responded with an error page (HTTP 502)…"
 *   - malformed JSON         → "The server response was malformed…"
 *   - non-2xx JSON body      → the server's own detail/error/issues/reasons
 *
 * On non-2xx JSON responses the parsed body is attached to the ApiError
 * (`error.body`) so callers that need structured payloads (validation
 * `issues`, lesson-gate `reasons`, ChainLens ERROR results) keep working.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function joinStrings(v: unknown): string | null {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string") ? (v as string[]).join("; ") : null;
}

/** Extract the most useful message from a structured JSON error body. */
function messageFromBody(body: Record<string, unknown>): string | null {
  if (typeof body.detail === "string" && body.detail) return body.detail;
  if (typeof body.error === "string" && body.error && body.error !== "VALIDATION_FAILED" && body.error !== "INVALID_INPUT") return body.error;
  return joinStrings(body.issues) ?? joinStrings(body.reasons);
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // fetch() rejects on network failure / DNS / aborted connections.
    throw new ApiError("Could not reach the server — check your connection and try again.", 0);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  // Gateway/CDN error pages arrive as HTML — never hand them to JSON.parse.
  if (!isJson) {
    let text = "";
    try {
      text = (await res.text()).slice(0, 300);
    } catch {
      // body unreadable — status is still enough for the message
    }
    const slow =
      res.status === 502 || res.status === 504 || /gateway|timed? ?out|bad ?gateway|proxy/i.test(text)
        ? " The request may have taken too long — please try again."
        : "";
    throw new ApiError(
      `The server responded with an unexpected error page (HTTP ${res.status}).${slow}`,
      res.status,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`The server response was malformed (HTTP ${res.status}). Please try again.`, res.status);
  }

  if (!res.ok) {
    const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
    throw new ApiError(messageFromBody(record) ?? `Request failed (HTTP ${res.status}).`, res.status, body);
  }

  return body as T;
}

/** Narrow an unknown caught value to an ApiError. */
export function asApiError(e: unknown): ApiError | null {
  return e instanceof ApiError ? e : null;
}
