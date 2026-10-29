import { createHash, timingSafeEqual } from "node:crypto";

/**
 * CON-08 report route protection: shared-secret comparison and a small fixed-window rate limiter.
 *
 * The signed-in manager path (sheet C8) needs CON-03 sessions and RLS policies, which do not exist yet, so it
 * is NOT implemented: without the secret a request is refused.
 */
export const REPORT_SECRET_HEADER = "x-report-secret";

/** Constant-time comparison. Both sides are hashed first so the length of the secret is not revealed either. */
export function secretMatches(supplied: string | null, expected: string | undefined): boolean {
  if (!expected || !supplied) return false;
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface RateLimiter {
  /** Returns false when `key` has used up its allowance in the current window. */
  allow(key: string, now?: number): boolean;
}

/**
 * Per-process fixed window. On a serverless host each instance keeps its own counts, so this slows a
 * hammering client rather than guaranteeing a global limit; a shared limiter (T-CON-08-N2) needs a store
 * Akanksha would provide.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(key, now = Date.now()) {
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        if (windows.size > 5000) {
          for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
        }
        return true;
      }
      w.count += 1;
      return w.count <= limit;
    },
  };
}
