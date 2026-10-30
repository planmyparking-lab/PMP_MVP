export function startFlowTimer(startedAtMs: number | null, nowMs: number): number {
  return startedAtMs ?? nowMs;
}

export function resetFlowTimer(nowMs: number): number {
  return nowMs;
}

export function elapsedFlowMs(startedAtMs: number | null, nowMs: number): number {
  if (startedAtMs === null) return 0;
  return Math.max(0, nowMs - startedAtMs);
}
