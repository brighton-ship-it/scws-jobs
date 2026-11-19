-- Batch columns for QuickBooks write audit and revert. Additive.
-- Apply in the Supabase SQL Editor after 20261105_qbo_write_audit.sql.
-- The app does not run this file.
alter table public.qbo_write_audit add column if not exists batch_id text;
alter table public.qbo_write_audit add column if not exists action text;
alter table public.qbo_write_audit add column if not exists created boolean not null default false;
alter table public.qbo_write_audit add column if not exists prior_state jsonb;
alter table public.qbo_write_audit add column if not exists sync_token text;
alter table public.qbo_write_audit add column if not exists txn_date text;
