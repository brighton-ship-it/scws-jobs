# Supabase migrations

## `20261029_missed_call_text_delivery.sql`

Adds `delivery_status`, `delivery_error`, and `delivery_updated_at` on `missed_call_texts`, plus an index on `twilio_message_sid`. `/api/sms/status` (Twilio delivery receipt) and the call dashboard write them. Inbound replies are stored on the existing `thread` column by `/api/sms/forward` and `/api/sms/inbound`; that does not need this migration. Until the columns exist, the office dashboard still lists texts and replies, and delivery shows as Sent. Apply it in the SQL Editor. Undo with `20261029_missed_call_text_delivery_rollback.sql`.

## `20261024_ads_offline_dm_request_id.sql`

Adds `ads_offline_conversions.dm_request_id` and copies it from `payload.dm_request_id` where the column is still empty. The offline cron writes the column on each save. Until this is applied, that upsert drops the column, logs a WARNING, and keeps the id in `payload`. Apply it in the SQL Editor. The app does not run this file.

## `20261021_receptionist_calls_needs_callback.sql`

Adds `receptionist_calls.needs_callback` (default false). The receptionist webhook sets it, with a notes line, when a service caller hangs up with no booking and no callback. It is a label for the office. The Mike callback cron does not read it, and it does not text or dial. Until this is applied, the webhook saves the note and retries the update without the column.

## `20261018_missed_call_texts.sql`

Adds `missed_call_texts`: one row per call the missed-call text follow-up looked at (sent, skipped and why), plus the AI text thread for replies. Written by `/api/cron/missed-call-texts` and `/api/sms/forward`. Until this is applied, the cron finds a missing-table note and texts nobody, and replies are only forwarded to the office as today. Apply it in the SQL Editor. Undo with `20261018_missed_call_texts_rollback.sql`.

Texts stay off until `MISSED_CALL_TEXT_ENABLED=true`. `MISSED_CALL_TEXT_TEST_NUMBERS` texts only those numbers while the flag is unset.

## `20261014_mike_callback_attempts.sql`

Adds `mike_callback_attempts`, one row per missed call Mike may call back. The cron at `/api/cron/mike-callbacks` writes it. Until this is applied, the cron logs a missing-table note and dials nobody (the dial is recorded before Twilio is called). `/ops/calls` keeps working and shows no Mike attempt line. Apply it in the SQL Editor. Undo with `20261014_mike_callback_attempts_rollback.sql`.

Callbacks stay off until `MIKE_CALLBACKS_ENABLED=true`. `MIKE_CALLBACK_TEST_NUMBERS` dials only those numbers while the flag is unset.

## `20261012_jobber_mirror.sql`

Adds the Jobber read mirror (`jobber_clients`, `jobber_jobs`, `jobber_invoices`, `jobber_quotes`, `jobber_payments`, `jobber_timesheets`, `jobber_sync_state`). RLS on with no policies (service role only). Filled by the `/api/cron/jobber-mirror` cron every 10 min (backfill since Jan 2025 first, then rolling windows). `/ops/calls`, the TV page and `/ops/metrics` read the mirror once every backfill is done and the last sync is < 40 min old; otherwise they fall back to live Jobber. Kill switch: `JOBBER_MIRROR_DISABLED=1`. Undo with `20261012_jobber_mirror_rollback.sql`.

## `20261010_paid_ads_attribution.sql`

Adds `lead_source` and UTM columns on `booking_requests` (campaign is `utm_campaign`, keyword is `utm_term`), log columns on `book_job_conversions`, and tables `ads_calls`, `ads_offline_conversions`, and `ads_closed_loop_reports`.

Until this is applied, forms still save, but `lead_source` is dropped on insert, offline conversion rows cannot be stored, and the weekly report cannot save. Apply it in the SQL Editor. Undo with `20261010_paid_ads_attribution_rollback.sql`. See `docs/ADS_ATTRIBUTION.md`.

SQL in this folder is **not** applied automatically from the app or from Vercel.

If a migration is not in the production schema, open the **Supabase SQL Editor** for the project, paste the file, and run it.

## `20261007_booking_requests_vapi_call_dedupe.sql`

Adds nullable `vapi_call_id` and `tool_call_id` on `booking_requests` so Sarah emergency/callback alerts can be deduped per Vapi call. Existing rows are not rewritten.

Until this is applied, the webhook still saves the lead (it retries the insert without those columns) and still dedupes by phone for 10 minutes when the call id was not stored. Apply it in the SQL Editor. Deploy does not run it.

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
