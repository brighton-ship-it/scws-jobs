-- Automated Follow-ups & Notifications
-- Auto-send review requests, reminders, etc.

-- ============================================
-- FOLLOW-UP RULES
-- ============================================
CREATE TABLE IF NOT EXISTS followup_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Rule details
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Trigger
  trigger_event VARCHAR(50) NOT NULL CHECK (trigger_event IN (
    'job_completed',      -- After job marked complete
    'invoice_sent',       -- After invoice sent
    'invoice_paid',       -- After payment received  
    'quote_sent',         -- After quote sent
    'quote_approved',     -- After quote approved
    'appointment_scheduled' -- When appointment scheduled
  )),
  
  -- Delay
  delay_hours INTEGER DEFAULT 24, -- Hours after trigger
  
  -- Message
  message_type VARCHAR(20) DEFAULT 'sms' CHECK (message_type IN ('sms', 'email', 'both')),
  template_id UUID REFERENCES marketing_templates(id),
  custom_message TEXT, -- Or inline message
  
  -- Conditions (JSON)
  conditions JSONB DEFAULT '{}'::jsonb,
  -- e.g., {"min_invoice_amount": 500, "service_types": ["pump_repair"]}
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FOLLOW-UP LOG
-- ============================================
CREATE TABLE IF NOT EXISTS followup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  rule_id UUID REFERENCES followup_rules(id),
  
  -- Target
  customer_id UUID REFERENCES customers(id),
  job_id UUID REFERENCES jobs(id),
  invoice_id UUID REFERENCES invoices(id),
  quote_id UUID REFERENCES quotes(id),
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  
  -- Result
  message_sid VARCHAR(100), -- Twilio SID
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_followup_rules_active ON followup_rules(is_active) WHERE is_active = true;
CREATE INDEX idx_followup_rules_trigger ON followup_rules(trigger_event);
CREATE INDEX idx_followup_log_status ON followup_log(status) WHERE status = 'pending';
CREATE INDEX idx_followup_log_scheduled ON followup_log(scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_followup_log_customer ON followup_log(customer_id);

-- ============================================
-- SEED DEFAULT RULES
-- ============================================
INSERT INTO followup_rules (name, description, trigger_event, delay_hours, message_type, custom_message, is_active) VALUES
  (
    'Post-Service Review Request',
    'Ask for Google review 24 hours after job completion',
    'job_completed',
    24,
    'sms',
    'Hi {{customer_name}}! Thanks for choosing Southern California Well Service. We''d love to hear about your experience! Leave us a review: https://g.page/r/scwellservice/review',
    true
  ),
  (
    'Quote Follow-Up',
    'Follow up on quotes after 3 days if not approved',
    'quote_sent',
    72,
    'sms',
    'Hi {{customer_name}}, following up on the quote we sent for {{service_type}}. Let us know if you have any questions - we''re here to help! Call (760) 440-8520',
    true
  ),
  (
    'Payment Confirmation',
    'Thank customer after payment received',
    'invoice_paid',
    1,
    'sms',
    'Hi {{customer_name}}, we received your payment of ${{amount}}. Thank you for your business! - Southern California Well Service',
    true
  ),
  (
    'Appointment Reminder',
    'Remind customer day before appointment',
    'appointment_scheduled',
    -24,
    'sms',
    'Reminder: Your well service appointment is tomorrow at {{time}}. Our tech will call when on the way. Questions? (760) 440-8520',
    true
  )
ON CONFLICT DO NOTHING;

-- ============================================
-- TRIGGER
-- ============================================
CREATE TRIGGER update_followup_rules_updated_at
  BEFORE UPDATE ON followup_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
