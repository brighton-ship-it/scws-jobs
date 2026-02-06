-- Add item_description column to quote_items if missing
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS item_description text;

-- Also add to invoice_items if it exists
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS item_description text;
