-- One automated Mike callback per missed call. Service role only.
-- Apply in the Supabase SQL Editor. The app does not run this file.
-- Rollback: 20261014_mike_callback_attempts_rollback.sql
create table if not exists public.mike_callback_attempts (
  id uuid primary key default gen_random_uuid(),
  missed_call_key text not null,
  caller_phone text not null,
  from_number text,
  customer_name text,
  missed_at timestamptz not null,
  attempted_at timestamptz,
  scheduled_for timestamptz,
  outcome text not null check (outcome in ('queued','dialing','reached','booked','voicemail','no-answer','skipped','failed')),
  reason text,
  twilio_call_sid text,
  vapi_call_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mike_callback_attempts_missed_key
  on public.mike_callback_attempts (missed_call_key);
create index if not exists mike_callback_attempts_phone
  on public.mike_callback_attempts (caller_phone, attempted_at desc);
create index if not exists mike_callback_attempts_sid
  on public.mike_callback_attempts (twilio_call_sid);

alter table public.mike_callback_attempts enable row level security;
revoke all on public.mike_callback_attempts from anon, authenticated;
grant all on public.mike_callback_attempts to service_role;
