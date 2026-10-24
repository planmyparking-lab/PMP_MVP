# @pmp/contracts (SYNC-01, owner: Afzal)

Single source of truth for event shapes, money helpers, reason codes and `SCHEMA_VERSION`
(integration contract IC-01, see `docs/team/README.md`).

**Shared-package rule:** changes need review from another workstream owner; breaking changes
require a `SCHEMA_VERSION` bump.

**Status:** baseline. `ENTRY`, `EXIT`, `PAYMENT`, `OVERRIDE` carry the fields named in
`docs/team/member-01-afzal.md`; `ZONE_COUNT`, `SHIFT_OPEN`, `SHIFT_CLOSE` currently validate only the
common envelope. Their payloads are to be completed by the owner (open item, not invented here).
