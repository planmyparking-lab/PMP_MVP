/** Prevent overlapping attempts from sharing and overwriting the same lockout snapshot. */
export function createSubmissionGuard() {
  let active = false;

  return {
    tryAcquire(): (() => void) | null {
      if (active) return null;
      active = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active = false;
      };
    },
  };
}
