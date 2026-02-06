-- SMS Conversations table for AI text receptionist
CREATE TABLE IF NOT EXISTS sms_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT UNIQUE NOT NULL,
  messages JSONB DEFAULT '[]'::jsonb,
  customer_name TEXT,
  service_address TEXT,
  issue TEXT,
  is_urgent BOOLEAN DEFAULT false,
  lead_created BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_sms_conversations_phone ON sms_conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_conversations_updated ON sms_conversations(updated_at DESC);

-- Enable RLS
ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;

-- Policy for service role
CREATE POLICY "Service role can do everything on sms_conversations"
ON sms_conversations FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
