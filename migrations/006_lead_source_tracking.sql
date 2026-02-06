-- Lead Source Tracking Migration
-- Adds lead source tracking to customers for marketing attribution

-- Create lead source enum type
DO $$ BEGIN
    CREATE TYPE lead_source AS ENUM (
        'google_ads',
        'organic_seo',
        'referral',
        'repeat_customer',
        'phone',
        'walk_in',
        'website_form',
        'other'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create lead stage enum type
DO $$ BEGIN
    CREATE TYPE lead_stage AS ENUM (
        'lead',
        'quote_sent',
        'quote_accepted',
        'job_scheduled',
        'job_completed',
        'paid'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add lead tracking columns to customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS lead_source text,
ADD COLUMN IF NOT EXISTS lead_source_detail text,
ADD COLUMN IF NOT EXISTS utm_source text,
ADD COLUMN IF NOT EXISTS utm_medium text,
ADD COLUMN IF NOT EXISTS utm_campaign text,
ADD COLUMN IF NOT EXISTS utm_term text,
ADD COLUMN IF NOT EXISTS utm_content text,
ADD COLUMN IF NOT EXISTS referrer_url text,
ADD COLUMN IF NOT EXISTS lead_stage text DEFAULT 'lead',
ADD COLUMN IF NOT EXISTS lead_stage_updated_at timestamptz,
ADD COLUMN IF NOT EXISTS quote_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS quote_accepted_at timestamptz,
ADD COLUMN IF NOT EXISTS job_scheduled_at timestamptz,
ADD COLUMN IF NOT EXISTS job_completed_at timestamptz,
ADD COLUMN IF NOT EXISTS first_paid_at timestamptz;

-- Create lead_source_costs table for ROI tracking
CREATE TABLE IF NOT EXISTS lead_source_costs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_source text NOT NULL,
    month date NOT NULL, -- First day of the month
    cost numeric(10,2) NOT NULL DEFAULT 0,
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(lead_source, month)
);

-- Create index for faster lead source queries
CREATE INDEX IF NOT EXISTS idx_customers_lead_source ON customers(lead_source);
CREATE INDEX IF NOT EXISTS idx_customers_lead_stage ON customers(lead_stage);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at);

-- Function to auto-detect lead source from UTM parameters
CREATE OR REPLACE FUNCTION detect_lead_source(
    p_utm_source text,
    p_utm_medium text,
    p_referrer_url text
) RETURNS text AS $$
BEGIN
    -- Google Ads detection
    IF p_utm_source = 'google' AND p_utm_medium IN ('cpc', 'ppc') THEN
        RETURN 'google_ads';
    END IF;
    
    -- Organic search detection
    IF p_utm_medium = 'organic' OR p_utm_source IN ('google', 'bing', 'yahoo', 'duckduckgo') AND p_utm_medium IS NULL THEN
        RETURN 'organic_seo';
    END IF;
    
    -- Referral detection
    IF p_utm_medium = 'referral' OR p_utm_source = 'referral' THEN
        RETURN 'referral';
    END IF;
    
    -- Check referrer URL for search engines
    IF p_referrer_url IS NOT NULL THEN
        IF p_referrer_url LIKE '%google.%' OR p_referrer_url LIKE '%bing.%' OR p_referrer_url LIKE '%yahoo.%' THEN
            RETURN 'organic_seo';
        END IF;
    END IF;
    
    -- Default to website form if UTM exists but doesn't match above
    IF p_utm_source IS NOT NULL OR p_utm_medium IS NOT NULL THEN
        RETURN 'website_form';
    END IF;
    
    RETURN 'other';
END;
$$ LANGUAGE plpgsql;

-- Function to update lead stage and timestamps
CREATE OR REPLACE FUNCTION update_lead_stage(
    p_customer_id uuid,
    p_new_stage text
) RETURNS void AS $$
DECLARE
    v_current_stage text;
BEGIN
    SELECT lead_stage INTO v_current_stage FROM customers WHERE id = p_customer_id;
    
    -- Update the stage
    UPDATE customers 
    SET 
        lead_stage = p_new_stage,
        lead_stage_updated_at = now(),
        quote_sent_at = CASE WHEN p_new_stage = 'quote_sent' AND quote_sent_at IS NULL THEN now() ELSE quote_sent_at END,
        quote_accepted_at = CASE WHEN p_new_stage = 'quote_accepted' AND quote_accepted_at IS NULL THEN now() ELSE quote_accepted_at END,
        job_scheduled_at = CASE WHEN p_new_stage = 'job_scheduled' AND job_scheduled_at IS NULL THEN now() ELSE job_scheduled_at END,
        job_completed_at = CASE WHEN p_new_stage = 'job_completed' AND job_completed_at IS NULL THEN now() ELSE job_completed_at END,
        first_paid_at = CASE WHEN p_new_stage = 'paid' AND first_paid_at IS NULL THEN now() ELSE first_paid_at END
    WHERE id = p_customer_id;
END;
$$ LANGUAGE plpgsql;

-- View for lead source analytics
CREATE OR REPLACE VIEW lead_source_analytics AS
SELECT 
    lead_source,
    COUNT(*) as total_leads,
    COUNT(*) FILTER (WHERE lead_stage IN ('quote_sent', 'quote_accepted', 'job_scheduled', 'job_completed', 'paid')) as quotes_sent,
    COUNT(*) FILTER (WHERE lead_stage IN ('quote_accepted', 'job_scheduled', 'job_completed', 'paid')) as quotes_accepted,
    COUNT(*) FILTER (WHERE lead_stage IN ('job_scheduled', 'job_completed', 'paid')) as jobs_scheduled,
    COUNT(*) FILTER (WHERE lead_stage IN ('job_completed', 'paid')) as jobs_completed,
    COUNT(*) FILTER (WHERE lead_stage = 'paid') as paid,
    ROUND(COUNT(*) FILTER (WHERE lead_stage = 'paid')::numeric / NULLIF(COUNT(*), 0) * 100, 2) as conversion_rate,
    DATE_TRUNC('month', created_at) as month
FROM customers
WHERE lead_source IS NOT NULL
GROUP BY lead_source, DATE_TRUNC('month', created_at);

-- Add RLS policies for lead_source_costs
ALTER TABLE lead_source_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON lead_source_costs
    FOR ALL USING (true);

COMMENT ON COLUMN customers.lead_source IS 'Source of the lead: google_ads, organic_seo, referral, repeat_customer, phone, walk_in, website_form, other';
COMMENT ON COLUMN customers.lead_stage IS 'Current stage in the sales funnel';
COMMENT ON COLUMN customers.utm_source IS 'UTM source parameter from website form submission';
COMMENT ON COLUMN customers.utm_medium IS 'UTM medium parameter from website form submission';
COMMENT ON COLUMN customers.utm_campaign IS 'UTM campaign parameter from website form submission';
