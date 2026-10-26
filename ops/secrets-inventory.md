# Secrets inventory

This inventory records names and handling locations only. Never add secret values,
credentials, or copies of them here. These entries describe the intended inventory,
not configured storage: repository documentation says apps do not read these values
yet and CI currently uses no secrets. Confirm actual locations and access with the
team/admin before storing any values.

## Secrets

| Name | Purpose | Intended storage location (not verified as configured) | Responsible owner | Rotation rule |
| --- | --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI/API access for automation | GitHub Actions environment secrets, scoped to the environment that deploys | Akanksha for CLD-01; confirm environment-specific administrator | Rotate immediately if exposed; remove access when a team member leaves. Confirm a routine cadence and the authorized rotator with the Supabase/GitHub administrators. |
| `SUPABASE_DB_PASSWORD` | Database password for CLI/database administration | GitHub Actions environment secrets when CI/deploy needs it; Supabase project settings | Akanksha for CLD-01; confirm project administrator | Rotate immediately if exposed; remove access when a team member leaves. Update the matching environment only, then verify its consumers. Confirm a routine cadence and procedure with the project administrator. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side privileged Supabase access | GitHub Actions environment secrets and the relevant server-side platform/function secret store; never client bundles | Akanksha for CLD-01; confirm per-environment service owner | Rotate immediately if exposed; remove access when a team member leaves. Update the matching environment and server-side consumers, verify, then revoke the old key. Confirm the provider-supported rotation procedure and routine cadence with the administrator. |
| Supabase project JWT signing secret (exact setting/variable name to confirm) | Signs and validates project JWTs | Supabase project settings; do not put in client apps | Akanksha for CLD-01; confirm project administrator | Rotate immediately if exposed. Rotation can invalidate existing JWTs; confirm provider procedure, impact, authorized rotator, and routine cadence with the project administrator before planned rotation. |
| `RESEND_API_KEY` | Server-side report email delivery | GitHub Actions environment secrets if CI/deploy needs it; server-side platform/function secrets | Akanksha for CLD-01; confirm email integration owner (CLD-06 is owned by Anamika) | Rotate immediately if exposed; update server-side consumers and revoke the old key. Confirm authorized rotator and routine cadence with the Resend administrator. |
| `REPORT_ROUTE_SECRET` | Authenticate the report-render route | GitHub Actions environment secrets if CI/deploy needs it; server-side application platform settings | Akanksha for CLD-01; confirm route owner (CLD-06 is owned by Anamika) | Rotate immediately if exposed; coordinate the new value with the route consumer before revoking the old one. Confirm the authorized owner and routine cadence with the application administrator. |
| `SENTRY_AUTH_TOKEN` | CI-only Sentry source-map upload | GitHub Actions environment secrets, only if source-map upload is enabled | Akanksha for CLD-01; confirm Sentry project administrator | Rotate immediately if exposed; update CI and revoke the old token. Confirm the authorized rotator and routine cadence with the Sentry administrator. |

The CLD-01 sheet says secrets are stored only in GitHub environments and Supabase
secrets. The `.env.example` describes Vercel/EAS project settings for production app
configuration. Which runtime secret store is approved for non-Supabase services
(including Resend and the report route) needs team/admin confirmation; do not treat a
platform location in this inventory as configured or approved.

## Non-secret project configuration

| Name | Purpose | Intended storage location (not verified as configured) | Owner / confirmation | Update rule |
| --- | --- | --- | --- | --- |
| `SUPABASE_PROJECT_REF` | Selects the Supabase project for CLI/API operations; it is not a credential | GitHub Actions environment variables, scoped per environment; project reference in the operational runbook | Akanksha for CLD-01; confirm actual refs and environment administrators after projects are created | Update the matching environment and runbook if a project is replaced or its ref changes. |
| `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL` | Supabase endpoints; URLs are not credentials | Untracked local environment file; Vercel/EAS project environment settings | Akanksha for CLD-01; confirm app/platform owners and per-project values | Update affected clients when a project endpoint changes. |
| `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Client-visible Supabase keys; public configuration subject to RLS, not privileged credentials | Untracked local environment file; Vercel/EAS project environment settings | Akanksha for CLD-01; confirm app/platform owners and key format | Replace affected client configuration when the project key is rotated. |
| `SENTRY_DSN` | Sentry SDK project identifier/configuration; not a private authentication token | Relevant application platform settings and untracked local environment file for development | Akanksha for CLD-01; confirm Sentry/app owner and whether each app treats its DSN as public configuration | Update affected SDK configuration if the Sentry project or DSN changes. |

## Environment and rotation notes

- Planned environment separation is `dev`, `staging`, and `production`. CLD-01 specifies
  GitHub Actions environments for `staging` and `production`; confirm the development
  secret-storage approach and create projects/environments before entering values.
- Store environment-specific credentials separately. A rotation in one environment
  must not affect another.
- If a key is exposed in chat or logs, rotate it immediately. Remove a departing
  team member's GitHub and Supabase access the same day.
- No routine rotation interval is specified in the project documents. Confirm cadence,
  authorized owners, provider procedures, production reviewers, and the exact secret
  consumers with the team/admin; do not infer them from this inventory.
- Record every completed rotation here by date, variable name, environment, and reason.
  Do not record old or new values.
