-- Add review tracking to customers
-- Prevents re-sending review requests to customers who already left reviews

ALTER TABLE public.customers 
ADD COLUMN IF NOT EXISTS has_reviewed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_platform TEXT; -- 'google', 'yelp', etc.

-- Index for filtering in campaigns
CREATE INDEX IF NOT EXISTS idx_customers_has_reviewed ON public.customers(has_reviewed);

COMMENT ON COLUMN public.customers.has_reviewed IS 'Whether customer has left a review (exclude from review campaigns)';
COMMENT ON COLUMN public.customers.reviewed_at IS 'When the review was detected/recorded';
COMMENT ON COLUMN public.customers.review_platform IS 'Where they left the review (google, yelp, etc)';
