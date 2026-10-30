export type AppErrorBoundaryState = { hasError: boolean };

export function stateAfterAppError(): AppErrorBoundaryState {
  return { hasError: true };
}

export function stateAfterAppErrorRetry(): AppErrorBoundaryState {
  return { hasError: false };
}
