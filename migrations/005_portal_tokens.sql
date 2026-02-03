-- SCWS Portal Tokens Migration
-- Secure tokens for customer portal access without authentication

-- ============================================
-- PORTAL_TOKENS TABLE
-- Allows customers to access their portal via secure URL
-- ============================================
CREATE TABLE IF NOT EXISTS public.portal_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- RLS Policies for portal_tokens
ALTER TABLE public.portal_tokens ENABLE ROW LEVEL SECURITY;

-- Allow admin/office to manage tokens
CREATE POLICY "Admin and office can manage portal_tokens" ON public.portal_tokens
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- Allow anonymous token lookup via service role (RLS bypassed by service key)
-- This is fine because we use the service role client for portal routes

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_portal_tokens_customer ON public.portal_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON public.portal_tokens(token);

-- ============================================
-- FUNCTION: Generate secure portal token
-- ============================================
CREATE OR REPLACE FUNCTION generate_portal_token()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    -- Generate 32-character alphanumeric token
    FOR i IN 1..32 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Create or get portal token for customer
-- ============================================
CREATE OR REPLACE FUNCTION get_or_create_portal_token(p_customer_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
    existing_token TEXT;
    new_token TEXT;
BEGIN
    -- Check for existing non-expired token
    SELECT token INTO existing_token
    FROM public.portal_tokens
    WHERE customer_id = p_customer_id
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF existing_token IS NOT NULL THEN
        RETURN existing_token;
    END IF;
    
    -- Generate new token
    new_token := generate_portal_token();
    
    INSERT INTO public.portal_tokens (customer_id, token, created_by)
    VALUES (p_customer_id, new_token, p_created_by);
    
    RETURN new_token;
END;
$$ LANGUAGE plpgsql;
