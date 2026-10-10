-- Inbound phone call log (recording + transcript + summary). NOT applied by the PR.
-- Run in the Supabase SQL editor. Service role only (RLS on, no policies/grants for anon/authenticated).
create table if not exists public.inbound_call_recordings (
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
create index if not exists inbound_call_recordings_started_idx on public.inbound_call_recordings (started_at desc);
create index if not exists inbound_call_recordings_caller_idx on public.inbound_call_recordings (caller_number);
alter table public.inbound_call_recordings enable row level security;
revoke all on public.inbound_call_recordings from anon, authenticated;
