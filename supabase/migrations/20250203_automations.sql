-- Automations System Tables
-- Create automations table for storing automation rules

CREATE TABLE IF NOT EXISTS automations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  trigger VARCHAR(50) NOT NULL CHECK (trigger IN (
    'appointment_scheduled',
    'job_completed', 
    'quote_sent',
    'quote_approved',
    'invoice_sent',
    'invoice_paid',
    'custom'
  )),
  delay_hours INTEGER NOT NULL DEFAULT 24,  -- Positive = after, Negative = before (for appointments)
  message_type VARCHAR(10) NOT NULL CHECK (message_type IN ('sms', 'email', 'both')) DEFAULT 'sms',
  message_template TEXT NOT NULL,
  email_subject VARCHAR(255),  -- For email messages
  is_active BOOLEAN NOT NULL DEFAULT true,
  sent_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active automations by trigger
CREATE INDEX idx_automations_trigger_active ON automations(trigger) WHERE is_active = true;

-- Create sent_messages table for tracking what was sent and preventing duplicates
CREATE TABLE IF NOT EXISTS automation_sent_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- Reference to the entity that triggered the automation
  trigger_entity_id UUID NOT NULL,  -- job_id, quote_id, invoice_id depending on trigger
  trigger_entity_type VARCHAR(20) NOT NULL CHECK (trigger_entity_type IN ('job', 'quote', 'invoice')),
  message_type VARCHAR(10) NOT NULL CHECK (message_type IN ('sms', 'email')),
  recipient VARCHAR(255) NOT NULL,  -- Phone number or email
  message_content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  external_id VARCHAR(255),  -- Twilio SID or Resend ID
  error_message TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,  -- When it should be sent
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding pending messages
CREATE INDEX idx_sent_messages_scheduled ON automation_sent_messages(scheduled_for) 
  WHERE status = 'pending';

-- Index for preventing duplicates
CREATE UNIQUE INDEX idx_sent_messages_unique ON automation_sent_messages(
  automation_id, trigger_entity_id, trigger_entity_type, message_type
);

-- Create automation_logs table for debugging and analytics
CREATE TABLE IF NOT EXISTS automation_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,  -- 'triggered', 'sent', 'failed', 'skipped'
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for recent logs
CREATE INDEX idx_automation_logs_created ON automation_logs(created_at DESC);

-- Trigger to update updated_at on automations
CREATE OR REPLACE FUNCTION update_automations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER automations_updated_at
  BEFORE UPDATE ON automations
  FOR EACH ROW
  EXECUTE FUNCTION update_automations_updated_at();

-- Insert default automations
INSERT INTO automations (name, description, trigger, delay_hours, message_type, message_template, email_subject) VALUES
(
  'Appointment Reminder',
  'Remind customer day before appointment',
  'appointment_scheduled',
  -24,
  'sms',
  'Reminder: Your well service appointment is tomorrow at {{time}}. Our tech will call when on the way. Questions? (760) 440-8520',
  NULL
),
(
  'Post-Service Review Request',
  'Ask for Google review 24 hours after job completion',
  'job_completed',
  24,
  'sms',
  'Hi {{customer_name}}! Thanks for choosing Southern California Well Service. We''d love your feedback: https://g.page/r/scwellservice/review',
  NULL
),
(
  'Quote Follow-Up',
  'Follow up on quotes after 3 days if not approved',
  'quote_sent',
  72,
  'sms',
  'Hi {{customer_name}}, following up on the quote we sent for {{service_type}}. Questions? (760) 440-8520',
  NULL
),
(
  'Invoice Payment Reminder',
  'Remind customer about unpaid invoice after 7 days',
  'invoice_sent',
  168,
  'both',
  'Hi {{customer_name}}, this is a friendly reminder that Invoice #{{invoice_number}} for ${{amount}} is due. Pay online: {{payment_link}}',
  'Payment Reminder - Invoice #{{invoice_number}}'
)
ON CONFLICT DO NOTHING;

-- Grant permissions (adjust as needed for your Supabase setup)
-- GRANT ALL ON automations TO authenticated;
-- GRANT ALL ON automation_sent_messages TO authenticated;
-- GRANT ALL ON automation_logs TO authenticated;
