-- Data Manager request id on ads_offline_conversions.
-- Apply in the Supabase SQL Editor. The app does not run this file.
--
-- Safe to re-run. Copies payload.dm_request_id onto the column when the
-- column is still empty, so an already-uploaded batch can be listed by
-- request id without reading the jsonb. The cron keeps writing the column
-- after this is applied, and keeps payload.dm_request_id either way.
-- Until then it logs a WARNING and still saves the id inside payload.

ALTER TABLE ads_offline_conversions
  ADD COLUMN IF NOT EXISTS dm_request_id text;

COMMENT ON COLUMN ads_offline_conversions.dm_request_id IS
  'Data Manager events:ingest requestId for this offline row. Null for call uploads. Same value as payload.dm_request_id.';

CREATE INDEX IF NOT EXISTS idx_ads_offline_conversions_dm_request_id
  ON ads_offline_conversions (dm_request_id)
  WHERE dm_request_id IS NOT NULL;

UPDATE ads_offline_conversions
SET dm_request_id = btrim(payload->>'dm_request_id')
WHERE dm_request_id IS NULL
  AND payload->>'dm_request_id' IS NOT NULL
  AND btrim(payload->>'dm_request_id') <> '';
