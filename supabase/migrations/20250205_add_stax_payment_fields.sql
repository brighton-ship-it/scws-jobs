-- Migration: Add Stax payment integration fields
-- This extends the existing payments table to support Stax transaction tracking

-- Add Stax-specific columns to payments table (if they don't exist)
DO $$ 
BEGIN
  -- Add stax_transaction_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'stax_transaction_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN stax_transaction_id VARCHAR(255);
  END IF;

  -- Add processing_fee column to track card processing fees
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'processing_fee'
  ) THEN
    ALTER TABLE payments ADD COLUMN processing_fee DECIMAL(10,2) DEFAULT 0;
  END IF;

  -- Add total_charged column to track actual amount charged (includes fee)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'total_charged'
  ) THEN
    ALTER TABLE payments ADD COLUMN total_charged DECIMAL(10,2);
  END IF;

  -- Add payment_status for tracking ACH pending status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'payment_status'
  ) THEN
    ALTER TABLE payments ADD COLUMN payment_status VARCHAR(50) DEFAULT 'completed';
  END IF;

  -- Add customer email for receipts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'customer_email'
  ) THEN
    ALTER TABLE payments ADD COLUMN customer_email VARCHAR(255);
  END IF;

  -- Add stax_customer_id to link with Stax customer records
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'stax_customer_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN stax_customer_id VARCHAR(255);
  END IF;

  -- Add stax_payment_method_id for stored payment methods
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'stax_payment_method_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN stax_payment_method_id VARCHAR(255);
  END IF;
END $$;

-- Create index on stax_transaction_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_stax_transaction_id 
ON payments(stax_transaction_id) 
WHERE stax_transaction_id IS NOT NULL;

-- Create index on payment_status for filtering
CREATE INDEX IF NOT EXISTS idx_payments_status 
ON payments(payment_status);

-- Add comment describing the payment status values
COMMENT ON COLUMN payments.payment_status IS 'Payment status: completed, pending (ACH), failed, refunded, voided';
COMMENT ON COLUMN payments.stax_transaction_id IS 'Stax payment gateway transaction ID';
COMMENT ON COLUMN payments.processing_fee IS 'Card processing fee (typically 3% for credit cards)';
COMMENT ON COLUMN payments.total_charged IS 'Total amount charged including processing fee';

-- Update existing reference_number to be an alias for stax_transaction_id
-- (reference_number can continue to be used, but stax_transaction_id is preferred)
COMMENT ON COLUMN payments.reference_number IS 'Legacy field - use stax_transaction_id for Stax payments';
