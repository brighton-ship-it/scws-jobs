-- Status for QuickBooks write audit rows. Additive.
-- Apply in the Supabase SQL Editor after 20261119_qbo_write_audit_batch.sql.
-- The app does not run this file.
-- pending = logged before the post (not a failure). refused = the gate blocked the post.
-- failed = QuickBooks returned an error. ok = the post succeeded. preview = no post.
alter table public.qbo_write_audit add column if not exists status text;

update public.qbo_write_audit
set status = case
  when refused then 'refused'
  when dry_run and not confirmed then 'preview'
  when ok then 'ok'
  when confirmed and not dry_run and not ok and error is null
    and (qbo_response is null or qbo_response = 'null'::jsonb) then 'pending'
  else 'failed'
end
where status is null;

-- The pre-write insert used to hardcode environment sandbox and omit batch_id.
-- Copy those from the outcome row that shares request_id and realm_id when
-- that outcome agrees on a single batch and environment.
update public.qbo_write_audit as pending
set
  batch_id = coalesce(pending.batch_id, picked.batch_id),
  environment = case
    when pending.environment = 'sandbox' and picked.environment = 'production' then 'production'
    else pending.environment
  end
from (
  select request_id, realm_id, min(batch_id) as batch_id, min(environment) as environment
  from public.qbo_write_audit
  where ok = true and request_id is not null
  group by request_id, realm_id
  having count(distinct batch_id) <= 1
     and count(distinct environment) = 1
) as picked
where pending.status = 'pending'
  and pending.request_id = picked.request_id
  and pending.realm_id is not distinct from picked.realm_id
  and (
    pending.batch_id is null
    or (pending.environment = 'sandbox' and picked.environment = 'production')
  );

alter table public.qbo_write_audit drop constraint if exists qbo_write_audit_status_check;
alter table public.qbo_write_audit
  add constraint qbo_write_audit_status_check
  check (status is null or status in ('preview', 'pending', 'refused', 'ok', 'failed'));
