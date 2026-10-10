-- Phone call log: every inbound call seen in the Google Workspace Voice audit log.
-- Metadata only, no recordings. Additive. Rollback: 20261010_phone_call_log_rollback.sql
-- Apply in the Supabase SQL Editor. The app does not run this file.
CREATE TABLE IF NOT EXISTS phone_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_call_key text NOT NULL UNIQUE,      -- Voice PARAM_DISTRIBUTION_ID (or event id)
  started_at timestamptz NOT NULL,
  direction text NOT NULL DEFAULT 'inbound',
  caller_phone text,                        -- E.164
  called_number text,                       -- E.164 (main line or a user's number)
  ring_group text,
  duration_seconds integer,                 -- talk time
  ring_seconds integer,
  outcome text NOT NULL CHECK (outcome IN ('answered','missed','forwarded_ai','voicemail','answered_unknown')),
  answered_by text,                         -- user email when a user leg connected
  customer_id uuid,
  jobber_client_id text,
  client_name text,
  campaign_name text,
  keyword text,
  ads_call_resource text,
  receptionist_call_id text,                -- receptionist_calls.vapi_call_id when forwarded to Mike
  legs jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_call_log_started ON phone_call_log (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_call_log_caller ON phone_call_log (caller_phone);
ALTER TABLE phone_call_log ENABLE ROW LEVEL SECURITY;
