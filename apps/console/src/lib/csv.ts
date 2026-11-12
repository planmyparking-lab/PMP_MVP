/**
 * One quoted RFC 4180 CSV cell. Text that a spreadsheet would read as a formula (starting with `=`, `+`, `-`, `@`,
 * tab or carriage return, per OWASP "CSV Injection") is prefixed with `'` so Excel and Sheets show it as text.
 * Numbers are written as they are: they are produced by our own code, never taken from a client.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '""';
  const text =
    typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
