-- Two-Way SMS Texting
-- Conversation threads with customers via Twilio

-- ============================================
-- SMS CONVERSATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS sms_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  phone_number VARCHAR(20) NOT NULL, -- E.164 format
  
  -- Customer info (if not linked)
  customer_name VARCHAR(255),
  
  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'blocked')),
  unread_count INTEGER DEFAULT 0,
  
  -- Last message preview
  last_message_at TIMESTAMPTZ,
  last_message_preview VARCHAR(255),
  last_message_direction VARCHAR(10), -- 'inbound' or 'outbound'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(phone_number)
);

-- ============================================
-- SMS MESSAGES
-- ============================================
CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES sms_conversations(id) ON DELETE CASCADE,
  
  -- Message content
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  media_urls JSONB DEFAULT '[]'::jsonb, -- MMS attachments
  
  -- Twilio info
  twilio_sid VARCHAR(50),
  twilio_status VARCHAR(20), -- queued, sent, delivered, failed, etc.
  
  -- Sender info
  from_number VARCHAR(20),
  to_number VARCHAR(20),
  sent_by UUID REFERENCES auth.users(id), -- For outbound, who sent it
  
  -- Timestamps
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_sms_conversations_customer ON sms_conversations(customer_id);
CREATE INDEX idx_sms_conversations_phone ON sms_conversations(phone_number);
CREATE INDEX idx_sms_conversations_status ON sms_conversations(status);
CREATE INDEX idx_sms_conversations_last_message ON sms_conversations(last_message_at DESC);
CREATE INDEX idx_sms_messages_conversation ON sms_messages(conversation_id);
CREATE INDEX idx_sms_messages_sent_at ON sms_messages(sent_at DESC);
CREATE INDEX idx_sms_messages_twilio_sid ON sms_messages(twilio_sid);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER update_sms_conversations_updated_at
  BEFORE UPDATE ON sms_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update conversation on new message
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sms_conversations
  SET 
    last_message_at = NEW.sent_at,
    last_message_preview = LEFT(NEW.body, 255),
    last_message_direction = NEW.direction,
    unread_count = CASE 
      WHEN NEW.direction = 'inbound' THEN unread_count + 1 
      ELSE unread_count 
    END,
    updated_at = NOW()
  WHERE id = NEW.conversation_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_on_message
  AFTER INSERT ON sms_messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();
