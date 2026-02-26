-- Add "completed" status to quotes table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/htzsnpqrrrdfleldgybn/sql

-- Drop old constraint
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;

-- Add new constraint with "completed" status
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check 
  CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'completed'));

-- Verify
SELECT DISTINCT status FROM public.quotes;
