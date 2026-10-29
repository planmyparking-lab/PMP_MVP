/** Returned when neither the requested target nor the supplied fallback is a safe path. */
export const SAFE_DEFAULT_REDIRECT = "/";

/**
 * True only for a same-origin, path-only value: starts with a single `/`, and has no backslash or
 * control character (browsers strip or normalise those, so `/\t/evil.com` would become `//evil.com`).
 */
function isSafePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === "\\" || code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

/**
 * CON-03: only same-origin, path-only redirect targets are allowed after login.
 * An unsafe target (absolute URL, protocol-relative `//host`, backslash or control characters,
 * non-string) gives `fallback`. The fallback is validated by the same rules, so a bad fallback can never
 * be returned either; if both are unsafe the result is {@link SAFE_DEFAULT_REDIRECT}.
 */
export function sanitizeRedirect(
  target: unknown,
  fallback: unknown = SAFE_DEFAULT_REDIRECT,
): string {
  if (isSafePath(target)) return target;
  if (isSafePath(fallback)) return fallback;
  return SAFE_DEFAULT_REDIRECT;
}
