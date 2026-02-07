-- Add priority column to jobs table if missing
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';

-- Add constraint if not exists (wrap in DO block to handle existing constraint)
DO $$ 
BEGIN
    ALTER TABLE jobs ADD CONSTRAINT jobs_priority_check 
        CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Create index for priority queries
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);

-- Also ensure job_number column exists
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_number SERIAL;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
