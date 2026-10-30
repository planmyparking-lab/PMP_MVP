import { describe, expect, it } from "vitest";

import {
  createLockoutRecord,
  isLocked,
  lockRemainingMs,
  recordFailedAttempt,
} from "../src/auth/lockout";
import {
  loadPersistedLockout,
  savePersistedLockout,
  type LockoutStorage,
} from "../src/auth/pinSession";
import { createSubmissionGuard } from "../src/auth/submissionGuard";

const KEY = "gate.lockout";
const WALL_NOW = 1_900_000_000_000;
const ELAPSED_NOW = 10_000;

function memoryStorage(): LockoutStorage & {
  values: Map<string, string>;
  failures: { get: boolean; set: boolean; delete: boolean };
} {
  const values = new Map<string, string>();
  const failures = { get: false, set: false, delete: false };
  return {
    values,
    failures,
    get: async (key) => {
      if (failures.get) throw new Error("read failed");
      return values.get(key) ?? null;
    },
    set: async (key, value) => {
      if (failures.set) throw new Error("write failed");
      values.set(key, value);
    },
    delete: async (key) => {
      if (failures.delete) throw new Error("delete failed");
      values.delete(key);
    },
  };
}

describe("secure lockout storage", () => {
  it("treats only a missing first-run record as an empty state", async () => {
    const storage = memoryStorage();
    await expect(loadPersistedLockout(storage, KEY, ELAPSED_NOW, WALL_NOW)).resolves.toEqual({
      ok: true,
      value: {
        record: createLockoutRecord(),
        rollbackDetected: false,
      },
    });
  });

  it("blocks on storage read failures", async () => {
    const storage = memoryStorage();
    storage.failures.get = true;
    await expect(loadPersistedLockout(storage, KEY, ELAPSED_NOW, WALL_NOW)).resolves.toEqual({
      ok: false,
      reason: "STORAGE_UNAVAILABLE",
    });
  });

  it.each(["{not json", JSON.stringify({ failCount: 0, lockEndWallMs: null, wallSampleMs: 1 })])(
    "blocks on corrupt stored data (%s)",
    async (value) => {
      const storage = memoryStorage();
      storage.values.set(KEY, value);
      await expect(loadPersistedLockout(storage, KEY, ELAPSED_NOW, WALL_NOW)).resolves.toEqual({
        ok: false,
        reason: "CORRUPTED",
      });
    },
  );

  it("keeps three wrong attempts across restart; two further failures trigger the specified five-fail lock", async () => {
    const storage = memoryStorage();
    let record = createLockoutRecord();
    for (let i = 0; i < 3; i += 1) record = recordFailedAttempt(record, ELAPSED_NOW + i);
    await savePersistedLockout(storage, KEY, record, ELAPSED_NOW + 3, WALL_NOW);

    const restored = await loadPersistedLockout(storage, KEY, ELAPSED_NOW + 4, WALL_NOW + 1);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.record.failCount).toBe(3);

    let afterRestart = recordFailedAttempt(restored.value.record, ELAPSED_NOW + 5);
    afterRestart = recordFailedAttempt(afterRestart, ELAPSED_NOW + 6);
    expect(afterRestart.failCount).toBe(5);
    expect(afterRestart.lockEndElapsedMs).not.toBeNull();
  });

  it("persists an active lock across restart and does not extend it on another failure", async () => {
    const storage = memoryStorage();
    let record = createLockoutRecord();
    for (let i = 0; i < 5; i += 1) record = recordFailedAttempt(record, ELAPSED_NOW + i);
    const originalLockEnd = record.lockEndElapsedMs;
    record = recordFailedAttempt(record, ELAPSED_NOW + 20);
    expect(record.lockEndElapsedMs).toBe(originalLockEnd);
    if (originalLockEnd === null) throw new Error("fifth failure should establish a lock");

    await savePersistedLockout(storage, KEY, record, ELAPSED_NOW + 20, WALL_NOW);
    const restarted = await loadPersistedLockout(storage, KEY, ELAPSED_NOW + 21, WALL_NOW + 1000);
    expect(restarted.ok).toBe(true);
    if (!restarted.ok) return;
    expect(isLocked(restarted.value.record, ELAPSED_NOW + 21)).toBe(true);
    expect(lockRemainingMs(restarted.value.record, ELAPSED_NOW + 21)).toBe(
      originalLockEnd - (ELAPSED_NOW + 20) - 1000,
    );
    const failedWhileLocked = recordFailedAttempt(restarted.value.record, ELAPSED_NOW + 22);
    expect(failedWhileLocked.lockEndElapsedMs).toBe(restarted.value.record.lockEndElapsedMs);
    expect(lockRemainingMs(failedWhileLocked, ELAPSED_NOW + 22)).toBe(
      lockRemainingMs(restarted.value.record, ELAPSED_NOW + 22),
    );
  });

  it("surfaces write and delete failures instead of treating them as persisted state", async () => {
    const storage = memoryStorage();
    storage.failures.set = true;
    await expect(
      savePersistedLockout(
        storage,
        KEY,
        recordFailedAttempt(createLockoutRecord(), ELAPSED_NOW),
        ELAPSED_NOW + 1,
        WALL_NOW,
      ),
    ).rejects.toThrow("write failed");

    storage.failures.set = false;
    storage.failures.delete = true;
    await expect(
      savePersistedLockout(storage, KEY, createLockoutRecord(), ELAPSED_NOW, WALL_NOW),
    ).rejects.toThrow("delete failed");
  });

  it("verifies that a successful storage call actually persisted its value", async () => {
    const noOpWrite: LockoutStorage = {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    };
    await expect(
      savePersistedLockout(
        noOpWrite,
        KEY,
        recordFailedAttempt(createLockoutRecord(), ELAPSED_NOW),
        ELAPSED_NOW + 1,
        WALL_NOW,
      ),
    ).rejects.toThrow("Lockout state did not persist");
  });

  it("recovers after storage becomes available without clearing a previously saved count", async () => {
    const storage = memoryStorage();
    const record = recordFailedAttempt(createLockoutRecord(), ELAPSED_NOW);
    await savePersistedLockout(storage, KEY, record, ELAPSED_NOW + 1, WALL_NOW);
    storage.failures.get = true;
    expect(await loadPersistedLockout(storage, KEY, ELAPSED_NOW + 2, WALL_NOW)).toEqual({
      ok: false,
      reason: "STORAGE_UNAVAILABLE",
    });
    storage.failures.get = false;
    const recovered = await loadPersistedLockout(storage, KEY, ELAPSED_NOW + 3, WALL_NOW + 1);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(recovered.value.record.failCount).toBe(1);
  });
});

describe("PIN submission guard", () => {
  it("rejects overlapping attempts and releases after completion", () => {
    const guard = createSubmissionGuard();
    const release = guard.tryAcquire();
    expect(release).not.toBeNull();
    expect(guard.tryAcquire()).toBeNull();
    release?.();
    const next = guard.tryAcquire();
    expect(next).not.toBeNull();
    next?.();
  });
});
