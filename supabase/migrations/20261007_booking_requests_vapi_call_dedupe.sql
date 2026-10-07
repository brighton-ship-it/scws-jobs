-- Sarah emergency/callback dedupe.
--
-- ADDITIVE ONLY. Adds two nullable text columns and indexes.
-- Does not update, backfill, or rewrite existing booking_requests rows.
-- Does not add NOT NULL, defaults, or new check constraints.
--
-- This file does NOT run on Vercel deploy and is not applied by the app.
-- HUMAN ACTION REQUIRED: open the Supabase SQL Editor for this project,
-- paste this file, and run it.
--
-- Until then, the receptionist webhook still saves the lead (it retries
-- without these columns) and still dedupes a missing call id by phone for
-- 10 minutes. Same-call dedupe after that window needs these columns.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS vapi_call_id text,
  ADD COLUMN IF NOT EXISTS tool_call_id text;

COMMENT ON COLUMN booking_requests.vapi_call_id IS
  'Vapi call id for Sarah emergency/callback alerts. Null for website bookings and rows saved before this column existed.';

COMMENT ON COLUMN booking_requests.tool_call_id IS
  'Vapi tool call id already handled for this office alert. Pipe-delimited when one row covers more than one tool call.';

CREATE INDEX IF NOT EXISTS idx_booking_requests_vapi_call_id
  ON booking_requests (vapi_call_id)
  WHERE vapi_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_tool_call_id
  ON booking_requests (tool_call_id)
  WHERE tool_call_id IS NOT NULL;
