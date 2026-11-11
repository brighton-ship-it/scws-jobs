-- Undo 20261111_read_path_indexes.sql. Run outside a transaction
-- (DROP INDEX CONCURRENTLY cannot run inside BEGIN/COMMIT).

DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_user_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_customers_phone;
