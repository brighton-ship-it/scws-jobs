-- Add billing city, state, and zip to customers table for payment processing
-- These fields are required by Stax for card payments

ALTER TABLE public.customers 
ADD COLUMN IF NOT EXISTS billing_city TEXT,
ADD COLUMN IF NOT EXISTS billing_state TEXT DEFAULT 'CA',
ADD COLUMN IF NOT EXISTS billing_zip TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.customers.billing_city IS 'Billing address city for payment processing';
COMMENT ON COLUMN public.customers.billing_state IS 'Billing address state for payment processing';
COMMENT ON COLUMN public.customers.billing_zip IS 'Billing address ZIP code for payment processing';
