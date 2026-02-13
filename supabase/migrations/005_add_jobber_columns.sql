-- Add Jobber ID columns for tracking imported data

-- Quotes: track original Jobber quote ID and number
ALTER TABLE public.quotes 
  ADD COLUMN IF NOT EXISTS jobber_quote_id TEXT,
  ADD COLUMN IF NOT EXISTS jobber_quote_number TEXT;

CREATE INDEX IF NOT EXISTS idx_quotes_jobber_id ON public.quotes(jobber_quote_id);

-- Jobs: track original Jobber job ID
ALTER TABLE public.jobs 
  ADD COLUMN IF NOT EXISTS jobber_job_id TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_jobber_id ON public.jobs(jobber_job_id);

-- Customer notes table for imported client notes
CREATE TABLE IF NOT EXISTS public.customer_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    note_type TEXT DEFAULT 'general' CHECK (note_type IN ('general', 'internal', 'service', 'billing')),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    jobber_note_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON public.customer_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_jobber ON public.customer_notes(jobber_note_id);

-- RLS for customer_notes
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view notes" ON public.customer_notes
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage notes" ON public.customer_notes
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );
