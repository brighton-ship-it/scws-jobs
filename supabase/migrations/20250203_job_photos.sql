-- Job Photos with Categories
-- For before/after photos and documentation

-- ============================================
-- JOB PHOTOS TABLE (enhanced from job_attachments)
-- ============================================
CREATE TABLE IF NOT EXISTS job_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  
  -- File info
  url VARCHAR(500) NOT NULL, -- Supabase Storage URL
  thumbnail_url VARCHAR(500), -- Optional thumbnail
  filename VARCHAR(255),
  file_size INTEGER, -- bytes
  
  -- Category: before, after, documentation
  category VARCHAR(50) NOT NULL DEFAULT 'documentation' 
    CHECK (category IN ('before', 'after', 'documentation')),
  
  -- Ordering and caption
  sort_order INTEGER DEFAULT 0,
  caption TEXT,
  
  -- Who uploaded
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id);
CREATE INDEX IF NOT EXISTS idx_job_photos_category ON job_photos(category);
CREATE INDEX IF NOT EXISTS idx_job_photos_sort ON job_photos(job_id, sort_order);

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view job photos
CREATE POLICY "Users can view job photos" ON job_photos
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert photos
CREATE POLICY "Users can insert job photos" ON job_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can update photos
CREATE POLICY "Users can update job photos" ON job_photos
  FOR UPDATE
  TO authenticated
  USING (true);

-- Authenticated users can delete photos
CREATE POLICY "Users can delete job photos" ON job_photos
  FOR DELETE
  TO authenticated
  USING (true);

-- ============================================
-- STORAGE BUCKET
-- ============================================
-- Create job-photos bucket (run manually in Supabase dashboard if needed)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);
