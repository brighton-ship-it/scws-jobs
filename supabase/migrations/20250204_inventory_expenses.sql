-- ==================== INVENTORY MANAGEMENT ====================

-- Inventory Items Table
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('Pumps', 'Motors', 'Tanks', 'Fittings', 'Wire', 'Controls', 'Misc')),
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  vendor TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stock Adjustments Table (for tracking history)
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_change INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('purchase', 'job_usage', 'manual_adjustment', 'return', 'damaged', 'inventory_count')),
  notes TEXT,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  adjusted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Job Parts Table (parts used on jobs)
CREATE TABLE IF NOT EXISTS job_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity_used INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, inventory_item_id)
);

-- ==================== EXPENSE TRACKING ====================

-- Job Expenses Table
CREATE TABLE IF NOT EXISTS job_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('Fuel', 'Materials', 'Permits', 'Disposal', 'Subcontractor', 'Equipment Rental', 'Other')),
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  vendor TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_url TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_items_low_stock ON inventory_items(quantity, reorder_level) WHERE quantity <= reorder_level;

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_item ON stock_adjustments(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_job ON stock_adjustments(job_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_date ON stock_adjustments(created_at);

CREATE INDEX IF NOT EXISTS idx_job_parts_job ON job_parts(job_id);
CREATE INDEX IF NOT EXISTS idx_job_parts_item ON job_parts(inventory_item_id);

CREATE INDEX IF NOT EXISTS idx_job_expenses_job ON job_expenses(job_id);
CREATE INDEX IF NOT EXISTS idx_job_expenses_category ON job_expenses(category);
CREATE INDEX IF NOT EXISTS idx_job_expenses_date ON job_expenses(expense_date);

-- ==================== TRIGGERS ====================

-- Update timestamp trigger for inventory_items
CREATE OR REPLACE FUNCTION update_inventory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_items_updated_at
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION update_inventory_updated_at();

-- Update timestamp trigger for job_expenses
CREATE TRIGGER job_expenses_updated_at
  BEFORE UPDATE ON job_expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_inventory_updated_at();

-- ==================== RLS POLICIES ====================

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_expenses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (adjust as needed for your auth setup)
CREATE POLICY "Allow all access to inventory_items" ON inventory_items FOR ALL USING (true);
CREATE POLICY "Allow all access to stock_adjustments" ON stock_adjustments FOR ALL USING (true);
CREATE POLICY "Allow all access to job_parts" ON job_parts FOR ALL USING (true);
CREATE POLICY "Allow all access to job_expenses" ON job_expenses FOR ALL USING (true);

-- ==================== SEED DATA ====================

INSERT INTO inventory_items (name, sku, category, quantity, unit_cost, reorder_level, location, vendor) VALUES
  ('3HP Submersible Pump', 'PUMP-3HP-230', 'Pumps', 4, 850.00, 2, 'Warehouse A', 'Franklin Electric'),
  ('1HP Submersible Pump', 'PUMP-1HP-230', 'Pumps', 6, 425.00, 3, 'Warehouse A', 'Franklin Electric'),
  ('5HP Pump Motor', 'MOTOR-5HP-230', 'Motors', 1, 1200.00, 2, 'Warehouse A', 'Franklin Electric'),
  ('86 Gallon Pressure Tank', 'TANK-86GAL', 'Tanks', 3, 650.00, 2, 'Warehouse B', 'Well-X-Trol'),
  ('10 AWG Submersible Wire (500ft)', 'WIRE-10AWG-500', 'Wire', 2, 425.00, 3, 'Warehouse A', 'Southwire'),
  ('2" Drop Pipe (20ft)', 'PIPE-2IN-20FT', 'Fittings', 45, 85.00, 20, 'Yard', 'Ferguson'),
  ('5HP Variable Frequency Drive', 'VFD-5HP', 'Controls', 0, 2100.00, 1, 'Warehouse A', 'Grundfos'),
  ('Pressure Switch 30/50', 'CTRL-PS-3050', 'Controls', 12, 35.00, 5, 'Warehouse A', 'Square D'),
  ('Well Cap 6"', 'FIT-CAP-6', 'Fittings', 8, 45.00, 4, 'Warehouse A', 'Merrill'),
  ('Pitless Adapter 1.25"', 'FIT-PA-125', 'Fittings', 6, 125.00, 3, 'Warehouse A', 'Merrill')
ON CONFLICT (sku) DO NOTHING;
