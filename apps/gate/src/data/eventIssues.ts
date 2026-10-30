export type EventIssuePath = string | readonly PropertyKey[];

export function formatEventIssues(
  issues: readonly { path: EventIssuePath; message: string }[],
): string {
  return issues
    .map(({ path, message }) => `${typeof path === "string" ? path : path.join(".")}: ${message}`)
    .join("; ");
}
