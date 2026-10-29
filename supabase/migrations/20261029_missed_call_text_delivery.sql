-- Carrier delivery status for missed-call auto-texts.
-- Replies already live in missed_call_texts.thread. These columns are optional:
-- the dashboard still lists texts and replies if they are missing.
-- Service role only. Apply in the Supabase SQL Editor. The app does not run this file.
-- Rollback: 20261029_missed_call_text_delivery_rollback.sql
alter table public.missed_call_texts
  add column if not exists delivery_status text,
  add column if not exists delivery_error text,
  add column if not exists delivery_updated_at timestamptz;

create index if not exists missed_call_texts_sid on public.missed_call_texts (twilio_message_sid);
