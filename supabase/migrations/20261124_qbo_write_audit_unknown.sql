-- Allow status unknown on QuickBooks write audit rows.
-- Apply in the Supabase SQL Editor after 20261124_qbo_write_audit_tax_mismatch.sql.
-- The app does not run this file.
-- unknown means the POST was sent but no response came back (network error,
-- timeout, or HTTP 408/502/503/504). QuickBooks may have saved it. Revert reports
-- it in couldNot as possibly written; it is never treated as failed.
-- Until this is applied, the unknown row insert fails the check constraint, the
-- write tool still stops, and the pending row stays pending (revert also reports
-- an unresolved pending row in couldNot), so nothing is hidden.
-- Rollback (only when no row has status unknown):
--   alter table public.qbo_write_audit drop constraint if exists qbo_write_audit_status_check;
--   alter table public.qbo_write_audit add constraint qbo_write_audit_status_check
--     check (status is null or status in ('preview', 'pending', 'refused', 'ok', 'failed', 'tax_mismatch'));
-- Wrapped in a transaction so there is no moment without the constraint.
-- Applied to project htzsnpqrrrdfleldgybn on 2026-11-24 at 1:04 PM PT.
begin;
alter table public.qbo_write_audit drop constraint if exists qbo_write_audit_status_check;
alter table public.qbo_write_audit
  add constraint qbo_write_audit_status_check
  check (status is null or status in ('preview', 'pending', 'refused', 'ok', 'failed', 'tax_mismatch', 'unknown'));
commit;
