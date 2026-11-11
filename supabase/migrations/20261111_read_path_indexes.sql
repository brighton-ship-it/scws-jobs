-- Read-path indexes for the dashboard stall.
--
-- Production (htzsnpqrrrdfleldgybn) is missing both of these. customers is
-- looked up by phone with only the primary key. notifications is filtered by
-- user_id and ordered by created_at, and the table has no index besides the
-- primary key, so those polls sequential-scan.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction. Paste this file
-- into the Supabase SQL Editor as-is. Do not wrap it in a transaction.
-- The app does not apply this file. Brighton approves database changes separately.
--
-- Undo with 20261111_read_path_indexes_rollback.sql (also outside a transaction).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_phone
  ON public.customers (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);
