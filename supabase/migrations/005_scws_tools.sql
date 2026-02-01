-- SCWS Tools Migration
-- Tasks, Requests, Well Readings, Inventory, Pump Sizing

-- ============================================
-- TASKS TABLE (Internal company tasks)
-- ============================================
CREATE TABLE public.tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
    due_date DATE,
    due_time TIME,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view tasks" ON public.tasks
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage tasks" ON public.tasks
    FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX idx_tasks_assigned ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_due_date ON public.tasks(due_date);

-- ============================================
-- REQUESTS TABLE (Lead intake)
-- ============================================
CREATE TABLE public.requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    -- For new customers (not yet in system)
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    property_address TEXT,
    -- Request details
    title TEXT NOT NULL,
    description TEXT,
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'website', 'phone', 'referral', 'other')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'assessment_complete', 'converted', 'archived')),
    requested_date DATE,
    -- Conversion tracking
    converted_to_quote_id UUID,
    converted_to_job_id UUID,
    converted_at TIMESTAMPTZ,
    -- Metadata
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view requests" ON public.requests
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage requests" ON public.requests
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE INDEX idx_requests_status ON public.requests(status);
CREATE INDEX idx_requests_customer ON public.requests(customer_id);
CREATE INDEX idx_requests_created ON public.requests(created_at);

CREATE TRIGGER requests_updated_at
    BEFORE UPDATE ON public.requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================
-- WELL_READINGS TABLE (Historical depth data)
-- ============================================
CREATE TABLE public.well_readings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    reading_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reading_type TEXT NOT NULL CHECK (reading_type IN ('static_level', 'pumping_level', 'recovery', 'yield_test', 'depth_check')),
    -- Measurements (in feet)
    depth_to_water DECIMAL(8, 2),
    total_depth DECIMAL(8, 2),
    drawdown DECIMAL(8, 2),
    recovery_time_minutes INTEGER,
    yield_gpm DECIMAL(8, 2),
    -- Context
    notes TEXT,
    recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.well_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view well_readings" ON public.well_readings
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage well_readings" ON public.well_readings
    FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX idx_well_readings_property ON public.well_readings(property_id);
CREATE INDEX idx_well_readings_date ON public.well_readings(reading_date);

-- ============================================
-- VENDORS TABLE
-- ============================================
CREATE TABLE public.vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    website TEXT,
    account_number TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view vendors" ON public.vendors
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage vendors" ON public.vendors
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- INVENTORY_CATEGORIES TABLE
-- ============================================
CREATE TABLE public.inventory_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inventory_categories" ON public.inventory_categories
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage inventory_categories" ON public.inventory_categories
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
    );

-- Seed common categories
INSERT INTO public.inventory_categories (name, description) VALUES
    ('Pumps', 'Submersible pumps, jet pumps, booster pumps'),
    ('Motors', 'Pump motors, VFDs, controls'),
    ('Pipe & Fittings', 'PVC, steel, fittings, adapters'),
    ('Wire & Electrical', 'Submersible wire, conduit, breakers'),
    ('Pressure Tanks', 'Pressure tanks, bladders, fittings'),
    ('Well Components', 'Caps, seals, pitless adapters, torque arrestors'),
    ('Filtration', 'Filters, UV systems, softeners'),
    ('Tools & Equipment', 'Pulling equipment, tools, safety gear'),
    ('Miscellaneous', 'Other parts and supplies');

-- ============================================
-- INVENTORY_ITEMS TABLE
-- ============================================
CREATE TABLE public.inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES public.inventory_categories(id) ON DELETE SET NULL,
    vendor_id UUID REFERENCES public.vendors(id) ON DELETE SET NULL,
    -- Pricing
    cost DECIMAL(10, 2),
    price DECIMAL(10, 2),
    -- Stock
    quantity_on_hand DECIMAL(10, 2) DEFAULT 0,
    reorder_point DECIMAL(10, 2),
    reorder_quantity DECIMAL(10, 2),
    unit TEXT DEFAULT 'each',
    -- Pump/motor specific fields
    horsepower DECIMAL(5, 2),
    voltage INTEGER,
    phase INTEGER,
    gpm_rating DECIMAL(8, 2),
    max_head_feet INTEGER,
    -- Metadata
    location TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inventory_items" ON public.inventory_items
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage inventory_items" ON public.inventory_items
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE INDEX idx_inventory_items_category ON public.inventory_items(category_id);
CREATE INDEX idx_inventory_items_vendor ON public.inventory_items(vendor_id);
CREATE INDEX idx_inventory_items_sku ON public.inventory_items(sku);

CREATE TRIGGER inventory_items_updated_at
    BEFORE UPDATE ON public.inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================
