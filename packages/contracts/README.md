# @pmp/contracts (SYNC-01, owner: Afzal)

Single source of truth for the event envelope and payloads, money helpers, reason codes, UUIDv7 ids and
`SCHEMA_VERSION` (integration contract IC-01). Specification: `docs/integrations/event-envelope.md`.

- `parseEvent(input)` returns `{ ok: true, value }` or `{ ok: false, issues: [{ path, message }] }`. Never a partial event.
- `newId()` returns a UUIDv7. It needs `crypto.getRandomValues`; React Native must provide a polyfill first.
- Money is integer paise; `toPaise` takes decimal strings only.
- Fixtures: `fixtures/events/valid` and `fixtures/events/invalid`; tests: `test/`.

**Shared-package rule:** changes need review from another workstream owner; breaking changes require a
`SCHEMA_VERSION` bump.
