-- SCWS Job Types Reference
-- Common well service job types for reference/autocomplete

CREATE TABLE IF NOT EXISTS public.job_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    default_duration INTERVAL,
    description TEXT
);

-- RLS
ALTER TABLE public.job_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view job_types" ON public.job_types
    FOR SELECT USING (true);

CREATE POLICY "Only admins can manage job_types" ON public.job_types
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

-- Seed common job types
INSERT INTO public.job_types (name, default_duration, description) VALUES
    ('Well Inspection', '2 hours', 'General well health inspection and water quality check'),
    ('Pump Replacement', '4 hours', 'Replace submersible or jet pump'),
    ('Pump Repair', '3 hours', 'Repair existing pump system'),
    ('Well Cleaning', '4 hours', 'Clean and rehabilitate well'),
    ('Pressure Tank Service', '2 hours', 'Inspect, repair, or replace pressure tank'),
    ('Water Treatment', '3 hours', 'Install or service water treatment system'),
    ('Emergency Service', '2 hours', 'Emergency no-water or well failure response'),
    ('New Well Connection', '6 hours', 'Connect new well to property'),
    ('Electrical Repair', '2 hours', 'Repair pump electrical/control systems'),
    ('Video Inspection', '3 hours', 'Camera inspection of well bore'),
    ('Water Testing', '1 hour', 'Collect samples for lab testing'),
    ('Consultation', '1 hour', 'Site visit and consultation'),
    ('Preventive Maintenance', '2 hours', 'Scheduled maintenance visit')
ON CONFLICT (name) DO NOTHING;