-- INVENTORY_TRANSACTIONS TABLE
-- Track all stock movements
-- ============================================
CREATE TABLE public.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'sale', 'adjustment', 'job_use', 'return', 'transfer')),
    quantity DECIMAL(10, 2) NOT NULL,
    unit_cost DECIMAL(10, 2),
    -- References
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    purchase_order_id UUID,
    -- Metadata
    notes TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inventory_transactions" ON public.inventory_transactions
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert inventory_transactions" ON public.inventory_transactions
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX idx_inventory_transactions_item ON public.inventory_transactions(item_id);
CREATE INDEX idx_inventory_transactions_job ON public.inventory_transactions(job_id);
CREATE INDEX idx_inventory_transactions_date ON public.inventory_transactions(created_at);

-- Trigger to update inventory quantity on transaction
CREATE OR REPLACE FUNCTION update_inventory_quantity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.transaction_type IN ('purchase', 'return', 'adjustment') THEN
        UPDATE public.inventory_items 
        SET quantity_on_hand = quantity_on_hand + NEW.quantity
        WHERE id = NEW.item_id;
    ELSIF NEW.transaction_type IN ('sale', 'job_use') THEN
        UPDATE public.inventory_items 
        SET quantity_on_hand = quantity_on_hand - NEW.quantity
        WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_transaction_quantity
    AFTER INSERT ON public.inventory_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_inventory_quantity();

-- ============================================
-- PURCHASE_ORDERS TABLE
-- ============================================
CREATE TABLE public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_number TEXT UNIQUE NOT NULL,
    vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'partial', 'received', 'cancelled')),
    order_date DATE,
    expected_date DATE,
    received_date DATE,
    subtotal DECIMAL(10, 2),
    tax DECIMAL(10, 2),
    shipping DECIMAL(10, 2),
    total DECIMAL(10, 2),
    notes TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view purchase_orders" ON public.purchase_orders
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage purchase_orders" ON public.purchase_orders
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE INDEX idx_purchase_orders_vendor ON public.purchase_orders(vendor_id);
CREATE INDEX idx_purchase_orders_status ON public.purchase_orders(status);

CREATE TRIGGER purchase_orders_updated_at
    BEFORE UPDATE ON public.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Auto-generate PO numbers
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TRIGGER AS $$
DECLARE
    year_prefix TEXT;
    next_num INTEGER;
BEGIN
    year_prefix := 'PO-' || TO_CHAR(NOW(), 'YYYY');
    SELECT COALESCE(MAX(CAST(SUBSTRING(po_number FROM 9) AS INTEGER)), 0) + 1
    INTO next_num
    FROM public.purchase_orders
    WHERE po_number LIKE year_prefix || '-%';
    
    NEW.po_number := year_prefix || '-' || LPAD(next_num::TEXT, 4, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER po_auto_number
    BEFORE INSERT ON public.purchase_orders
    FOR EACH ROW
    WHEN (NEW.po_number IS NULL OR NEW.po_number = '')
    EXECUTE FUNCTION generate_po_number();

-- ============================================
-- PURCHASE_ORDER_ITEMS TABLE
-- ============================================
CREATE TABLE public.purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity_ordered DECIMAL(10, 2) NOT NULL,
    quantity_received DECIMAL(10, 2) DEFAULT 0,
    unit_cost DECIMAL(10, 2) NOT NULL,
    total DECIMAL(10, 2) GENERATED ALWAYS AS (quantity_ordered * unit_cost) STORED
);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view purchase_order_items" ON public.purchase_order_items
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin and office can manage purchase_order_items" ON public.purchase_order_items
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

-- ============================================
-- PUMP_SIZING_PRESETS TABLE
-- Save common pump configurations
-- ============================================
CREATE TABLE public.pump_sizing_presets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    -- Input parameters
    well_depth_feet INTEGER,
    static_water_level_feet INTEGER,
    desired_gpm DECIMAL(8, 2),
    pressure_psi INTEGER,
    pipe_length_feet INTEGER,
    pipe_diameter_inches DECIMAL(4, 2),
    elevation_change_feet INTEGER,
    -- Calculated results
    total_dynamic_head_feet INTEGER,
    recommended_hp DECIMAL(5, 2),
    recommended_pump_model TEXT,
    wire_size_awg INTEGER,
    pressure_tank_gallons INTEGER,
    -- Metadata
    notes TEXT,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.pump_sizing_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view pump_sizing_presets" ON public.pump_sizing_presets
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage pump_sizing_presets" ON public.pump_sizing_presets
    FOR ALL USING (auth.role() = 'authenticated');
