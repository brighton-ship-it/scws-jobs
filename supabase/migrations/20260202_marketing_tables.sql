-- Marketing Module Tables
-- Campaigns, Templates, Segments for email/SMS marketing

-- ============================================
-- TEMPLATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS marketing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('email', 'sms')),
  category VARCHAR(50) NOT NULL CHECK (category IN ('reminders', 'follow-ups', 'promotions', 'transactional')),
  subject VARCHAR(500), -- email only
  content TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb, -- list of variable names used
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SEGMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS marketing_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('system', 'custom', 'location', 'service', 'dynamic')),
  conditions JSONB DEFAULT '[]'::jsonb, -- array of {field, operator, value}
  customer_count INTEGER DEFAULT 0,
  is_dynamic BOOLEAN DEFAULT false, -- auto-updates on query
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CAMPAIGNS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('email', 'sms')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  
  -- Content
  template_id UUID REFERENCES marketing_templates(id),
  subject VARCHAR(500), -- email only
  content TEXT NOT NULL,
  
  -- Targeting
  segment_id UUID REFERENCES marketing_segments(id),
  recipient_count INTEGER DEFAULT 0,
  
  -- Scheduling
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Stats (updated after send)
  delivered INTEGER DEFAULT 0,
  opened INTEGER DEFAULT 0,
  clicked INTEGER DEFAULT 0,
  bounced INTEGER DEFAULT 0,
  unsubscribed INTEGER DEFAULT 0,
  replied INTEGER DEFAULT 0, -- SMS only
  
  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CAMPAIGN RECIPIENTS TABLE
-- Track individual send status per recipient
-- ============================================
CREATE TABLE IF NOT EXISTS marketing_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  
  -- Contact info at time of send
  email VARCHAR(255),
  phone VARCHAR(50),
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'unsubscribed')),
  
  -- Timestamps
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  
  -- Error tracking
  error_message TEXT,
  
  -- External IDs
  external_message_id VARCHAR(255), -- Twilio SID or SendGrid ID
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(campaign_id, customer_id)
);

-- ============================================
-- UNSUBSCRIBES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS marketing_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms', 'all')),
  reason TEXT,
  campaign_id UUID REFERENCES marketing_campaigns(id), -- which campaign triggered unsub
  unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(customer_id, channel)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_campaigns_status ON marketing_campaigns(status);
