-- Allow status tax_mismatch on QuickBooks write audit rows.
-- Apply in the Supabase SQL Editor after 20261124_qbo_write_audit_status.sql.
-- The app does not run this file.
-- tax_mismatch means the invoice posted, then the saved 1% county rate or
-- TotalTax did not match the jobsite. It is not a second write. Revert still
-- uses the ok row for that invoice.
alter table public.qbo_write_audit drop constraint if exists qbo_write_audit_status_check;
alter table public.qbo_write_audit
  add constraint qbo_write_audit_status_check
  check (status is null or status in ('preview', 'pending', 'refused', 'ok', 'failed', 'tax_mismatch'));
