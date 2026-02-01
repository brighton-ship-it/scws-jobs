-- SCWS Job Management System - Initial Schema
-- Run this in Supabase SQL Editor or via CLI

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- Employee/admin accounts (extends auth.users)
-- ============================================
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'office', 'field')),
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all users" ON public.users
    FOR SELECT USING (true);

CREATE POLICY "Only admins can insert users" ON public.users
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Only admins can update users" ON public.users
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================
-- CUSTOMERS TABLE
-- Client records
-- ============================================
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    billing_address TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view customers" ON public.customers
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can insert customers" ON public.customers
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Admin and office can update customers" ON public.customers
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Only admins can delete customers" ON public.customers
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================
-- PROPERTIES TABLE
-- Service locations (customers can have multiple)
-- ============================================
CREATE TABLE public.properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    city TEXT,
    county TEXT,
    zip TEXT,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    access_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for properties
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view properties" ON public.properties
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage properties" ON public.properties
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- WELL_INFO TABLE
-- Well specifications per property
-- ============================================
CREATE TABLE public.well_info (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    well_depth DECIMAL(8, 2),
    casing_diameter DECIMAL(6, 2),
    static_water_level DECIMAL(8, 2),
    pump_depth DECIMAL(8, 2),
    pump_model TEXT,
    pump_hp DECIMAL(5, 2),
    install_date DATE,
    notes TEXT
);

-- RLS Policies for well_info
ALTER TABLE public.well_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view well_info" ON public.well_info
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage well_info" ON public.well_info
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- JOBS TABLE
-- Work orders
-- ============================================
CREATE TABLE public.jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'invoiced')),
    job_type TEXT NOT NULL,
    scheduled_date DATE,
    scheduled_time TIME,
    estimated_duration INTERVAL,
    description TEXT,
    internal_notes TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for jobs
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and office can view all jobs" ON public.jobs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Field users can view assigned jobs" ON public.jobs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'field')
        AND assigned_to = auth.uid()
    );

CREATE POLICY "Admin and office can insert jobs" ON public.jobs
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Admin and office can update any job" ON public.jobs
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Field users can update assigned jobs" ON public.jobs
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'field')
        AND assigned_to = auth.uid()
    );

-- ============================================
-- JOB_LINE_ITEMS TABLE
-- Parts/labor for jobs
-- ============================================
CREATE TABLE public.job_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('labor', 'part', 'equipment'))
);

-- RLS Policies for job_line_items
ALTER TABLE public.job_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view job_line_items" ON public.job_line_items
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage job_line_items" ON public.job_line_items
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- JOB_PHOTOS TABLE
-- Attachments
-- ============================================
CREATE TABLE public.job_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    caption TEXT,
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for job_photos
ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view job_photos" ON public.job_photos
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert job_photos" ON public.job_photos
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can delete own photos or admin" ON public.job_photos
    FOR DELETE USING (
        uploaded_by = auth.uid() OR
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================
-- INVOICES TABLE
-- Billing
-- ============================================
CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    invoice_number TEXT UNIQUE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid')),
    due_date DATE,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and office can view invoices" ON public.invoices
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Admin and office can manage invoices" ON public.invoices
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_properties_customer ON public.properties(customer_id);
CREATE INDEX idx_well_info_property ON public.well_info(property_id);
CREATE INDEX idx_jobs_property ON public.jobs(property_id);
CREATE INDEX idx_jobs_assigned ON public.jobs(assigned_to);
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_jobs_scheduled ON public.jobs(scheduled_date);
CREATE INDEX idx_job_line_items_job ON public.job_line_items(job_id);
CREATE INDEX idx_job_photos_job ON public.job_photos(job_id);
CREATE INDEX idx_invoices_job ON public.invoices(job_id);
CREATE INDEX idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at on customers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Auto-generate invoice numbers
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
    year_prefix TEXT;
    next_num INTEGER;
BEGIN
    year_prefix := TO_CHAR(NOW(), 'YYYY');
    SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 6) AS INTEGER)), 0) + 1
    INTO next_num
    FROM public.invoices
    WHERE invoice_number LIKE year_prefix || '-%';
    
    NEW.invoice_number := year_prefix || '-' || LPAD(next_num::TEXT, 5, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_auto_number
    BEFORE INSERT ON public.invoices
    FOR EACH ROW
    WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
    EXECUTE FUNCTION generate_invoice_number();
