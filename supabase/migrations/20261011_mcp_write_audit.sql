-- Audit log for guarded MCP cancel/reschedule tools. Additive.
-- Apply in the Supabase SQL Editor. The app does not run this file.
-- Rollback: drop table public.mcp_write_audit;
create table if not exists public.mcp_write_audit (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  tool text not null,
  actor text,
  dry_run boolean not null default false,
  ok boolean not null default false,
  refused boolean not null default false,
  force boolean not null default false,
  reason text,
  job_id text,
  job_number text,
  visit_id text,
  before_state jsonb,
  after_state jsonb,
  error text
);
alter table public.mcp_write_audit enable row level security;
