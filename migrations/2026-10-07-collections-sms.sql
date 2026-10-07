-- Collections SMS tables. NOT applied by this change.
-- Run in the Supabase SQL editor when collections texting is ready to go live.
-- No seed rows. Service role only (RLS on; anon and authenticated have no grants).

create table if not exists public.sms_do_not_text (
  phone_e164 text primary key,
  source text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_sms_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id text,
  invoice_numbers text[] not null default '{}',
  phone_last4 text,
  phone_hash text,
  status text not null check (status in ('sent', 'skipped', 'failed', 'dry_run')),
  reason text,
  twilio_sid text,
  error_code text,
  template_version text
);

create index if not exists collection_sms_log_client_created_idx
  on public.collection_sms_log (client_id, created_at desc);

create index if not exists collection_sms_log_phone_hash_created_idx
  on public.collection_sms_log (phone_hash, created_at desc);

create index if not exists collection_sms_log_error_code_idx
  on public.collection_sms_log (phone_hash, error_code);

create table if not exists public.collection_holds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id text,
  invoice_number text,
  phone text,
  reason text
);

create index if not exists collection_holds_client_idx
  on public.collection_holds (client_id);

create index if not exists collection_holds_invoice_idx
  on public.collection_holds (invoice_number);

create table if not exists public.collection_autoreply_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  phone_hash text,
  phone_last4 text,
  body_length integer,
  keyword boolean not null default false,
  body text,
  direction text not null default 'inbound' check (direction in ('inbound', 'autoreply')),
  twilio_sid text
);

create index if not exists collection_autoreply_log_phone_created_idx
  on public.collection_autoreply_log (phone_hash, created_at desc);

alter table public.sms_do_not_text enable row level security;
alter table public.collection_sms_log enable row level security;
alter table public.collection_holds enable row level security;
alter table public.collection_autoreply_log enable row level security;

drop policy if exists sms_do_not_text_service_role on public.sms_do_not_text;
create policy sms_do_not_text_service_role
  on public.sms_do_not_text
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists collection_sms_log_service_role on public.collection_sms_log;
create policy collection_sms_log_service_role
  on public.collection_sms_log
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists collection_holds_service_role on public.collection_holds;
create policy collection_holds_service_role
  on public.collection_holds
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists collection_autoreply_log_service_role on public.collection_autoreply_log;
create policy collection_autoreply_log_service_role
  on public.collection_autoreply_log
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.sms_do_not_text from public, anon, authenticated;
revoke all on table public.collection_sms_log from public, anon, authenticated;
revoke all on table public.collection_holds from public, anon, authenticated;
revoke all on table public.collection_autoreply_log from public, anon, authenticated;

grant select, insert, update, delete on table public.sms_do_not_text to service_role;
grant select, insert, update, delete on table public.collection_sms_log to service_role;
grant select, insert, update, delete on table public.collection_holds to service_role;
grant select, insert, update, delete on table public.collection_autoreply_log to service_role;
