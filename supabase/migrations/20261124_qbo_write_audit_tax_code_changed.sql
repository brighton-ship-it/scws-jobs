-- Allow status tax_code_changed on QuickBooks write audit rows.
-- Apply in the Supabase SQL Editor after 20261124_qbo_write_audit_unknown.sql.
-- The app does not run this file.
-- tax_code_changed means the invoice write posted, but the saved TxnTaxCodeRef, county rate
-- (4 San Diego / 25 Riverside) or NetAmountTaxable is not what was requested (Automated Sales
-- Tax re-picked it). The row keeps prior_state and qbo_revert_batch still treats it as a write.
-- Until this is applied, the tax_code_changed row insert fails the check constraint: the tool
-- still returns ok:false / tax_code_changed with "the audit log failed", and the pending row
-- stays pending (revert reports an unresolved pending row in couldNot), so nothing is hidden.
-- Rollback (only when no row has status tax_code_changed):
--   alter table public.qbo_write_audit drop constraint if exists qbo_write_audit_status_check;
--   alter table public.qbo_write_audit add constraint qbo_write_audit_status_check
--     check (status is null or status in ('preview', 'pending', 'refused', 'ok', 'failed', 'tax_mismatch', 'unknown'));
alter table public.qbo_write_audit drop constraint if exists qbo_write_audit_status_check;
alter table public.qbo_write_audit
  add constraint qbo_write_audit_status_check
  check (status is null or status in ('preview', 'pending', 'refused', 'ok', 'failed', 'tax_mismatch', 'unknown', 'tax_code_changed'));
