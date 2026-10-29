# Dependency security notes

`pnpm audit` runs in CI as the advisory `audit` job. Findings fixed by upgrading are not listed here.

## Accepted advisories (explicitly ignored in `package.json` > `pnpm.auditConfig.ignoreGhsas`)

| Advisory            | Package                                                 | Why accepted                                                                                                                                                                                                                        | Review when                                                                      |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GHSA-86w9-cpqp-85rv | `node-forge` 1.4.0 (via `expo > @expo/cli`)             | No patched version exists. Used by the Expo CLI on a developer machine (dev server / signing helpers), not shipped in the app bundle.                                                                                               | A patched `node-forge` or a newer `@expo/cli` is released                        |
| GHSA-mrhx-c7xc-m3w5 | `zod` 3.25.76 (via `@expo/cli`)                         | `@expo/cli` requires zod `^3.25.76`; forcing zod 4 would break it. Memory-exhaustion on oversized input in a dev tool. Our own code uses zod 4.6.7 (patched).                                                                       | `@expo/cli` moves to zod 4                                                       |
| GHSA-gcqx-w48m-w2h4 | `deepmerge` >=4.2.0 <=4.3.1 (via `expo > @expo/config`) | No patched version exists (`Patched versions: <0.0.0`). Prototype poisoning in `mergeObject()` of a dev-time config parser on the Expo CLI/build path; the app bundle and our own code never call `deepmerge` with untrusted input. | A patched `deepmerge` (>= 4.3.2) or an Expo release without the vulnerable range |

Remove an entry from `ignoreGhsas` as soon as it can be fixed. Do not add new ignores without a row here.
