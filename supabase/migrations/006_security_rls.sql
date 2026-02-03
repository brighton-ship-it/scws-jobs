-- Security: Row Level Security (RLS) Policies
-- Run this in Supabase SQL Editor

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SERVICE ROLE BYPASS (for API routes)
-- ============================================

-- Service role can do everything (for server-side API routes)
CREATE POLICY "Service role has full access to customers"
  ON customers FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to properties"
  ON properties FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to jobs"
  ON jobs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to quotes"
  ON quotes FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to invoices"
  ON invoices FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to invoice_line_items"
  ON invoice_line_items FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to payments"
  ON payments FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to users"
  ON users FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to inventory"
  ON inventory_items FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to automations"
  ON automations FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to portal_tokens"
  ON portal_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================
-- AUTHENTICATED USER POLICIES
-- ============================================

-- Authenticated users (staff) can read all customers
CREATE POLICY "Staff can view all customers"
  ON customers FOR SELECT
  USING (auth.role() = 'authenticated');

-- Authenticated users can manage customers
CREATE POLICY "Staff can manage customers"
  ON customers FOR ALL
  USING (auth.role() = 'authenticated');

-- Authenticated users can view all jobs
CREATE POLICY "Staff can view all jobs"
  ON jobs FOR SELECT
  USING (auth.role() = 'authenticated');

-- Authenticated users can manage jobs
CREATE POLICY "Staff can manage jobs"
  ON jobs FOR ALL
  USING (auth.role() = 'authenticated');

-- Similar for other tables
CREATE POLICY "Staff can manage properties"
  ON properties FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage quotes"
  ON quotes FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage invoices"
  ON invoices FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage invoice line items"
  ON invoice_line_items FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage payments"
  ON payments FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage inventory"
  ON inventory_items FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can view automations"
  ON automations FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can manage automations
CREATE POLICY "Admins can manage automations"
  ON automations FOR ALL
  USING (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Only admins can manage users
CREATE POLICY "Admins can manage users"
  ON users FOR ALL
  USING (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );

-- ============================================
-- PORTAL ACCESS (Anonymous with valid token)
-- ============================================

-- Portal tokens are only accessible via service role
-- (Portal API uses service role to validate tokens)

-- ============================================
-- SMS TABLES (if they exist)
-- ============================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sms_messages') THEN
    ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
    
    CREATE POLICY "Service role has full access to sms_messages"
      ON sms_messages FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sms_conversations') THEN
    ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;
    
    CREATE POLICY "Service role has full access to sms_conversations"
      ON sms_conversations FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================
-- AUDIT LOG TABLE (New)
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only service role can write audit logs
CREATE POLICY "Service role can manage audit logs"
  ON audit_logs FOR ALL
  USING (auth.role() = 'service_role');

-- Admins can read audit logs
CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
    )
  );
