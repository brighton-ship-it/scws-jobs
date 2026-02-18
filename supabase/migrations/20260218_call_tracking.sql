-- Call tracking table for SCWS CRM
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/htzsnpqrrrdfleldgybn/sql

CREATE TABLE IF NOT EXISTS tracked_calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  call_sid TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('seo', 'google_ads', 'gmb', 'direct', 'unknown')),
  tracking_number TEXT NOT NULL,
  caller_number TEXT,
  caller_city TEXT,
  caller_state TEXT,
  caller_zip TEXT,
  call_status TEXT,
  direction TEXT DEFAULT 'inbound',
  duration_seconds INTEGER,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  recording_url TEXT,
  customer_id UUID,
  job_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_tracked_calls_source ON tracked_calls(source);
CREATE INDEX IF NOT EXISTS idx_tracked_calls_started_at ON tracked_calls(started_at);
CREATE INDEX IF NOT EXISTS idx_tracked_calls_caller ON tracked_calls(caller_number);

-- Enable Row Level Security
ALTER TABLE tracked_calls ENABLE ROW LEVEL SECURITY;

-- Policy to allow authenticated users to read/write
CREATE POLICY "Allow all for authenticated users" ON tracked_calls
  FOR ALL USING (true) WITH CHECK (true);

-- Grant access to anon and authenticated roles
GRANT ALL ON tracked_calls TO anon;
GRANT ALL ON tracked_calls TO authenticated;
GRANT ALL ON tracked_calls TO service_role;
