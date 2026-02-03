-- Migration: Add item_description and taxable fields to quote_items
-- Date: 2025-02-02

-- Add item_description column for extended descriptions
ALTER TABLE public.quote_items 
ADD COLUMN IF NOT EXISTS item_description TEXT;

-- Add taxable column with default true
ALTER TABLE public.quote_items 
ADD COLUMN IF NOT EXISTS taxable BOOLEAN NOT NULL DEFAULT true;

-- Also add to invoice_items for consistency
ALTER TABLE public.invoice_items 
ADD COLUMN IF NOT EXISTS item_description TEXT;

ALTER TABLE public.invoice_items 
ADD COLUMN IF NOT EXISTS taxable BOOLEAN NOT NULL DEFAULT true;

-- Update the quote totals trigger to handle taxable items
CREATE OR REPLACE FUNCTION update_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_subtotal DECIMAL(10, 2);
    v_taxable_subtotal DECIMAL(10, 2);
    v_tax_rate DECIMAL(5, 3);
BEGIN
    -- Get the tax rate for this quote
    SELECT tax_rate INTO v_tax_rate
    FROM public.quotes 
    WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
    
    -- Calculate subtotal (all items)
    SELECT COALESCE(SUM(total), 0) INTO v_subtotal
    FROM public.quote_items 
    WHERE quote_id = COALESCE(NEW.quote_id, OLD.quote_id);
    
    -- Calculate taxable subtotal (only taxable items)
    SELECT COALESCE(SUM(total), 0) INTO v_taxable_subtotal
    FROM public.quote_items 
    WHERE quote_id = COALESCE(NEW.quote_id, OLD.quote_id)
    AND taxable = true;
    
    -- Update quote with new totals
    UPDATE public.quotes
    SET 
        subtotal = v_subtotal,
        tax_amount = v_taxable_subtotal * (v_tax_rate / 100),
        total = v_subtotal + (v_taxable_subtotal * (v_tax_rate / 100)),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Update the invoice totals trigger to handle taxable items
CREATE OR REPLACE FUNCTION update_invoice_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_subtotal DECIMAL(10, 2);
    v_taxable_subtotal DECIMAL(10, 2);
    v_tax_rate DECIMAL(5, 3);
BEGIN
    -- Get the tax rate for this invoice
    SELECT tax_rate INTO v_tax_rate
    FROM public.invoices 
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    -- Calculate subtotal (all items)
    SELECT COALESCE(SUM(total), 0) INTO v_subtotal
    FROM public.invoice_items 
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    -- Calculate taxable subtotal (only taxable items)
    SELECT COALESCE(SUM(total), 0) INTO v_taxable_subtotal
    FROM public.invoice_items 
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    AND taxable = true;
    
    -- Update invoice with new totals
    UPDATE public.invoices
    SET 
        subtotal = v_subtotal,
        tax_amount = v_taxable_subtotal * (v_tax_rate / 100),
        total = v_subtotal + (v_taxable_subtotal * (v_tax_rate / 100)),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Add comment to document the change
COMMENT ON COLUMN public.quote_items.item_description IS 'Extended description text shown below the item name';
COMMENT ON COLUMN public.quote_items.taxable IS 'Whether this line item is subject to sales tax (default: true)';
COMMENT ON COLUMN public.invoice_items.item_description IS 'Extended description text shown below the item name';
COMMENT ON COLUMN public.invoice_items.taxable IS 'Whether this line item is subject to sales tax (default: true)';
