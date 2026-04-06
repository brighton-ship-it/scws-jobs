-- Crew Tracking Migration
-- Adds crew roles, performance tracking, and tech types

-- 1. Add crew tracking fields to jobs table
ALTER TABLE public.jobs 
  ADD COLUMN IF NOT EXISTS crew_lead_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crew_helper_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crew_type TEXT CHECK (crew_type IN ('solo', 'two_man', 'drill'));

-- Index for crew queries
CREATE INDEX IF NOT EXISTS idx_jobs_crew_lead ON public.jobs(crew_lead_id);
CREATE INDEX IF NOT EXISTS idx_jobs_crew_helper ON public.jobs(crew_helper_id);
CREATE INDEX IF NOT EXISTS idx_jobs_completed_by ON public.jobs(completed_by_id);

-- 2. Add performance fields to team_members table
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS tech_type TEXT CHECK (tech_type IN ('service', 'pump_lead', 'mixed', 'driller', 'helper', 'office', 'sales'));

-- 3. Create tech_performance_monthly table
CREATE TABLE IF NOT EXISTS public.tech_performance_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- first day of month
  visits INTEGER DEFAULT 0,
  unique_jobs INTEGER DEFAULT 0,
  revenue DECIMAL(12,2) DEFAULT 0,
  parts_revenue DECIMAL(12,2) DEFAULT 0,
  labor_revenue DECIMAL(12,2) DEFAULT 0,
  days_worked INTEGER DEFAULT 0,
  sourced_followups INTEGER DEFAULT 0,
  sourced_revenue DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_member_id, month)
);

-- Indexes for performance queries
CREATE INDEX IF NOT EXISTS idx_tech_performance_team_member ON public.tech_performance_monthly(team_member_id);
CREATE INDEX IF NOT EXISTS idx_tech_performance_month ON public.tech_performance_monthly(month);

-- RLS for tech_performance_monthly
ALTER TABLE public.tech_performance_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and office can view all performance data" ON public.tech_performance_monthly
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
  );

CREATE POLICY "Admin can manage performance data" ON public.tech_performance_monthly
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- 4. Seed hourly rates and tech types
UPDATE public.team_members SET hourly_rate = 32, tech_type = 'pump_lead' WHERE name = 'Chris Glass';
UPDATE public.team_members SET hourly_rate = 30, tech_type = 'mixed' WHERE name = 'Haze Tarbell';
UPDATE public.team_members SET hourly_rate = 30, tech_type = 'service' WHERE name = 'Brian Eads';
UPDATE public.team_members SET hourly_rate = 28, tech_type = 'mixed' WHERE name = 'Cowin';
UPDATE public.team_members SET hourly_rate = 25, tech_type = 'mixed' WHERE name = 'Marshall Car';
UPDATE public.team_members SET hourly_rate = 30, tech_type = 'pump_lead' WHERE name = 'Sergio Valdovinos Mendez';
UPDATE public.team_members SET hourly_rate = 25, tech_type = 'helper' WHERE name = 'Dakota Cole';
UPDATE public.team_members SET tech_type = 'driller' WHERE name = 'Damian Famania';
UPDATE public.team_members SET tech_type = 'driller' WHERE name = 'Dylan J Rabas';
UPDATE public.team_members SET tech_type = 'sales' WHERE name = 'Brian Schroeder';
UPDATE public.team_members SET hourly_rate = 25, tech_type = 'helper' WHERE name = 'Austin W Tipton';

-- 5. Migrate existing assigned_to data to crew_lead_id for jobs that reference team_members
-- Note: assigned_to references users table (auth-linked), crew fields reference team_members
-- We'll need to manually map or create a migration script if there's overlap

COMMENT ON COLUMN public.jobs.crew_lead_id IS 'Lead tech who gets revenue credit';
COMMENT ON COLUMN public.jobs.crew_helper_id IS 'Optional helper tech';
COMMENT ON COLUMN public.jobs.completed_by_id IS 'Team member who actually completed the work';
COMMENT ON COLUMN public.jobs.crew_type IS 'Auto-set based on crew composition: solo, two_man, or drill';
COMMENT ON COLUMN public.team_members.hourly_rate IS 'Hourly pay rate for margin calculations';
COMMENT ON COLUMN public.team_members.tech_type IS 'Tech role classification for reporting';
