-- Customer Equipment Tracking
-- Track well pumps, motors, tanks, and other equipment

-- ============================================
-- CUSTOMER EQUIPMENT TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS customer_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  
  -- Equipment details
  equipment_type VARCHAR(100) NOT NULL, -- pump, motor, tank, pressure_switch, etc.
  manufacturer VARCHAR(255),
  model VARCHAR(255),
  serial_number VARCHAR(255),
  
  -- Dates
  install_date DATE,
  warranty_expires DATE,
  
  -- Additional info
  notes TEXT,
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_customer_equipment_customer ON customer_equipment(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_equipment_property ON customer_equipment(property_id);
CREATE INDEX IF NOT EXISTS idx_customer_equipment_type ON customer_equipment(equipment_type);
CREATE INDEX IF NOT EXISTS idx_customer_equipment_warranty ON customer_equipment(warranty_expires);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_customer_equipment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customer_equipment_updated_at
  BEFORE UPDATE ON customer_equipment
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_equipment_updated_at();

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE customer_equipment ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view equipment
CREATE POLICY "Users can view equipment" ON customer_equipment
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert equipment
CREATE POLICY "Users can insert equipment" ON customer_equipment
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can update equipment
CREATE POLICY "Users can update equipment" ON customer_equipment
  FOR UPDATE
  TO authenticated
  USING (true);

-- Authenticated users can delete equipment
CREATE POLICY "Users can delete equipment" ON customer_equipment
  FOR DELETE
  TO authenticated
  USING (true);

-- ============================================
-- VIEW: Equipment with warranty expiring soon
-- ============================================
CREATE OR REPLACE VIEW equipment_warranty_alerts AS
SELECT 
  ce.*,
  c.name as customer_name,
  c.phone as customer_phone,
  c.email as customer_email,
  p.address as property_address,
  CASE 
    WHEN ce.warranty_expires < CURRENT_DATE THEN 'expired'
    WHEN ce.warranty_expires <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
    ELSE 'valid'
  END as warranty_status,
  ce.warranty_expires - CURRENT_DATE as days_until_expiry
FROM customer_equipment ce
JOIN customers c ON ce.customer_id = c.id
LEFT JOIN properties p ON ce.property_id = p.id
WHERE ce.warranty_expires IS NOT NULL
ORDER BY ce.warranty_expires ASC;
