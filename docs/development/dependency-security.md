# Dependency security notes

`pnpm audit` runs in CI as the advisory `audit` job. Findings fixed by upgrading are not listed here.

## Accepted advisories (explicitly ignored in `package.json` > `pnpm.auditConfig.ignoreGhsas`)

| Advisory            | Package                                                 | Why accepted                                                                                                                                                                                                                        | Review when                                                                      |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GHSA-mrhx-c7xc-m3w5 | `zod` 3.25.76 (via `@expo/cli`)                         | `@expo/cli` requires zod `^3.25.76`; forcing zod 4 would break it. Memory-exhaustion on oversized input in a dev tool. Our own code uses zod 4.6.7 (patched).                                                                       | `@expo/cli` moves to zod 4                                                       |
| GHSA-gcqx-w48m-w2h4 | `deepmerge` >=4.2.0 <=4.3.1 (via `expo > @expo/config`) | No patched version exists (`Patched versions: <0.0.0`). Prototype poisoning in `mergeObject()` of a dev-time config parser on the Expo CLI/build path; the app bundle and our own code never call `deepmerge` with untrusted input. | A patched `deepmerge` (>= 4.3.2) or an Expo release without the vulnerable range |

Remove an entry from `ignoreGhsas` as soon as it can be fixed. Do not add new ignores without a row here.

## Overrides for patched versions (`package.json` > `pnpm.overrides`)

Added when new advisories (published 27 Oct 2026) made `pnpm audit` fail. Each override applies only to the vulnerable range.

| Override                              | Fixes                                                                                                                                                                    | Comes from             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `node-forge@<1.4.3` to 1.4.3          | GHSA-86w9-cpqp-85rv (previously ignored), the 27 Oct advisories, and GHSA-6889-vf6x-f3g5, GHSA-w4xr-hqv8-ch44, GHSA-6cv4-p8m7-4r25, GHSA-j8rw-jp99-435v (fixed in 1.4.3) | `expo > @expo/cli`     |
| `minimatch@>=7.0.0 <11.0.1` to 11.0.1 | GHSA-g3hv-75wg-m249 (major-version bump)                                                                                                                                 | `typescript-eslint`    |
| `glob@>=9.0.0 <14.0.2` to 14.0.2      | GHSA-3g3m-2fjr-6pw4 (major-version bump)                                                                                                                                 | `expo` config packages |

Remove an override once the parent package depends on a patched version on its own.
