# Supabase migrations

SQL in this folder is **not** applied automatically from the app or from Vercel.

If a migration is not in the production schema, open the **Supabase SQL Editor** for the project, paste the file, and run it.

## `20260827_book_job_click_ids_and_conversions.sql`

Adds `gclid` / `gbraid` / `wbraid` / `ga_client_id` / `ga_session_id` on `booking_requests` and `customers`, plus `book_job_conversions` and `jobber_job_schedule_state`.

Until this is applied, website booking still saves the lead (without those columns) and Jobber `book_job` cannot persist conversions. There is no service-role “apply from git” in this repo.

## `20260915_jobber_oauth_settings.sql`

Hides `settings.key = 'jobber_oauth'` from authenticated / admin CRM reads. The service role used by `src/lib/jobber/token-store.ts` still reads and upserts that encrypted Jobber OAuth row.

Until this is applied, the durable store can still write the row (service role bypasses RLS), but a signed-in admin `GET /api/settings` might see the ciphertext. Apply it in the SQL Editor. Production also needs `JOBBER_TOKEN_ENCRYPTION_KEY` on Vercel — see `docs/jobber-mcp.md`.

## `20260918_ensure_settings_jobber_oauth.sql`

Idempotent recreate of `public.settings` plus the `jobber_oauth` RLS hide, for projects that never applied `20260222_settings.sql`. Superseded by `20260922_jobber_oauth_single_writer.sql`, which also installs the refresh lock. Apply that file instead.

## `20260922_jobber_oauth_single_writer.sql`

Idempotent `public.settings` plus the `jobber_oauth` RLS hide, plus `jobber_oauth_claim` / `jobber_oauth_commit` advisory locks so two Production isolates cannot refresh the same Jobber refresh token. Service role only. Do not paste tokens or keys into SQL.

The app does **not** treat a missing table or a failed read as an empty store. That fallback refreshed env tokens, Jobber rotated the refresh token, and the new pair was never stored. Verify with `node scripts/verify-jobber-settings.js` or `GET /api/jobber/oauth-health`. See `docs/JOBBER_OAUTH.md`.