CREATE INDEX idx_campaigns_type ON marketing_campaigns(type);
CREATE INDEX idx_campaigns_scheduled ON marketing_campaigns(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX idx_campaign_recipients_campaign ON marketing_campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_customer ON marketing_campaign_recipients(customer_id);
CREATE INDEX idx_campaign_recipients_status ON marketing_campaign_recipients(status);
CREATE INDEX idx_templates_type ON marketing_templates(type);
CREATE INDEX idx_segments_type ON marketing_segments(type);
CREATE INDEX idx_unsubscribes_customer ON marketing_unsubscribes(customer_id);

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_marketing_templates_updated_at
  BEFORE UPDATE ON marketing_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_marketing_segments_updated_at
  BEFORE UPDATE ON marketing_segments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_marketing_campaigns_updated_at
  BEFORE UPDATE ON marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_marketing_campaign_recipients_updated_at
  BEFORE UPDATE ON marketing_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DEFAULT TEMPLATES
-- ============================================
INSERT INTO marketing_templates (name, type, category, subject, content, variables) VALUES
-- Email Templates
('Appointment Reminder - 24hr', 'email', 'reminders', 
 'Reminder: Your well service appointment is tomorrow',
 E'Hi {{customer_name}},\n\nThis is a reminder that your appointment with Southern California Well Service is scheduled for tomorrow, {{appointment_date}} at {{appointment_time}}.\n\nService: {{service_type}}\nAddress: {{address}}\n\nIf you need to reschedule, please call us at (760) 440-8520.\n\nThank you for choosing SCWS!\n\nSouthern California Well Service\n(760) 440-8520\nwww.scwellservice.com',
 '["customer_name", "appointment_date", "appointment_time", "service_type", "address"]'),

('Appointment Confirmation', 'email', 'reminders',
 'Your appointment is confirmed!',
 E'Hi {{customer_name}},\n\nThank you for scheduling with Southern California Well Service!\n\nYour appointment has been confirmed:\n\nDate: {{appointment_date}}\nTime: {{appointment_time}}\nTechnician: {{tech_name}}\nAddress: {{address}}\n\nPlease ensure access to your well and any relevant equipment.\n\nQuestions? Call (760) 440-8520\n\nSouthern California Well Service',
 '["customer_name", "appointment_date", "appointment_time", "tech_name", "address"]'),

('Quote Follow-up', 'email', 'follow-ups',
 'Following up on your well service quote',
 E'Hi {{customer_name}},\n\nWe wanted to follow up on the quote we sent for {{service_type}} at {{address}}.\n\nQuote Total: {{quote_amount}}\nQuote Date: {{quote_date}}\n\nDo you have any questions about the proposed work? We''re happy to explain anything in more detail.\n\nReady to proceed? Just reply to this email or call (760) 440-8520.\n\nThank you,\nSouthern California Well Service',
 '["customer_name", "service_type", "address", "quote_amount", "quote_date"]'),

('Annual Maintenance Reminder', 'email', 'promotions',
 'It''s time for your annual well inspection',
 E'Hi {{customer_name}},\n\nIt''s been a year since your last well service at {{address}}. Regular maintenance helps prevent costly emergency repairs and ensures your water quality stays excellent.\n\nLast Service: {{last_service_date}}\n\nSchedule your annual inspection today:\n• Well pump check\n• Pressure tank inspection\n• Water quality test\n• System efficiency review\n\nCall (760) 440-8520 or reply to schedule.\n\nSouthern California Well Service\nFamily-owned since 1988',
 '["customer_name", "address", "last_service_date"]'),

-- SMS Templates
('Appointment Reminder - 24hr', 'sms', 'reminders',
 NULL,
 'SCWS Reminder: Your appointment is tomorrow at {{appointment_time}}. Reply CONFIRM or call (760) 440-8520 to reschedule.',
 '["appointment_time"]'),

('Tech On The Way', 'sms', 'reminders',
 NULL,
 '{{tech_name}} from SCWS is on the way! ETA: {{eta}}. Questions? Call (760) 440-8520',
 '["tech_name", "eta"]'),

('Quote Ready', 'sms', 'follow-ups',
 NULL,
 'Your quote from SCWS is ready! Total: ${{amount}}. View and approve: {{quote_link}}',
 '["amount", "quote_link"]'),

('Payment Link', 'sms', 'transactional',
 NULL,
 'SCWS Invoice #{{invoice_number}}: ${{amount}} due. Pay securely: {{payment_link}}',
 '["invoice_number", "amount", "payment_link"]'),

('Review Request', 'sms', 'follow-ups',
 NULL,
 'Thanks for choosing SCWS! How was your service? Leave a review: {{review_link}}',
 '["review_link"]');

-- ============================================
-- SEED DEFAULT SEGMENTS
-- ============================================
INSERT INTO marketing_segments (name, description, type, conditions, is_dynamic) VALUES
('All Customers', 'Every customer in your database', 'system', '[]', false),
('Active Customers', 'Customers with service in the past 12 months', 'system', '[{"field": "last_service", "operator": "within", "value": "12 months"}]', true),
('Last Service > 6 Months', 'Customers due for maintenance', 'custom', '[{"field": "last_service", "operator": "more_than", "value": "6 months ago"}]', true),
('Ramona Area', 'Customers in Ramona and surrounding areas', 'location', '[{"field": "city", "operator": "in", "value": "Ramona"}]', true),
('Anza Service Area', 'Customers in Anza and Cahuilla', 'location', '[{"field": "city", "operator": "in", "value": "Anza, Cahuilla"}]', true),
('High Value Customers', 'Total spend over $5,000', 'custom', '[{"field": "total_spend", "operator": "greater_than", "value": "5000"}]', true),
('Open Quotes > 7 Days', 'Quotes pending for over a week', 'custom', '[{"field": "quote_status", "operator": "equals", "value": "pending"}, {"field": "quote_age", "operator": "greater_than", "value": "7 days"}]', true),
('Well Drilling Customers', 'Customers who had well drilling services', 'service', '[{"field": "service_type", "operator": "includes", "value": "Well Drilling"}]', true),
('Pump Repair Customers', 'Customers who had pump repair/replacement', 'service', '[{"field": "service_type", "operator": "includes", "value": "Pump Repair"}]', true),
('Tomorrow Appointments', 'Customers with appointments tomorrow', 'dynamic', '[{"field": "next_appointment", "operator": "equals", "value": "tomorrow"}]', true);
