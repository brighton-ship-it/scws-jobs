-- Idempotent: Production may never have applied 20260222_settings /
-- 20260915_jobber_oauth_settings. Creates public.settings and hides
-- settings.key = 'jobber_oauth' from authenticated / admin CRM reads.
--
-- The service role used by src/lib/jobber/token-store.ts bypasses RLS
-- and can read/upsert the encrypted Jobber OAuth row. Do not insert
-- tokens or encryption keys here.

CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.settings;
CREATE POLICY "Authenticated users can view settings" ON public.settings
    FOR SELECT USING (
        auth.role() = 'authenticated'
        AND key <> 'jobber_oauth'
    );

DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
CREATE POLICY "Admins can manage settings" ON public.settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
        AND key <> 'jobber_oauth'
    );

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
