/**
 * CON-03: only same-origin, path-only redirect targets are allowed after login.
 * Anything else (absolute URLs, protocol-relative `//host`, backslash tricks, non-strings) falls back.
 */
export function sanitizeRedirect(target: unknown, fallback = "/"): string {
  if (typeof target !== "string") return fallback;
  if (!target.startsWith("/")) return fallback;
  if (target.startsWith("//") || target.startsWith("/\\")) return fallback;
  // Backslashes and control characters are normalised or stripped by some browsers.
  for (const ch of target) {
    const code = ch.charCodeAt(0);
    if (ch === "\\" || code <= 0x1f || code === 0x7f) return fallback;
  }
  return target;
}
