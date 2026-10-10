-- Inbound phone call log (recording + transcript + summary). NOT applied by the PR.
-- Run in the Supabase SQL editor. Service role only (RLS on, no policies/grants for anon/authenticated).
create table if not exists public.phone_call_log (
  call_sid text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  caller_number text,
  tracking_number text,
  source text,
  caller_city text,
  caller_state text,
  dial_status text,            -- completed | no-answer | busy | failed | canceled
  duration_seconds integer,
  answered boolean,
  recording_sid text,
  recording_duration_seconds integer,
  processing_status text not null default 'pending'
    check (processing_status in ('pending','processing','done','skipped','failed')),
  processing_error text,
  transcript text,
  summary text,
  outcome text,
  caller_name text,
  needs_followup boolean,
  jobber_client_id text
);
create index if not exists phone_call_log_started_idx on public.phone_call_log (started_at desc);
create index if not exists phone_call_log_caller_idx on public.phone_call_log (caller_number);
alter table public.phone_call_log enable row level security;
revoke all on public.phone_call_log from anon, authenticated;
