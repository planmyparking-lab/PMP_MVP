// Retry delay for the upload outbox (SYNC-02): min(2 s * 2^attempt, 5 min) with +/-20% jitter.
export const BASE_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 5 * 60_000;
export const JITTER = 0.2;

// attempt 0 is the first retry after a failure. `random` returns a number in [0, 1) and is injectable for tests.
export function nextDelay(attempt: number, random: () => number = Math.random): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError("attempt must be a non-negative integer");
  }
  // Cap the exponent first so a huge attempt count cannot overflow to Infinity.
  const base = Math.min(BASE_DELAY_MS * 2 ** Math.min(attempt, 20), MAX_DELAY_MS);
  const factor = 1 + (random() * 2 - 1) * JITTER;
  return Math.round(base * factor);
}
