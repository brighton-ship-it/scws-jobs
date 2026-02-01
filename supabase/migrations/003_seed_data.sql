-- SCWS Job Management System - Seed Data
-- Run this after 001_initial_schema.sql and 002_seed_job_types.sql

-- ============================================
-- SAMPLE CUSTOMERS
-- ============================================
INSERT INTO public.customers (id, name, email, phone, billing_address, notes) VALUES
('c1000000-0000-0000-0000-000000000001', 'Johnson Ranch', 'robert@johnsonranch.com', '(760) 555-1234', '45678 Desert View Rd, Borrego Springs, CA 92004', 'Large property with multiple wells. Primary contact is Robert Johnson.'),
('c1000000-0000-0000-0000-000000000002', 'Desert Oasis HOA', 'manager@desertoasishoa.org', '(760) 555-2345', '1234 Palm Canyon Dr, Palm Springs, CA 92262', 'HOA account - requires PO for all work over $500'),
('c1000000-0000-0000-0000-000000000003', 'Maria Garcia', 'maria.g@email.com', '(760) 555-3456', '789 Cactus Lane, Indio, CA 92201', NULL);

-- ============================================
-- SAMPLE PROPERTIES
-- ============================================
INSERT INTO public.properties (id, customer_id, address, city, county, zip, lat, lng, access_notes) VALUES
('p1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '45678 Desert View Rd', 'Borrego Springs', 'San Diego', '92004', 33.2558, -116.3751, 'Gate code: 1234. Main house well is behind the barn.'),
('p1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '45700 Desert View Rd (North Parcel)', 'Borrego Springs', 'San Diego', '92004', 33.2575, -116.3748, 'Irrigation well for orchards. Access from main property.'),
('p1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002', '1234 Palm Canyon Dr', 'Palm Springs', 'Riverside', '92262', 33.8303, -116.5453, 'Community well house. Contact property manager for access.'),
('p1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000003', '789 Cactus Lane', 'Indio', 'Riverside', '92201', 33.7206, -116.2156, NULL);

-- ============================================
-- SAMPLE WELL INFO
-- ============================================
INSERT INTO public.well_info (id, property_id, well_depth, casing_diameter, static_water_level, pump_depth, pump_model, pump_hp, install_date, notes) VALUES
('w1000000-0000-0000-0000-000000000001', 'p1000000-0000-0000-0000-000000000001', 450, 8, 180, 400, 'Grundfos 25S50-12', 5, '2019-06-15', 'Replaced pump in 2019. Good water quality.'),
('w1000000-0000-0000-0000-000000000002', 'p1000000-0000-0000-0000-000000000002', 380, 6, 200, 340, 'Franklin 3-Wire', 3, '2021-03-20', 'Irrigation only. High mineral content.'),
('w1000000-0000-0000-0000-000000000003', 'p1000000-0000-0000-0000-000000000004', 280, 6, 120, 240, 'Goulds J10S', 1, '2015-08-10', 'Original pump. May need replacement soon.');

-- ============================================
-- SAMPLE JOBS
-- ============================================
INSERT INTO public.jobs (id, property_id, assigned_to, status, job_type, scheduled_date, scheduled_time, estimated_duration, description, internal_notes) VALUES
('j1000000-0000-0000-0000-000000000001', 'p1000000-0000-0000-0000-000000000001', NULL, 'scheduled', 'Pump Inspection', CURRENT_DATE, '09:00', '2 hours', 'Annual pump inspection and performance test', 'Customer mentioned slight pressure drop last month'),
('j1000000-0000-0000-0000-000000000002', 'p1000000-0000-0000-0000-000000000004', NULL, 'scheduled', 'Emergency Service', CURRENT_DATE, '14:00', '3 hours', 'No water - possible pump failure', NULL),
('j1000000-0000-0000-0000-000000000003', 'p1000000-0000-0000-0000-000000000002', NULL, 'in_progress', 'Pump Replacement', CURRENT_DATE, '08:00', '5 hours', 'Replace failing pump with new Goulds unit', 'Parts ordered and ready for pickup'),
('j1000000-0000-0000-0000-000000000004', 'p1000000-0000-0000-0000-000000000003', NULL, 'scheduled', 'Preventive Maintenance', CURRENT_DATE + 1, '10:00', '2 hours', 'Quarterly maintenance on irrigation well', NULL),
('j1000000-0000-0000-0000-000000000005', 'p1000000-0000-0000-0000-000000000001', NULL, 'completed', 'Preventive Maintenance', CURRENT_DATE - 7, '10:00', '2 hours', 'Completed maintenance visit', 'All systems normal');

-- ============================================
-- SAMPLE INVOICES
-- ============================================
INSERT INTO public.invoices (id, job_id, customer_id, invoice_number, amount, status, due_date, paid_at) VALUES
('i1000000-0000-0000-0000-000000000001', 'j1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000001', '2024-00001', 250.00, 'paid', CURRENT_DATE - 10, CURRENT_DATE - 5),
('i1000000-0000-0000-0000-000000000002', NULL, 'c1000000-0000-0000-0000-000000000002', '2024-00002', 475.00, 'sent', CURRENT_DATE + 14, NULL);

-- Note: To seed users, you must first create auth users through Supabase Auth
-- Then run something like:
-- INSERT INTO public.users (id, email, name, role, phone) VALUES
-- ('auth-user-id-here', 'admin@scwellservice.com', 'Admin User', 'admin', '(760) 555-0100');
