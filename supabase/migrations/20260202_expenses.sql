-- Expense Tracking & Job Costing
-- Track costs, receipts, and profit per job

-- ============================================
-- EXPENSE CATEGORIES
-- ============================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default categories
INSERT INTO expense_categories (name, description) VALUES
  ('Materials', 'Pumps, pipes, fittings, etc.'),
  ('Fuel', 'Vehicle fuel costs'),
  ('Equipment Rental', 'Rented equipment'),
  ('Subcontractor', 'Third-party services'),
  ('Permits', 'Permit fees'),
  ('Disposal', 'Waste disposal fees'),
  ('Other', 'Miscellaneous expenses')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- EXPENSES
-- ============================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Link to job (optional - can be general expense)
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  
  -- Expense details
  category_id UUID REFERENCES expense_categories(id),
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  
  -- Vendor/supplier
  vendor VARCHAR(255),
  
  -- Date
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Receipt
  receipt_attachment_id UUID, -- Link to job_attachments
  receipt_number VARCHAR(100),
  
  -- Reimbursement
  is_reimbursable BOOLEAN DEFAULT false,
  reimbursed_at TIMESTAMPTZ,
  reimbursed_to UUID REFERENCES auth.users(id),
  
  -- Who logged it
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- JOB COSTING SUMMARY VIEW
-- ============================================
CREATE OR REPLACE VIEW job_cost_summary AS
SELECT 
  j.id as job_id,
  j.job_type as title,
  j.status,
  p.customer_id,
  c.name as customer_name,
  
  -- Revenue
  COALESCE(exp.total_expenses, 0) as total_expenses,
  
  -- Profit placeholder (needs invoices table check)
  0 as estimated_profit,
  0 as profit_margin_pct

FROM jobs j
LEFT JOIN properties p ON j.property_id = p.id
LEFT JOIN customers c ON p.customer_id = c.id
LEFT JOIN (
  SELECT job_id, SUM(amount) as total_expenses
  FROM expenses
  GROUP BY job_id
) exp ON j.id = exp.job_id;

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_expenses_job ON expenses(job_id);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_created_by ON expenses(created_by);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
