-- QuickBooks Integration Tables

-- Store QuickBooks OAuth connections
CREATE TABLE IF NOT EXISTS quickbooks_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  realm_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  environment TEXT DEFAULT 'sandbox',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Add QuickBooks IDs to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS qb_customer_id TEXT;

-- Add QuickBooks IDs to invoices table
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS qb_invoice_id TEXT;

-- Add QuickBooks IDs to payments table
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS qb_payment_id TEXT;

-- Row Level Security
ALTER TABLE quickbooks_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own QB connections"
ON quickbooks_connections
FOR ALL
USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_customers_qb_id ON customers(qb_customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_qb_id ON invoices(qb_invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_qb_id ON payments(qb_payment_id);
