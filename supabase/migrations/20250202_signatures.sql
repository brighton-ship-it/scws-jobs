-- E-Signatures table for quotes
-- Run this in your Supabase SQL editor to add signature functionality

CREATE TABLE IF NOT EXISTS signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  signature_data TEXT NOT NULL,  -- Base64 encoded PNG image
  signer_name VARCHAR(255) NOT NULL,
  signer_email VARCHAR(255),
  ip_address VARCHAR(45),  -- Supports IPv6
  user_agent TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure only one signature per quote
  CONSTRAINT unique_quote_signature UNIQUE (quote_id)
);

-- Index for quick lookup by quote
CREATE INDEX IF NOT EXISTS idx_signatures_quote_id ON signatures(quote_id);

-- Enable RLS
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can view signatures (needed for PDF export and portal)
CREATE POLICY "Signatures are viewable by all" ON signatures
  FOR SELECT USING (true);

-- Policy: Anyone can insert signatures (customer signs via portal)
CREATE POLICY "Anyone can create signatures" ON signatures
  FOR INSERT WITH CHECK (true);

-- Add review_link column to automations if not exists (for Google review link)
-- ALTER TABLE automations ADD COLUMN IF NOT EXISTS review_link TEXT;

-- Seed the default review request automation if automations table exists
-- INSERT INTO automations (name, description, trigger, delay_hours, message_type, message_template, email_subject, is_active)
-- VALUES (
--   'Post-Job Review Request',
--   'Automatically request Google review 24 hours after job completion',
--   'job_completed',
--   24,
--   'both',
--   'Hi {{customer_name}}, thank you for choosing Southern California Well Service! We hope you were happy with our work. If you have a moment, we''d really appreciate a review: https://g.page/r/[SCWS-GOOGLE-PLACE-ID]/review',
--   'How was your experience with SCWS?',
--   true
-- )
-- ON CONFLICT DO NOTHING;
