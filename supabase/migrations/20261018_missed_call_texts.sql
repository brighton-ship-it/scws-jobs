-- Missed-call / hang-up text follow-up: one row per call considered, plus the AI text thread.
-- Service role only. Apply in the Supabase SQL Editor. The app does not run this file.
-- Nothing is texted until MISSED_CALL_TEXT_ENABLED=true (or MISSED_CALL_TEXT_TEST_NUMBERS is set).
-- Rollback: 20261018_missed_call_texts_rollback.sql
create table if not exists public.missed_call_texts (
  id uuid primary key default gen_random_uuid(),
  missed_call_key text not null,
  caller_phone text not null,
  called_number text,
  trigger text not null check (trigger in ('ring_hangup','voicemail','mike_hangup','mike_unfinished')),
  customer_name text,
  missed_at timestamptz not null,
  outcome text not null check (outcome in ('queued','sending','sent','skipped','failed')),
  reason text,
  variant text,
  body text,
  line_type text,
  twilio_message_sid text,
  sent_at timestamptz,
  thread_status text check (thread_status in ('open','handed_off','booked','closed','opted_out')),
  thread jsonb not null default '[]'::jsonb,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists missed_call_texts_key on public.missed_call_texts (missed_call_key);
create index if not exists missed_call_texts_phone_sent on public.missed_call_texts (caller_phone, sent_at desc);

alter table public.missed_call_texts enable row level security;
revoke all on public.missed_call_texts from anon, authenticated;
grant all on public.missed_call_texts to service_role;
