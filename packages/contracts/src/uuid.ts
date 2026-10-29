/**
 * UUIDv7 (RFC 9562) generation and check. Ids are created on the device so events can be written offline.
 * Layout: 48-bit unix ms | version 7 | 12-bit counter | variant 10 | 62 random bits.
 * The counter keeps ids created within the same millisecond in generation order.
 *
 * Needs a secure random source: `globalThis.crypto.getRandomValues` (Node 22, browsers). React Native
 * must provide it (for example `react-native-get-random-values`) before the first call; otherwise
 * newId() throws a clear error instead of falling back to Math.random.
 */
export interface IdDeps {
  now?: () => number;
  random?: (length: number) => Uint8Array;
}

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && V7_RE.test(value);
}

function defaultRandom(length: number): Uint8Array {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) {
    throw new Error(
      "No secure random source: provide crypto.getRandomValues (see packages/contracts/src/uuid.ts)",
    );
  }
  return c.getRandomValues(new Uint8Array(length));
}

export function createIdGenerator(deps: IdDeps = {}): () => string {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? defaultRandom;
  let lastMs = -1;
  let counter = 0;

  return function nextId(): string {
    let ms = Math.floor(now());
    if (!Number.isSafeInteger(ms) || ms < 0 || ms >= 2 ** 48)
      throw new RangeError("Clock out of range");
    if (ms <= lastMs) {
      // Same millisecond (or clock stepped back): keep ordering by advancing the counter.
      ms = lastMs;
      counter += 1;
      if (counter > 0xfff) {
        ms += 1;
        counter = 0;
      }
    } else {
      const r = random(2);
      counter = (((r[0] ?? 0) << 8) | (r[1] ?? 0)) & 0x7ff; // start low to leave headroom
    }
    lastMs = ms;

    const rnd = random(8);
    const b = new Uint8Array(16);
    let t = ms;
    for (let i = 5; i >= 0; i--) {
      b[i] = t % 256;
      t = Math.floor(t / 256);
    }
    b[6] = 0x70 | ((counter >> 8) & 0x0f);
    b[7] = counter & 0xff;
    b[8] = 0x80 | ((rnd[0] ?? 0) & 0x3f);
    for (let i = 1; i < 8; i++) b[8 + i] = rnd[i] ?? 0;

    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** Default generator: one UUIDv7 per call. */
export const newId: () => string = createIdGenerator();
