-- Vehicle Registration Tracking for Fleet Management
-- Migration: 20260206_vehicle_registration.sql

-- =====================================================
-- VEHICLES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,  -- e.g., "White F-350", "Blue Silverado"
    license_plate VARCHAR(50),
    vin VARCHAR(50),
    year INTEGER,
    make VARCHAR(100),  -- e.g., "Ford", "Chevrolet"
    model VARCHAR(100), -- e.g., "F-350", "Silverado 2500"
    registration_due_date DATE,
    insurance_expiry_date DATE,
    assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'sold', 'maintenance')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient querying by registration due date
CREATE INDEX IF NOT EXISTS idx_vehicles_registration_due ON vehicles(registration_due_date);
CREATE INDEX IF NOT EXISTS idx_vehicles_assigned_user ON vehicles(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

-- =====================================================
-- VEHICLE REMINDERS TABLE (for tracking sent notifications)
-- =====================================================
CREATE TABLE IF NOT EXISTS vehicle_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    reminder_type VARCHAR(50) NOT NULL,  -- 'registration', 'insurance'
    days_before INTEGER NOT NULL,  -- 60, 30, 14, 7
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for checking if reminder was already sent
CREATE INDEX IF NOT EXISTS idx_vehicle_reminders_lookup ON vehicle_reminders(vehicle_id, reminder_type, days_before);

-- =====================================================
-- UPDATED_AT TRIGGER
-- =====================================================
CREATE OR REPLACE FUNCTION update_vehicles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicles_updated_at ON vehicles;
CREATE TRIGGER vehicles_updated_at
    BEFORE UPDATE ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_vehicles_updated_at();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_reminders ENABLE ROW LEVEL SECURITY;

-- Policy for vehicles - allow all authenticated users to view
CREATE POLICY "Allow authenticated users to view vehicles"
    ON vehicles FOR SELECT
    TO authenticated
    USING (true);

-- Policy for vehicles - allow admin/office to modify
CREATE POLICY "Allow admin/office to manage vehicles"
    ON vehicles FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policy for vehicle_reminders
CREATE POLICY "Allow authenticated users to view reminders"
    ON vehicle_reminders FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow system to manage reminders"
    ON vehicle_reminders FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- =====================================================
-- USEFUL VIEWS
-- =====================================================

-- View for vehicles with upcoming registration expirations
CREATE OR REPLACE VIEW vehicles_registration_alerts AS
SELECT 
    v.*,
    u.name as assigned_user_name,
    u.email as assigned_user_email,
    u.phone as assigned_user_phone,
    CASE 
        WHEN v.registration_due_date < CURRENT_DATE THEN 'expired'
        WHEN v.registration_due_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
        WHEN v.registration_due_date <= CURRENT_DATE + INTERVAL '60 days' THEN 'upcoming'
        ELSE 'current'
    END as registration_status,
    v.registration_due_date - CURRENT_DATE as days_until_due
FROM vehicles v
LEFT JOIN users u ON v.assigned_user_id = u.id
WHERE v.status = 'active'
ORDER BY v.registration_due_date ASC NULLS LAST;

-- =====================================================
-- SAMPLE SEED DATA (optional - comment out if not needed)
-- =====================================================
-- INSERT INTO vehicles (name, license_plate, vin, year, make, model, registration_due_date, status, notes) VALUES
-- ('White F-350', '8ABC123', '1FTRF3B69KEA12345', 2019, 'Ford', 'F-350 Super Duty', '2025-03-15', 'active', 'Main service truck'),
-- ('Blue Silverado', '8XYZ789', '1GCUD9E36LZ123456', 2020, 'Chevrolet', 'Silverado 2500HD', '2025-02-28', 'active', 'Secondary truck'),
-- ('Red Transit Van', '8DEF456', 'WF0TB4CG0LKA54321', 2021, 'Ford', 'Transit 250', '2025-04-20', 'active', 'Parts/equipment van');
