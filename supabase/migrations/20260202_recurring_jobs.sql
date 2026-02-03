-- Recurring Jobs / Service Agreements
-- Auto-schedule maintenance visits on a recurring basis

-- ============================================
-- RECURRING JOB TEMPLATES
-- ============================================
CREATE TABLE IF NOT EXISTS recurring_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Customer & Location
  customer_id UUID NOT NULL REFERENCES customers(id),
  property_id UUID REFERENCES properties(id),
  
  -- Job Details
  title VARCHAR(255) NOT NULL,
  description TEXT,
  job_type VARCHAR(100),
  estimated_duration_minutes INTEGER DEFAULT 60,
  
  -- Recurrence Pattern
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'biannual', 'annual')),
  day_of_week INTEGER, -- 0=Sunday, 6=Saturday (for weekly/biweekly)
  day_of_month INTEGER, -- 1-31 (for monthly)
  month_of_year INTEGER, -- 1-12 (for annual)
  
  -- Scheduling
  start_date DATE NOT NULL,
  end_date DATE, -- NULL = no end
  next_scheduled DATE,
  preferred_time_start TIME,
  preferred_time_end TIME,
  
  -- Assignment
  assigned_to UUID REFERENCES auth.users(id),
  
  -- Pricing
  price DECIMAL(10,2),
  price_type VARCHAR(20) DEFAULT 'fixed' CHECK (price_type IN ('fixed', 'hourly', 'quote')),
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  jobs_created INTEGER DEFAULT 0,
  last_job_created_at TIMESTAMPTZ,
  
  -- Notes
  internal_notes TEXT,
  
  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- LINK TABLE: Jobs created from recurring templates
-- ============================================
CREATE TABLE IF NOT EXISTS recurring_job_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_job_id UUID NOT NULL REFERENCES recurring_jobs(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(recurring_job_id, job_id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_recurring_jobs_customer ON recurring_jobs(customer_id);
CREATE INDEX idx_recurring_jobs_status ON recurring_jobs(status);
CREATE INDEX idx_recurring_jobs_next_scheduled ON recurring_jobs(next_scheduled) WHERE status = 'active';
CREATE INDEX idx_recurring_job_instances_recurring ON recurring_job_instances(recurring_job_id);
CREATE INDEX idx_recurring_job_instances_job ON recurring_job_instances(job_id);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE TRIGGER update_recurring_jobs_updated_at
  BEFORE UPDATE ON recurring_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Calculate next scheduled date
-- ============================================
CREATE OR REPLACE FUNCTION calculate_next_scheduled_date(
  p_frequency VARCHAR,
  p_current_date DATE,
  p_day_of_week INTEGER,
  p_day_of_month INTEGER,
  p_month_of_year INTEGER
) RETURNS DATE AS $$
DECLARE
  v_next DATE;
BEGIN
  CASE p_frequency
    WHEN 'weekly' THEN
      v_next := p_current_date + INTERVAL '7 days';
    WHEN 'biweekly' THEN
      v_next := p_current_date + INTERVAL '14 days';
    WHEN 'monthly' THEN
      v_next := p_current_date + INTERVAL '1 month';
      IF p_day_of_month IS NOT NULL THEN
        v_next := DATE_TRUNC('month', v_next) + (p_day_of_month - 1) * INTERVAL '1 day';
      END IF;
    WHEN 'quarterly' THEN
      v_next := p_current_date + INTERVAL '3 months';
    WHEN 'biannual' THEN
      v_next := p_current_date + INTERVAL '6 months';
    WHEN 'annual' THEN
      v_next := p_current_date + INTERVAL '1 year';
    ELSE
      v_next := p_current_date + INTERVAL '1 month';
  END CASE;
  
  RETURN v_next;
END;
$$ LANGUAGE plpgsql;
