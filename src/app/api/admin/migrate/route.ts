import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// POST /api/admin/migrate - Run database migrations
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expectedToken = process.env.CRON_SECRET || 'migrate-secret-2024'
  
  if (authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = await pool.connect()
  const results: string[] = []

  try {
    // Migration 1: Inventory & Expenses
    await client.query(`
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
    `)
    results.push('✓ inventory_items table created')

    await client.query(`
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
    `)
    results.push('✓ stock_adjustments table created')

    await client.query(`
      CREATE TABLE IF NOT EXISTS job_parts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
        quantity_used INTEGER NOT NULL DEFAULT 1,
        unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(job_id, inventory_item_id)
      );
    `)
    results.push('✓ job_parts table created')

    await client.query(`
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
    `)
    results.push('✓ job_expenses table created')

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stock_adjustments_item ON stock_adjustments(inventory_item_id);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_parts_job ON job_parts(job_id);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_expenses_job ON job_expenses(job_id);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_job_expenses_category ON job_expenses(category);`)
    results.push('✓ indexes created')

    // Enable RLS
    await client.query(`ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;`)
    await client.query(`ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;`)
    await client.query(`ALTER TABLE job_parts ENABLE ROW LEVEL SECURITY;`)
    await client.query(`ALTER TABLE job_expenses ENABLE ROW LEVEL SECURITY;`)
    results.push('✓ RLS enabled')

    // Create policies (ignore if exists)
    try {
      await client.query(`CREATE POLICY "Allow all access to inventory_items" ON inventory_items FOR ALL USING (true);`)
    } catch (e) { /* policy may exist */ }
    try {
      await client.query(`CREATE POLICY "Allow all access to stock_adjustments" ON stock_adjustments FOR ALL USING (true);`)
    } catch (e) { /* policy may exist */ }
    try {
      await client.query(`CREATE POLICY "Allow all access to job_parts" ON job_parts FOR ALL USING (true);`)
    } catch (e) { /* policy may exist */ }
    try {
      await client.query(`CREATE POLICY "Allow all access to job_expenses" ON job_expenses FOR ALL USING (true);`)
    } catch (e) { /* policy may exist */ }
    results.push('✓ RLS policies created')

    // Seed inventory data
    await client.query(`
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
    `)
    results.push('✓ inventory seed data added')

    // Migration 2: Communications & Roles
    await client.query(`
      CREATE TABLE IF NOT EXISTS communications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
        type TEXT NOT NULL CHECK (type IN ('email', 'sms', 'call', 'note')),
        direction TEXT CHECK (direction IN ('inbound', 'outbound')),
        subject TEXT,
        body TEXT,
        sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)
    results.push('✓ communications table created')

    // Add role column to users
    try {
      await client.query(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'tech' CHECK (role IN ('admin', 'office', 'tech'));`)
      results.push('✓ role column added to users')
    } catch (e) {
      results.push('✓ role column already exists')
    }

    // Set admin roles
    await client.query(`UPDATE users SET role = 'admin' WHERE email IN ('brighton@scwellservice.com', 'info@scwellservice.com', 'bschroeder@scwellservice.com', 'lizbeth@scwellservice.com', 'roger@scwellservice.com', 'shanicey@scwellservice.com', 'travis@scwellservice.com');`)
    results.push('✓ admin roles set')

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_communications_customer ON communications(customer_id);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_communications_job ON communications(job_id);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_communications_type ON communications(type);`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`)
    results.push('✓ communications indexes created')

    // Enable RLS
    await client.query(`ALTER TABLE communications ENABLE ROW LEVEL SECURITY;`)
    try {
      await client.query(`CREATE POLICY "Allow all access to communications" ON communications FOR ALL USING (true);`)
    } catch (e) { /* policy may exist */ }
    results.push('✓ communications RLS enabled')

    return NextResponse.json({ 
      success: true, 
      message: 'All migrations completed successfully',
      results 
    })

  } catch (error: any) {
    console.error('[Migration] Error:', error)
    return NextResponse.json({ 
      error: 'Migration failed', 
      details: error.message,
      results 
    }, { status: 500 })
  } finally {
    client.release()
  }
}
