# apps/gate: Android gate app (owner: Nikhil)

Expo (React Native) app with **expo-router** (entry: `expo-router/entry`, URL scheme
`parkosgate`). Screens under `app/` implement the flows in `docs/team/member-02-nikhil.md`
(GATE-01..12): entry token, exit/payment, pass lookup, zone counts, shift open/close, paper
backfill (validation only), overrides, device login/enrollment, printer settings, status.

## Dev-mode honesty (read before judging the app)

The app runs a labeled **DEV_FAKE** runtime until the sync client lands:

- `src/ui/port.tsx` (`PortProvider`) is the single wiring point: `FakeSync` (in-memory IC-02
  double), a local `SessionRegistry` (SYNC-03 open-sessions stand-in), the DEV seed config
  (`src/data/appConfig.ts`, labeled "DEV SEED" wherever shown), and the device id from
  `expo-secure-store` (`gate.deviceId`, load-or-create-once; writes fail closed until it
  resolves).
- Nothing fakes a sync: `lastSyncAt` stays `null`, so the never-synced login gate and the
  "never" row on the status screen are the true state (GATE-09/12).
- The login bypass and simulated-wrong-PIN controls render only when the build-time `__DEV__`
  flag is true **and** `EXPO_PUBLIC_GATE_DEV_CONTROLS` is exactly `"true"`; either flag missing
  or false hides them. Leave the opt-in unset in production/pilot builds. Submitted PINs remain
  unverified while IC-06 is pending. Login actions remain blocked until the persisted lockout
  record is read and validated; SecureStore read, corruption, and write failures fail closed,
  with an explicit retry for recoverable store errors.
- Paper backfill **never writes** (GATE-11): the event contract has no backfill `source` flag
  yet, so a persisted event would be indistinguishable from a live one. The screen
  validates full drafts and shows the blocked panel citing the contract gap.
- Zone counts can be validated and reviewed, but are not persisted: IC-01 has no `ZONE_COUNT`
  payload fields, and writing an empty event would falsely imply that the actual count was saved.
- Shift-close totals and variances can be reviewed, but the close is not persisted until IC-01
  supports those fields; a bare `SHIFT_CLOSE` event would imply a reconciliation that was not saved.
- Test prints, behavior toggles, and the synthetic demo token are available only in development
  builds. A failed test print falls back to the token screen and never claims a real print
  (OQ-31).

## Layer map

| Layer                                | Where                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Pure machines/rules (vitest-covered) | `src/domain/*`, `src/auth/*`                                              |
| Data/IC boundary                     | `src/data/{appConfig,fakeSync,ic02,localSessions,writeEvent}.ts`          |
| Print bytes                          | `src/print/{escpos,printMachine,printer,qr}.ts`                           |
| Notifications                        | `src/notifications/*` (zone reminders, cleared at shift close)            |
| Screen runtime                       | `src/ui/{port,ui,useSyncState,Scanner,TokenFullScreen,deriveBanners}.tsx` |
| i18n (en/hi, parity-checked)         | `src/i18n/*` — default language Hindi                                     |
| Diagnostics/log (scrubbed)           | `src/lib/{buildMode,diag,log}.ts`                                         |

## Commands (from the repo root, `pnpm --filter @pmp/gate <script>`)

| Script              | Purpose                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| `start` / `android` | Expo dev server (needs a device or emulator; not run in CI)              |
| `bundle:android`    | JS bundle export, verifies Metro can resolve everything (the router too) |
| `typecheck`, `test` | Run by root `pnpm check` (tests never import react-native/.tsx)          |

## Dependency choices (observable installs only)

- `expo-router` for navigation + deep links (`scheme: parkosgate`; enrollment QR opens
  `parkos-enroll:` payloads through the in-app scanner path, no OS link needed yet).
- `expo-notifications` for zone reminders (`SchedulableTriggerInputTypes.DATE` triggers;
  battery/storage of the reminder environment stays unclaimed — OQ-29 modules not approved).
- `expo-secure-store` only (`gate.deviceId`, `gate.lockout`, `gate.language`); no MMKV/haptics/crypto installs —
  all pending the open-questions register (OQ-40 for haptics).
- `i18next` thin wrapper (`src/i18n/config.ts`) over the two JSON bundles (`src/i18n/*.json`)
  with the key-parity gate from `src/i18n/parity.ts`.
- `qrcode-generator` (pure JS, typed, no transitive deps) for the receipt QR matrix;
  `src/print/escpos.ts` emits the five `GS ( k` frames (model/module-size/EC/data/print).
- The real Bluetooth printer library waits for the printer-model decision (OQ-31); the screen
  and `fakePrinterTransport` keep the shape (`PrinterTransport.print(bytes)`), so the future
  driver is a drop-in.

## Not set up yet

SQLite outbox + real sync client (Afzal, OQ-37/OQ-42), EAS builds + dev client (`expo-dev-client`)

- Maestro trials (hardware wave), camera field trials, battery/storage modules (OQ-29),
  Bluetooth printing (OQ-31). Share code only via `packages/*`; do not fork vendor screens.
