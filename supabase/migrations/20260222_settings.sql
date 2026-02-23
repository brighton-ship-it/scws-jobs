-- Settings table for company and billing configuration
CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- RLS
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view settings" ON public.settings
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage settings" ON public.settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

-- Insert default settings
INSERT INTO public.settings (key, value) VALUES
    ('company', '{
        "company_name": "Southern California Well Service",
        "address": "1077 Main St",
        "city": "Ramona",
        "state": "CA",
        "zip": "92065",
        "phone": "(760) 440-8520",
        "email": "info@scwellservice.com",
        "website": "www.scwellservice.com"
    }'::jsonb),
    ('billing', '{
        "tax_rate": 8.75,
        "payment_terms_days": 30,
        "invoice_prefix": "INV",
        "invoice_notes": "Thank you for your business!",
        "late_fee_percentage": 1.5,
        "accept_credit_cards": true,
        "accept_checks": true,
        "accept_cash": true
    }'::jsonb)
ON CONFLICT (key) DO NOTHING;
