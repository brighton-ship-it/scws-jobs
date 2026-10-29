drop index if exists public.missed_call_texts_sid;
alter table public.missed_call_texts
  drop column if exists delivery_updated_at,
  drop column if exists delivery_error,
  drop column if exists delivery_status;
