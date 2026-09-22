# Jobber OAuth — one writer

Jobber **rotates the refresh token on every successful refresh**. The previous refresh token dies immediately. Two copies that both refresh, or a newer copy overwritten by an older one, leave every caller on HTTP 401 until a human logs in again.

## Operator rule

**Never refresh Jobber from a laptop or the shop box in a script that writes only a local file** (`jobber_tokens.json` or similar).

Box and shop routines that need Jobber must call Production:

- MCP: `https://scws-jobs.vercel.app/api/mcp/jobber`
- Health (no tokens): `GET https://scws-jobs.vercel.app/api/jobber/oauth-health`

They must not run a second refresh cycle. There is one OAuth app and one stored pair.

## What kept breaking

1. **Two refreshers.** The box file and Vercel `JOBBER_ACCESS_TOKEN` / `JOBBER_REFRESH_TOKEN` each refreshed. Whichever ran second presented a refresh token Jobber had already burned.
2. **Durable row, then a soft fallback.** Encrypted `settings.jobber_oauth` was added, but on 2026-09-17 `public.settings` was missing (`PGRST205` — the migration had not been applied). The code treated a failed load as an empty store and let the cron keep using env tokens. Persist after refresh still failed, so the rotated refresh token never landed anywhere that survived a cold start.
3. **Empty row.** On 2026-09-21 the durable row was cleared. Env bootstrap carried the cron again. The next local refresh desynced the only remaining pair. By 2026-09-22 the box and Production held the **same dead pair**.

Refreshing the env vars again does not fix this. The next cold start, or the next box script, repeats it.

## What this code does

`settings.key = jobber_oauth` (AES-256-GCM) is the **only** place a refresh writes.

| Situation | Behavior |
| --- | --- |
| Durable read fails (missing table, bad service key, network, decrypt) | Throw `Jobber durable token load failed`. **Do not call Jobber.** Do not use env tokens. |
| Read succeeds and the row is empty | One caller claims a lease, exchanges the env refresh token **once**, compare-and-swaps the new pair into the row. That is the only env bootstrap. |
| Row already has tokens | Refresh with **that** refresh token only. The env refresh token is not sent to Jobber, even if Jobber returns 401. |
| Two isolates refresh together | `pg_advisory_xact_lock` in `jobber_oauth_claim` / `jobber_oauth_commit` (or the row compare-and-swap if those functions are not installed yet) so only one exchange runs. The loser reloads the winner's tokens. |

`process.env` inside a warm lambda is a cache. It does **not** update Vercel env vars, and it is not a second source of truth.

Logs (no secrets):

- `auth_source=durable` — row was used
- `auth_source=env_bootstrap` — row was empty and env seeded it
- `reason=missing_table` or `reason=unreachable` — durable load failed; this is not a Jobber 401
- `action=refresh_failed http=401` — Jobber rejected the refresh token that the single writer just presented

## Apply the SQL

Migrations are not applied from Vercel. In the Supabase SQL Editor, run:

`supabase/migrations/20260922_jobber_oauth_single_writer.sql`

That creates `public.settings` if needed, hides `jobber_oauth` from authenticated and admin CRM reads, and installs the lock functions (`service_role` only).

Check without printing secrets:

```bash
node scripts/verify-jobber-settings.js
```

Exit 2 means the table is missing. Or:

```bash
curl -sS \
  -H "Authorization: Bearer $JOBBER_MCP_KEY" \
  https://scws-jobs.vercel.app/api/jobber/oauth-health
```

`200` with `settingsTable: "present"` and `authMode: "durable"` means the row is in use. `expiresAt` is the access-token expiry (not a secret). `authMode: "env_bootstrap"` means the row is still empty — the next Production refresh will seed it once. `settingsTable: "missing"` or `loadError` is a durable-store failure, not a Jobber 401.

Production also needs `JOBBER_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`) on Vercel project **scws-jobs**. Do not rotate that key after tokens are stored unless you log in to Jobber again. Do not commit the key or the tokens.

## After this ships

Jarvis does one fresh Jobber OAuth login so Production env has a live pair. The first Production request writes that pair into `settings.jobber_oauth`. After that, leave the env vars alone and do not refresh from the box.
