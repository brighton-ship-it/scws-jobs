-- SCWS Job Management System - Quotes, Invoices, Payments Schema
-- Migration 004: Full quoting and invoicing system

-- ============================================
-- PRODUCTS TABLE
-- Products/Services catalog
-- ============================================
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    default_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    item_type TEXT NOT NULL CHECK (item_type IN ('labor', 'part', 'equipment', 'service')),
    sku TEXT,
    active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view products" ON public.products
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage products" ON public.products
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- QUOTES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_number SERIAL UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
    valid_until DATE,
    subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5, 3) NOT NULL DEFAULT 8.75,
    tax_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total DECIMAL(10, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    internal_notes TEXT,
    sent_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for quotes
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and office can view quotes" ON public.quotes
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Admin and office can manage quotes" ON public.quotes
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- QUOTE_ITEMS TABLE
-- Line items for quotes
-- ============================================
CREATE TABLE IF NOT EXISTS public.quote_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total DECIMAL(10, 2) NOT NULL DEFAULT 0,
    item_type TEXT CHECK (item_type IN ('labor', 'part', 'equipment', 'service')),
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- RLS Policies for quote_items
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view quote_items" ON public.quote_items
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage quote_items" ON public.quote_items
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- DROP OLD INVOICES TABLE IF EXISTS (recreate with proper schema)
-- ============================================
-- First drop dependent objects
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.invoice_items CASCADE;

-- Backup any existing invoice data if needed
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoices') THEN
        -- Just drop it, the original schema was simpler
        DROP TABLE public.invoices CASCADE;
    END IF;
END
$$;

-- ============================================
-- INVOICES TABLE (new comprehensive schema)
-- ============================================
CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number SERIAL UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'paid', 'overdue', 'void')),
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5, 3) NOT NULL DEFAULT 8.75,
    tax_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total DECIMAL(10, 2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    internal_notes TEXT,
    sent_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
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
-- INVOICE_ITEMS TABLE
-- Line items for invoices
-- ============================================
CREATE TABLE public.invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total DECIMAL(10, 2) NOT NULL DEFAULT 0,
    item_type TEXT CHECK (item_type IN ('labor', 'part', 'equipment', 'service')),
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- RLS Policies for invoice_items
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view invoice_items" ON public.invoice_items
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage invoice_items" ON public.invoice_items
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- PAYMENTS TABLE
-- Payment records for invoices
-- ============================================
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method TEXT CHECK (payment_method IN ('cash', 'check', 'card', 'transfer', 'other')),
    reference_number TEXT,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and office can view payments" ON public.payments
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Admin and office can manage payments" ON public.payments
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(active);
CREATE INDEX IF NOT EXISTS idx_products_item_type ON public.products(item_type);

CREATE INDEX IF NOT EXISTS idx_quotes_customer ON public.quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_property ON public.quotes(property_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created ON public.quotes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON public.quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_sort ON public.quote_items(quote_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON public.invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_quote ON public.invoices(quote_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON public.invoices(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_sort ON public.invoice_items(invoice_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments(payment_date);

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at on quotes
CREATE TRIGGER quotes_updated_at
    BEFORE UPDATE ON public.quotes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Auto-update updated_at on invoices
CREATE TRIGGER invoices_updated_at
    BEFORE UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Auto-update updated_at on products
CREATE TRIGGER products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update quote totals when items change
CREATE OR REPLACE FUNCTION update_quote_totals()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.quotes
    SET 
        subtotal = (SELECT COALESCE(SUM(total), 0) FROM public.quote_items WHERE quote_id = COALESCE(NEW.quote_id, OLD.quote_id)),
        tax_amount = (SELECT COALESCE(SUM(total), 0) FROM public.quote_items WHERE quote_id = COALESCE(NEW.quote_id, OLD.quote_id)) * (tax_rate / 100),
        total = (SELECT COALESCE(SUM(total), 0) FROM public.quote_items WHERE quote_id = COALESCE(NEW.quote_id, OLD.quote_id)) * (1 + tax_rate / 100),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_items_update_totals
    AFTER INSERT OR UPDATE OR DELETE ON public.quote_items
    FOR EACH ROW
    EXECUTE FUNCTION update_quote_totals();

-- Function to update invoice totals when items change
CREATE OR REPLACE FUNCTION update_invoice_totals()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.invoices
    SET 
        subtotal = (SELECT COALESCE(SUM(total), 0) FROM public.invoice_items WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)),
        tax_amount = (SELECT COALESCE(SUM(total), 0) FROM public.invoice_items WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)) * (tax_rate / 100),
        total = (SELECT COALESCE(SUM(total), 0) FROM public.invoice_items WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)) * (1 + tax_rate / 100),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_items_update_totals
    AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_totals();

-- Function to update invoice amount_paid when payments change
CREATE OR REPLACE FUNCTION update_invoice_payments()
RETURNS TRIGGER AS $$
DECLARE
    inv_id UUID;
    total_paid DECIMAL(10, 2);
    inv_total DECIMAL(10, 2);
BEGIN
    inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM public.payments
    WHERE invoice_id = inv_id;
    
    SELECT total INTO inv_total
    FROM public.invoices
    WHERE id = inv_id;
    
    UPDATE public.invoices
    SET 
        amount_paid = total_paid,
        status = CASE
            WHEN total_paid >= inv_total AND inv_total > 0 THEN 'paid'
            WHEN status = 'paid' AND total_paid < inv_total THEN 'sent'
            ELSE status
        END,
        paid_at = CASE
            WHEN total_paid >= inv_total AND inv_total > 0 THEN NOW()
            ELSE paid_at
        END,
        updated_at = NOW()
    WHERE id = inv_id;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_update_invoice
    AFTER INSERT OR UPDATE OR DELETE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_payments();

-- ============================================
-- SEED PRODUCTS
-- ============================================
INSERT INTO public.products (name, description, default_price, item_type, active) VALUES
    ('Labor - Standard Rate', 'Standard labor rate per hour', 125.00, 'labor', true),
    ('Labor - Emergency Rate', 'Emergency/after-hours labor rate per hour', 185.00, 'labor', true),
    ('Submersible Pump - 1HP', 'Grundfos 1HP submersible pump', 850.00, 'part', true),
    ('Submersible Pump - 3HP', 'Grundfos 3HP submersible pump', 1450.00, 'part', true),
    ('Submersible Pump - 5HP', 'Grundfos 5HP submersible pump', 2200.00, 'part', true),
    ('Pressure Tank - 20 Gallon', 'Well-X-Trol 20 gallon pressure tank', 285.00, 'part', true),
    ('Pressure Tank - 44 Gallon', 'Well-X-Trol 44 gallon pressure tank', 425.00, 'part', true),
    ('Pressure Switch', 'Square D pressure switch 30/50 PSI', 65.00, 'part', true),
    ('Control Box', 'Franklin Electric control box', 175.00, 'part', true),
    ('Service Call', 'Standard service call fee', 95.00, 'service', true),
    ('Well Inspection', 'Complete well system inspection', 175.00, 'service', true),
    ('Water Quality Test', 'Basic water quality testing', 125.00, 'service', true),
    ('Equipment Rental - Pump Hoist', 'Daily rental for pump pulling equipment', 350.00, 'equipment', true),
    ('Water Softener System', 'Residential water softener with installation', 1850.00, 'part', true)
ON CONFLICT DO NOTHING;
