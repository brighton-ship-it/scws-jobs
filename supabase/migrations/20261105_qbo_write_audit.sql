-- Audit log for gated QuickBooks Online write tools. Additive.
-- Apply in the Supabase SQL Editor. The app does not run this file.
-- Confirmed writes refuse to post when this insert fails.
-- Rollback: drop table public.qbo_write_audit;
create table if not exists public.qbo_write_audit (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  actor text,
  tool text not null,
  request_id text,
  dry_run boolean not null default true,
  confirmed boolean not null default false,
  ok boolean not null default false,
  refused boolean not null default false,
  realm_id text,
  environment text,
  entity text,
  payload jsonb,
  qbo_response jsonb,
  qbo_ids jsonb,
  error text,
  reason text
);
alter table public.qbo_write_audit enable row level security;
