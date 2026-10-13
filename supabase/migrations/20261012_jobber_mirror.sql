-- Jobber read mirror for /ops dashboards (calls, TV, metrics). Filled by /api/cron/jobber-mirror.
-- Service role only: RLS on, no policies, anon/authenticated revoked. Idempotent.
create table if not exists public.jobber_clients (
  id text primary key, created_at timestamptz, name text, company_name text,
  phones_digits text[] not null default '{}', data jsonb not null, synced_at timestamptz not null default now());
create index if not exists jobber_clients_phones_idx on public.jobber_clients using gin (phones_digits);

create table if not exists public.jobber_jobs (
  id text primary key, job_number integer, client_id text, title text,
  created_at timestamptz, completed_at timestamptz, jobber_updated_at timestamptz,
  data jsonb not null, synced_at timestamptz not null default now());
create index if not exists jobber_jobs_created_idx on public.jobber_jobs (created_at);
create index if not exists jobber_jobs_completed_idx on public.jobber_jobs (completed_at);
create index if not exists jobber_jobs_client_idx on public.jobber_jobs (client_id);

create table if not exists public.jobber_invoices (
  id text primary key, invoice_status text, issued_date timestamptz, client_id text,
  job_ids text[] not null default '{}', jobber_updated_at timestamptz,
  data jsonb not null, synced_at timestamptz not null default now());
create index if not exists jobber_invoices_issued_idx on public.jobber_invoices (issued_date);
create index if not exists jobber_invoices_jobs_idx on public.jobber_invoices using gin (job_ids);

create table if not exists public.jobber_quotes (
  id text primary key, quote_status text, created_at timestamptz, jobber_updated_at timestamptz,
  data jsonb not null, synced_at timestamptz not null default now());
create index if not exists jobber_quotes_created_idx on public.jobber_quotes (created_at);

create table if not exists public.jobber_payments (
  id text primary key, entry_date timestamptz, data jsonb not null, synced_at timestamptz not null default now());
create index if not exists jobber_payments_entry_idx on public.jobber_payments (entry_date);

create table if not exists public.jobber_timesheets (
  id text primary key, start_at timestamptz, data jsonb not null, synced_at timestamptz not null default now());
create index if not exists jobber_timesheets_start_idx on public.jobber_timesheets (start_at);

create table if not exists public.jobber_sync_state (
  key text primary key, cursor text, done boolean not null default false,
  last_success_at timestamptz, last_error text, locked_until timestamptz,
  meta jsonb not null default '{}', updated_at timestamptz not null default now());
insert into public.jobber_sync_state (key, locked_until) values ('lock', now() - interval '1 day') on conflict (key) do nothing;

do $$ declare t text; begin
  foreach t in array array['jobber_clients','jobber_jobs','jobber_invoices','jobber_quotes','jobber_payments','jobber_timesheets','jobber_sync_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
