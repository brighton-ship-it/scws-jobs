// Mock data for development without Supabase connection
import type { 
  User, Customer, Property, WellInfo, Job, Invoice, JobType, 
  Quote, QuoteItem, InvoiceItem, Payment, Product, 
  QuoteWithDetails, InvoiceWithDetails, Task, TaskWithDetails,
  JobAssignment, JobAssignmentWithUser, QuoteChangeRequest
} from '@/types/database';

export const mockUsers: User[] = [
  {
    id: '1',
    email: 'brighton@scwellservice.com',
    name: 'Brighton',
    role: 'admin',
    phone: '(760) 555-0100',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '2',
    email: 'sarah@scwellservice.com',
    name: 'Sarah Martinez',
    role: 'office',
    phone: '(760) 555-0101',
    created_at: '2024-01-15T00:00:00Z',
  },
  {
    id: '3',
    email: 'mike@scwellservice.com',
    name: 'Mike Thompson',
    role: 'field',
    phone: '(760) 555-0102',
    created_at: '2024-02-01T00:00:00Z',
  },
  {
    id: '4',
    email: 'carlos@scwellservice.com',
    name: 'Carlos Rivera',
    role: 'field',
    phone: '(760) 555-0103',
    created_at: '2024-03-01T00:00:00Z',
  },
  {
    id: '5',
    email: 'jake@scwellservice.com',
    name: 'Jake Wilson',
    role: 'field',
    phone: '(760) 555-0104',
    created_at: '2024-04-01T00:00:00Z',
  },
  {
    id: '6',
    email: 'david@scwellservice.com',
    name: 'David Chen',
    role: 'field',
    phone: '(760) 555-0105',
    created_at: '2024-04-15T00:00:00Z',
  },
  {
    id: '7',
    email: 'tony@scwellservice.com',
    name: 'Tony Rodriguez',
    role: 'field',
    phone: '(760) 555-0106',
    created_at: '2024-05-01T00:00:00Z',
  },
  {
    id: '8',
    email: 'marcus@scwellservice.com',
    name: 'Marcus Johnson',
    role: 'field',
    phone: '(760) 555-0107',
    created_at: '2024-05-15T00:00:00Z',
  },
  {
    id: '9',
    email: 'ryan@scwellservice.com',
    name: 'Ryan Patterson',
    role: 'field',
    phone: '(760) 555-0108',
    created_at: '2024-06-01T00:00:00Z',
  },
  {
    id: '10',
    email: 'luis@scwellservice.com',
    name: 'Luis Garcia',
    role: 'field',
    phone: '(760) 555-0109',
    created_at: '2024-06-15T00:00:00Z',
  },
  {
    id: '11',
    email: 'jennifer@scwellservice.com',
    name: 'Jennifer Lee',
    role: 'office',
    phone: '(760) 555-0110',
    created_at: '2024-07-01T00:00:00Z',
  },
  {
    id: '12',
    email: 'kevin@scwellservice.com',
    name: 'Kevin Brown',
    role: 'field',
    phone: '(760) 555-0111',
    created_at: '2024-07-15T00:00:00Z',
  },
  {
    id: '13',
    email: 'steve@scwellservice.com',
    name: 'Steve Mitchell',
    role: 'field',
    phone: '(760) 555-0112',
    created_at: '2024-08-01T00:00:00Z',
  },
  {
    id: '14',
    email: 'alex@scwellservice.com',
    name: 'Alex Hernandez',
    role: 'field',
    phone: '(760) 555-0113',
    created_at: '2024-08-15T00:00:00Z',
  },
  {
    id: '15',
    email: 'jason@scwellservice.com',
    name: 'Jason Miller',
    role: 'field',
    phone: '(760) 555-0114',
    created_at: '2024-09-01T00:00:00Z',
  },
  {
    id: '16',
    email: 'tom@scwellservice.com',
    name: 'Tom Anderson',
    role: 'field',
    phone: '(760) 555-0115',
    created_at: '2024-09-15T00:00:00Z',
  },
  {
    id: '17',
    email: 'chris@scwellservice.com',
    name: 'Chris Taylor',
    role: 'field',
    phone: '(760) 555-0116',
    created_at: '2024-10-01T00:00:00Z',
  },
];

// Helper to get field crew members
export function getFieldCrew(): User[] {
  return mockUsers.filter(u => u.role === 'field');
}

export const mockCustomers: Customer[] = [
  {
    id: '1',
    name: 'Johnson Ranch',
    email: 'robert@johnsonranch.com',
    phone: '(760) 555-1234',
    billing_address: '45678 Desert View Rd, Borrego Springs, CA 92004',
    notes: 'Large property with multiple wells. Primary contact is Robert Johnson.',
    created_at: '2024-01-15T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
  },
  {
    id: '2',
    name: 'Desert Oasis HOA',
    email: 'manager@desertoasishoa.org',
    phone: '(760) 555-2345',
    billing_address: '1234 Palm Canyon Dr, Palm Springs, CA 92262',
    notes: 'HOA account - requires PO for all work over $500',
    created_at: '2024-02-20T00:00:00Z',
    updated_at: '2024-05-15T00:00:00Z',
  },
  {
    id: '3',
    name: 'Maria Garcia',
    email: 'maria.g@email.com',
    phone: '(760) 555-3456',
    billing_address: '789 Cactus Lane, Indio, CA 92201',
    notes: null,
    created_at: '2024-03-10T00:00:00Z',
    updated_at: '2024-03-10T00:00:00Z',
  },
  {
    id: '4',
    name: 'Sunny Acres Farm',
    email: 'contact@sunnyacres.farm',
    phone: '(760) 555-4567',
    billing_address: '5500 Highway 86, Coachella, CA 92236',
    notes: 'Agricultural account. Irrigation wells need quarterly maintenance.',
    created_at: '2024-04-05T00:00:00Z',
    updated_at: '2024-06-20T00:00:00Z',
  },
  {
    id: '5',
    name: 'The Williams Family',
    email: 'dwilliams@gmail.com',
    phone: '(760) 555-5678',
    billing_address: '2100 Mountain View Rd, Joshua Tree, CA 92252',
    notes: 'Vacation home - schedule appointments via email first',
    created_at: '2024-05-12T00:00:00Z',
    updated_at: '2024-05-12T00:00:00Z',
  },
];

export const mockProperties: Property[] = [
  {
    id: '1',
    customer_id: '1',
    address: '45678 Desert View Rd',
    city: 'Borrego Springs',
    county: 'San Diego',
    zip: '92004',
    lat: 33.2558,
    lng: -116.3751,
    access_notes: 'Gate code: 1234. Main house well is behind the barn.',
    created_at: '2024-01-15T00:00:00Z',
  },
  {
    id: '2',
    customer_id: '1',
    address: '45700 Desert View Rd (North Parcel)',
    city: 'Borrego Springs',
    county: 'San Diego',
    zip: '92004',
    lat: 33.2575,
    lng: -116.3748,
    access_notes: 'Irrigation well for orchards. Access from main property.',
    created_at: '2024-01-15T00:00:00Z',
  },
  {
    id: '3',
    customer_id: '2',
    address: '1234 Palm Canyon Dr',
    city: 'Palm Springs',
    county: 'Riverside',
    zip: '92262',
    lat: 33.8303,
    lng: -116.5453,
    access_notes: 'Community well house. Contact property manager for access.',
    created_at: '2024-02-20T00:00:00Z',
  },
  {
    id: '4',
    customer_id: '3',
    address: '789 Cactus Lane',
    city: 'Indio',
    county: 'Riverside',
    zip: '92201',
    lat: 33.7206,
    lng: -116.2156,
    access_notes: null,
    created_at: '2024-03-10T00:00:00Z',
  },
  {
    id: '5',
    customer_id: '4',
    address: '5500 Highway 86',
    city: 'Coachella',
    county: 'Riverside',
    zip: '92236',
    lat: 33.6803,
    lng: -116.1739,
    access_notes: 'Large farm. Multiple wells - see well info for locations.',
    created_at: '2024-04-05T00:00:00Z',
  },
];

export const mockWellInfo: WellInfo[] = [
  {
    id: '1',
    property_id: '1',
    well_depth: 450,
    casing_diameter: 8,
    static_water_level: 180,
    pump_depth: 400,
    pump_model: 'Grundfos 25S50-12',
    pump_hp: 5,
    install_date: '2019-06-15',
    notes: 'Replaced pump in 2019. Good water quality.',
  },
  {
    id: '2',
    property_id: '2',
    well_depth: 380,
    casing_diameter: 6,
    static_water_level: 200,
    pump_depth: 340,
    pump_model: 'Franklin 3-Wire',
    pump_hp: 3,
    install_date: '2021-03-20',
    notes: 'Irrigation only. High mineral content.',
  },
  {
    id: '3',
    property_id: '4',
    well_depth: 280,
    casing_diameter: 6,
    static_water_level: 120,
    pump_depth: 240,
    pump_model: 'Goulds J10S',
    pump_hp: 1,
    install_date: '2015-08-10',
    notes: 'Original pump. May need replacement soon.',
  },
];

// Helper to get dates relative to today
const today = new Date();
const getDateStr = (daysOffset: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().split('T')[0];
};

export const mockJobs: Job[] = [
  {
    id: '1',
    property_id: '1',
    assigned_to: '3',
    status: 'scheduled',
    job_type: 'Pump Inspection',
    scheduled_date: getDateStr(0),
    scheduled_time: '09:00',
    estimated_duration: '2 hours',
    description: 'Annual pump inspection and performance test',
    internal_notes: 'Customer mentioned slight pressure drop last month',
    completed_at: null,
    created_at: '2024-06-20T00:00:00Z',
    priority: 'normal',
    recurring_schedule_id: null,
  },
  {
    id: '2',
    property_id: '3',
    assigned_to: '3',
    status: 'scheduled',
    job_type: 'Emergency Service',
    scheduled_date: getDateStr(0),
    scheduled_time: '14:00',
    estimated_duration: '3 hours',
    description: 'No water - possible pump failure',
    internal_notes: null,
    completed_at: null,
    created_at: '2024-06-24T00:00:00Z',
    priority: 'urgent',
    recurring_schedule_id: null,
  },
  {
    id: '3',
    property_id: '4',
    assigned_to: '4',
    status: 'in_progress',
    job_type: 'Pump Replacement',
    scheduled_date: getDateStr(0),
    scheduled_time: '08:00',
    estimated_duration: '5 hours',
    description: 'Replace failing pump with new Goulds unit',
    internal_notes: 'Parts ordered and ready for pickup',
    completed_at: null,
    created_at: '2024-06-22T00:00:00Z',
    priority: 'high',
    recurring_schedule_id: null,
  },
  {
    id: '4',
    property_id: '2',
    assigned_to: '5',
    status: 'scheduled',
    job_type: 'Preventive Maintenance',
    scheduled_date: getDateStr(0),
    scheduled_time: '10:00',
    estimated_duration: '2 hours',
    description: 'Quarterly maintenance on irrigation well',
    internal_notes: null,
    completed_at: null,
    created_at: '2024-06-15T00:00:00Z',
    priority: 'normal',
    recurring_schedule_id: null,
  },
  {
    id: '5',
    property_id: '1',
    assigned_to: null,
    status: 'scheduled',
    job_type: 'Water Testing',
    scheduled_date: getDateStr(1),
    scheduled_time: '11:00',
    estimated_duration: '1 hour',
    description: 'Annual water quality test',
    internal_notes: null,
    completed_at: null,
    created_at: '2024-06-10T00:00:00Z',
    priority: 'low',
    recurring_schedule_id: null,
  },
  {
    id: '6',
    property_id: '5',
    assigned_to: null,
    status: 'scheduled',
    job_type: 'Well Inspection',
    scheduled_date: getDateStr(1),
    scheduled_time: '09:00',
    estimated_duration: '2 hours',
    description: 'Routine well inspection',
    internal_notes: null,
    completed_at: null,
    created_at: '2024-06-25T00:00:00Z',
    priority: 'normal',
    recurring_schedule_id: null,
  },
  {
    id: '7',
    property_id: '2',
    assigned_to: '3',
    status: 'scheduled',
    job_type: 'Pressure Tank Service',
    scheduled_date: getDateStr(2),
    scheduled_time: '13:00',
    estimated_duration: '2 hours',
    description: 'Pressure tank inspection and adjustment',
    internal_notes: 'May need replacement',
    completed_at: null,
    created_at: '2024-06-26T00:00:00Z',
    priority: 'normal',
    recurring_schedule_id: null,
  },
  {
    id: '8',
    property_id: '4',
    assigned_to: '4',
    status: 'scheduled',
    job_type: 'Water Treatment',
    scheduled_date: getDateStr(3),
    scheduled_time: '08:00',
    estimated_duration: '3 hours',
    description: 'Install new water softener system',
    internal_notes: 'Equipment on order',
    completed_at: null,
    created_at: '2024-06-27T00:00:00Z',
    priority: 'normal',
    recurring_schedule_id: null,
  },
  {
    id: '9',
    property_id: '1',
    assigned_to: '3',
    status: 'completed',
    job_type: 'Preventive Maintenance',
    scheduled_date: getDateStr(-2),
    scheduled_time: '10:00',
    estimated_duration: '2 hours',
    description: 'Completed maintenance visit',
    internal_notes: 'All systems normal',
    completed_at: getDateStr(-2) + 'T14:00:00Z',
    created_at: '2024-06-15T00:00:00Z',
    priority: 'normal',
    recurring_schedule_id: null,
  },
  {
    id: '10',
    property_id: '3',
    assigned_to: '5',
    status: 'invoiced',
    job_type: 'Well Cleaning',
    scheduled_date: getDateStr(-5),
    scheduled_time: '08:00',
    estimated_duration: '4 hours',
    description: 'Well rehabilitation',
    internal_notes: 'Invoice sent',
    completed_at: getDateStr(-5) + 'T14:00:00Z',
    created_at: '2024-06-10T00:00:00Z',
    priority: 'normal',
    recurring_schedule_id: null,
  },
];

// Products/Services Catalog
export const mockProducts: Product[] = [
  {
    id: '1',
    name: 'Labor - Standard Rate',
    description: 'Standard labor rate per hour',
    default_price: 125.00,
    item_type: 'labor',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '2',
    name: 'Labor - Emergency Rate',
    description: 'Emergency/after-hours labor rate per hour',
    default_price: 185.00,
    item_type: 'labor',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '3',
    name: 'Submersible Pump - 1HP',
    description: 'Grundfos 1HP submersible pump',
    default_price: 850.00,
    item_type: 'part',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '4',
    name: 'Submersible Pump - 3HP',
    description: 'Grundfos 3HP submersible pump',
    default_price: 1450.00,
    item_type: 'part',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '5',
    name: 'Submersible Pump - 5HP',
    description: 'Grundfos 5HP submersible pump',
    default_price: 2200.00,
    item_type: 'part',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '6',
    name: 'Pressure Tank - 20 Gallon',
    description: 'Well-X-Trol 20 gallon pressure tank',
    default_price: 285.00,
    item_type: 'part',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '7',
    name: 'Pressure Tank - 44 Gallon',
    description: 'Well-X-Trol 44 gallon pressure tank',
    default_price: 425.00,
    item_type: 'part',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '8',
    name: 'Pressure Switch',
    description: 'Square D pressure switch 30/50 PSI',
    default_price: 65.00,
    item_type: 'part',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '9',
    name: 'Control Box',
    description: 'Franklin Electric control box',
    default_price: 175.00,
    item_type: 'part',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '10',
    name: 'Service Call',
    description: 'Standard service call fee',
    default_price: 95.00,
    item_type: 'service',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '11',
    name: 'Well Inspection',
    description: 'Complete well system inspection',
    default_price: 175.00,
    item_type: 'service',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '12',
    name: 'Water Quality Test',
    description: 'Basic water quality testing',
    default_price: 125.00,
    item_type: 'service',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '13',
    name: 'Equipment Rental - Pump Hoist',
    description: 'Daily rental for pump pulling equipment',
    default_price: 350.00,
    item_type: 'equipment',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '14',
    name: 'Water Softener System',
    description: 'Residential water softener with installation',
    default_price: 1850.00,
    item_type: 'part',
    active: true,
    created_at: '2024-01-01T00:00:00Z',
  },
];

// Quotes
export const mockQuotes: Quote[] = [
  {
    id: 'q1',
    quote_number: 1001,
    customer_id: '1',
    property_id: '1',
    status: 'sent',
    valid_until: getDateStr(30),
    subtotal: 2850.00,
    tax_rate: 8.75,
    tax_amount: 249.38,
    total: 3099.38,
    required_deposit: 1550.00,
    notes: 'Quote valid for 30 days. 50% deposit required to begin work.',
    internal_notes: 'Customer is comparing with other contractors',
    sent_at: getDateStr(-5) + 'T10:00:00Z',
    accepted_at: null,
    created_at: getDateStr(-7) + 'T09:00:00Z',
    updated_at: getDateStr(-5) + 'T10:00:00Z',
  },
  {
    id: 'q2',
    quote_number: 1002,
    customer_id: '4',
    property_id: '5',
    status: 'accepted',
    valid_until: getDateStr(15),
    subtotal: 4500.00,
    tax_rate: 8.75,
    tax_amount: 393.75,
    total: 4893.75,
    required_deposit: 2446.88,
    notes: 'Includes pump, installation, and warranty.',
    internal_notes: null,
    sent_at: getDateStr(-10) + 'T14:00:00Z',
    accepted_at: getDateStr(-8) + 'T09:00:00Z',
    created_at: getDateStr(-12) + 'T11:00:00Z',
    updated_at: getDateStr(-8) + 'T09:00:00Z',
  },
  {
    id: 'q3',
    quote_number: 1003,
    customer_id: '3',
    property_id: '4',
    status: 'draft',
    valid_until: null,
    subtotal: 1250.00,
    tax_rate: 8.75,
    tax_amount: 109.38,
    total: 1359.38,
    required_deposit: 680.00,
    notes: null,
    internal_notes: 'Need to verify pump specs before sending',
    sent_at: null,
    accepted_at: null,
    created_at: getDateStr(-1) + 'T15:00:00Z',
    updated_at: getDateStr(-1) + 'T15:00:00Z',
  },
  {
    id: 'q4',
    quote_number: 1004,
    customer_id: '2',
    property_id: '3',
    status: 'declined',
    valid_until: getDateStr(-5),
    subtotal: 6800.00,
    tax_rate: 8.75,
    tax_amount: 595.00,
    total: 7395.00,
    required_deposit: 3697.50,
    notes: 'Complete well system upgrade',
    internal_notes: 'Customer went with cheaper competitor',
    sent_at: getDateStr(-20) + 'T10:00:00Z',
    accepted_at: null,
    created_at: getDateStr(-25) + 'T09:00:00Z',
    updated_at: getDateStr(-15) + 'T14:00:00Z',
  },
];

// Quote Change Requests
export const mockQuoteChangeRequests: QuoteChangeRequest[] = [
  {
    id: 'qcr1',
    quote_id: 'q1',
    customer_name: 'Johnson Ranch',
    customer_email: 'mjohnson@johnsonranch.com',
    message: 'Can we discuss using a different pump model? Also wondering if you can match the competitor quote of $2,800.',
    status: 'pending',
    created_at: getDateStr(-2) + 'T14:30:00Z',
    reviewed_at: null,
  },
];

export const mockQuoteItems: QuoteItem[] = [
  // Quote 1 items
  { id: 'qi1', quote_id: 'q1', description: 'Submersible Pump - 3HP', item_description: 'Grundfos 3HP submersible pump with 5-year warranty', quantity: 1, unit_price: 1450.00, total: 1450.00, item_type: 'part', taxable: true, sort_order: 0 },
  { id: 'qi2', quote_id: 'q1', description: 'Pump installation labor', item_description: 'Includes removal of old pump and installation of new unit', quantity: 4, unit_price: 125.00, total: 500.00, item_type: 'labor', taxable: true, sort_order: 1 },
  { id: 'qi3', quote_id: 'q1', description: 'Drop pipe and fittings', item_description: null, quantity: 1, unit_price: 550.00, total: 550.00, item_type: 'part', taxable: true, sort_order: 2 },
  { id: 'qi4', quote_id: 'q1', description: 'Equipment rental - pump hoist', item_description: 'Daily rental for pump pulling equipment', quantity: 1, unit_price: 350.00, total: 350.00, item_type: 'equipment', taxable: false, sort_order: 3 },
  
  // Quote 2 items
  { id: 'qi5', quote_id: 'q2', description: 'Submersible Pump - 5HP', item_description: 'Grundfos 5HP submersible pump - commercial grade', quantity: 1, unit_price: 2200.00, total: 2200.00, item_type: 'part', taxable: true, sort_order: 0 },
  { id: 'qi6', quote_id: 'q2', description: 'Control Box', item_description: 'Franklin Electric control box with overload protection', quantity: 1, unit_price: 175.00, total: 175.00, item_type: 'part', taxable: true, sort_order: 1 },
  { id: 'qi7', quote_id: 'q2', description: 'Installation labor', item_description: null, quantity: 8, unit_price: 125.00, total: 1000.00, item_type: 'labor', taxable: true, sort_order: 2 },
  { id: 'qi8', quote_id: 'q2', description: 'Drop pipe and fittings', item_description: '200ft stainless steel drop pipe with brass fittings', quantity: 1, unit_price: 775.00, total: 775.00, item_type: 'part', taxable: true, sort_order: 3 },
  { id: 'qi9', quote_id: 'q2', description: 'Equipment rental', item_description: null, quantity: 1, unit_price: 350.00, total: 350.00, item_type: 'equipment', taxable: false, sort_order: 4 },
  
  // Quote 3 items
  { id: 'qi10', quote_id: 'q3', description: 'Pressure Tank - 44 Gallon', item_description: 'Well-X-Trol 44 gallon pressure tank', quantity: 1, unit_price: 425.00, total: 425.00, item_type: 'part', taxable: true, sort_order: 0 },
  { id: 'qi11', quote_id: 'q3', description: 'Pressure Switch', item_description: 'Square D pressure switch 30/50 PSI', quantity: 1, unit_price: 65.00, total: 65.00, item_type: 'part', taxable: true, sort_order: 1 },
  { id: 'qi12', quote_id: 'q3', description: 'Installation labor', item_description: null, quantity: 3, unit_price: 125.00, total: 375.00, item_type: 'labor', taxable: true, sort_order: 2 },
  { id: 'qi13', quote_id: 'q3', description: 'Fittings and materials', item_description: 'Misc. PVC fittings, unions, and mounting hardware', quantity: 1, unit_price: 385.00, total: 385.00, item_type: 'part', taxable: true, sort_order: 3 },
  
  // Quote 4 items
  { id: 'qi14', quote_id: 'q4', description: 'Complete well system upgrade', item_description: 'Full replacement of pump, tank, controls, and piping. Includes all labor and materials.', quantity: 1, unit_price: 6800.00, total: 6800.00, item_type: 'service', taxable: true, sort_order: 0 },
];

// Invoices
export const mockInvoices: Invoice[] = [
  {
    id: 'inv1',
    invoice_number: 2024001,
    customer_id: '1',
    job_id: '9',
    quote_id: null,
    status: 'paid',
    issue_date: getDateStr(-30),
    due_date: getDateStr(0),
    subtotal: 475.00,
    tax_rate: 8.75,
    tax_amount: 41.56,
    total: 516.56,
    amount_paid: 516.56,
    notes: 'Thank you for your business!',
    internal_notes: null,
    sent_at: getDateStr(-30) + 'T10:00:00Z',
    viewed_at: getDateStr(-29) + 'T15:00:00Z',
    paid_at: getDateStr(-25) + 'T09:00:00Z',
    created_at: getDateStr(-30) + 'T09:00:00Z',
    updated_at: getDateStr(-25) + 'T09:00:00Z',
  },
  {
    id: 'inv2',
    invoice_number: 2024002,
    customer_id: '2',
    job_id: null,
    quote_id: null,
    status: 'sent',
    issue_date: getDateStr(-15),
    due_date: getDateStr(15),
    subtotal: 1250.00,
    tax_rate: 8.75,
    tax_amount: 109.38,
    total: 1359.38,
    amount_paid: 0,
    notes: 'Net 30 payment terms.',
    internal_notes: 'Need PO before payment',
    sent_at: getDateStr(-15) + 'T11:00:00Z',
    viewed_at: getDateStr(-14) + 'T10:00:00Z',
    paid_at: null,
    created_at: getDateStr(-15) + 'T10:00:00Z',
    updated_at: getDateStr(-14) + 'T10:00:00Z',
  },
  {
    id: 'inv3',
    invoice_number: 2024003,
    customer_id: '4',
    job_id: null,
    quote_id: 'q2',
    status: 'overdue',
    issue_date: getDateStr(-45),
    due_date: getDateStr(-15),
    subtotal: 4500.00,
    tax_rate: 8.75,
    tax_amount: 393.75,
    total: 4893.75,
    amount_paid: 2446.88,
    notes: 'Converted from Quote #1002',
    internal_notes: 'Customer made partial payment, follow up needed',
    sent_at: getDateStr(-45) + 'T14:00:00Z',
    viewed_at: getDateStr(-44) + 'T09:00:00Z',
    paid_at: null,
    created_at: getDateStr(-45) + 'T13:00:00Z',
    updated_at: getDateStr(-30) + 'T10:00:00Z',
  },
  {
    id: 'inv4',
    invoice_number: 2024004,
    customer_id: '3',
    job_id: '10',
    quote_id: null,
    status: 'draft',
    issue_date: getDateStr(0),
    due_date: getDateStr(30),
    subtotal: 850.00,
    tax_rate: 8.75,
    tax_amount: 74.38,
    total: 924.38,
    amount_paid: 0,
    notes: null,
    internal_notes: 'Review before sending',
    sent_at: null,
    viewed_at: null,
    paid_at: null,
    created_at: getDateStr(0) + 'T09:00:00Z',
    updated_at: getDateStr(0) + 'T09:00:00Z',
  },
  {
    id: 'inv5',
    invoice_number: 2024005,
    customer_id: '5',
    job_id: null,
    quote_id: null,
    status: 'void',
    issue_date: getDateStr(-60),
    due_date: getDateStr(-30),
    subtotal: 250.00,
    tax_rate: 8.75,
    tax_amount: 21.88,
    total: 271.88,
    amount_paid: 0,
    notes: 'VOID - Duplicate invoice',
    internal_notes: 'Created in error',
    sent_at: null,
    viewed_at: null,
    paid_at: null,
    created_at: getDateStr(-60) + 'T09:00:00Z',
    updated_at: getDateStr(-59) + 'T10:00:00Z',
  },
];

export const mockInvoiceItems: InvoiceItem[] = [
  // Invoice 1 items
  { id: 'ii1', invoice_id: 'inv1', description: 'Preventive Maintenance Service', quantity: 1, unit_price: 175.00, total: 175.00, item_type: 'service', sort_order: 0 },
  { id: 'ii2', invoice_id: 'inv1', description: 'Labor - Standard Rate', quantity: 2, unit_price: 125.00, total: 250.00, item_type: 'labor', sort_order: 1 },
  { id: 'ii3', invoice_id: 'inv1', description: 'Misc. parts and fittings', quantity: 1, unit_price: 50.00, total: 50.00, item_type: 'part', sort_order: 2 },
  
  // Invoice 2 items
  { id: 'ii4', invoice_id: 'inv2', description: 'Quarterly Well Maintenance', quantity: 4, unit_price: 175.00, total: 700.00, item_type: 'service', sort_order: 0 },
  { id: 'ii5', invoice_id: 'inv2', description: 'Water Quality Testing', quantity: 2, unit_price: 125.00, total: 250.00, item_type: 'service', sort_order: 1 },
  { id: 'ii6', invoice_id: 'inv2', description: 'Annual System Report', quantity: 1, unit_price: 300.00, total: 300.00, item_type: 'service', sort_order: 2 },
  
  // Invoice 3 items (from quote)
  { id: 'ii7', invoice_id: 'inv3', description: 'Submersible Pump - 5HP', quantity: 1, unit_price: 2200.00, total: 2200.00, item_type: 'part', sort_order: 0 },
  { id: 'ii8', invoice_id: 'inv3', description: 'Control Box', quantity: 1, unit_price: 175.00, total: 175.00, item_type: 'part', sort_order: 1 },
  { id: 'ii9', invoice_id: 'inv3', description: 'Installation labor', quantity: 8, unit_price: 125.00, total: 1000.00, item_type: 'labor', sort_order: 2 },
  { id: 'ii10', invoice_id: 'inv3', description: 'Drop pipe and fittings', quantity: 1, unit_price: 775.00, total: 775.00, item_type: 'part', sort_order: 3 },
  { id: 'ii11', invoice_id: 'inv3', description: 'Equipment rental', quantity: 1, unit_price: 350.00, total: 350.00, item_type: 'equipment', sort_order: 4 },
  
  // Invoice 4 items
  { id: 'ii12', invoice_id: 'inv4', description: 'Well Cleaning Service', quantity: 1, unit_price: 450.00, total: 450.00, item_type: 'service', sort_order: 0 },
  { id: 'ii13', invoice_id: 'inv4', description: 'Labor', quantity: 3, unit_price: 125.00, total: 375.00, item_type: 'labor', sort_order: 1 },
  { id: 'ii14', invoice_id: 'inv4', description: 'Materials', quantity: 1, unit_price: 25.00, total: 25.00, item_type: 'part', sort_order: 2 },
  
  // Invoice 5 items
  { id: 'ii15', invoice_id: 'inv5', description: 'Service Call', quantity: 1, unit_price: 95.00, total: 95.00, item_type: 'service', sort_order: 0 },
  { id: 'ii16', invoice_id: 'inv5', description: 'Labor', quantity: 1, unit_price: 125.00, total: 125.00, item_type: 'labor', sort_order: 1 },
  { id: 'ii17', invoice_id: 'inv5', description: 'Trip charge', quantity: 1, unit_price: 30.00, total: 30.00, item_type: 'service', sort_order: 2 },
];

// Payments
export const mockPayments: Payment[] = [
  {
    id: 'pay1',
    invoice_id: 'inv1',
    amount: 516.56,
    payment_method: 'check',
    reference_number: '4521',
    payment_date: getDateStr(-25),
    notes: null,
    created_at: getDateStr(-25) + 'T09:00:00Z',
  },
  {
    id: 'pay2',
    invoice_id: 'inv3',
    amount: 2446.88,
    payment_method: 'card',
    reference_number: 'TXN-89234',
    payment_date: getDateStr(-30),
    notes: 'Partial payment - 50%',
    created_at: getDateStr(-30) + 'T10:00:00Z',
  },
];

export const mockJobTypes: JobType[] = [
  { id: '1', name: 'Well Inspection', default_duration: '2 hours', default_duration_minutes: 120, color: '#10B981', description: 'General well health inspection' },
  { id: '2', name: 'Pump Replacement', default_duration: '4 hours', default_duration_minutes: 240, color: '#F59E0B', description: 'Replace submersible or jet pump' },
  { id: '3', name: 'Pump Repair', default_duration: '3 hours', default_duration_minutes: 180, color: '#6366F1', description: 'Repair existing pump system' },
  { id: '4', name: 'Well Cleaning', default_duration: '4 hours', default_duration_minutes: 240, color: '#8B5CF6', description: 'Clean and rehabilitate well' },
  { id: '5', name: 'Pressure Tank Service', default_duration: '2 hours', default_duration_minutes: 120, color: '#06B6D4', description: 'Inspect, repair, or replace pressure tank' },
  { id: '6', name: 'Water Treatment', default_duration: '3 hours', default_duration_minutes: 180, color: '#14B8A6', description: 'Install or service water treatment system' },
  { id: '7', name: 'Emergency Service', default_duration: '2 hours', default_duration_minutes: 120, color: '#EF4444', description: 'Emergency no-water response' },
  { id: '8', name: 'Water Testing', default_duration: '1 hour', default_duration_minutes: 60, color: '#3B82F6', description: 'Collect samples for lab testing' },
  { id: '9', name: 'Preventive Maintenance', default_duration: '2 hours', default_duration_minutes: 120, color: '#84CC16', description: 'Scheduled maintenance visit' },
];

// Helper to get related data
export function getCustomerById(id: string): Customer | undefined {
  return mockCustomers.find(c => c.id === id);
}

export function getPropertiesByCustomerId(customerId: string): Property[] {
  return mockProperties.filter(p => p.customer_id === customerId);
}

export function getWellInfoByPropertyId(propertyId: string): WellInfo | undefined {
  return mockWellInfo.find(w => w.property_id === propertyId);
}

export function getJobsByPropertyId(propertyId: string): Job[] {
  return mockJobs.filter(j => j.property_id === propertyId);
}

export function getJobsByCustomerId(customerId: string): Job[] {
  const propertyIds = mockProperties
    .filter(p => p.customer_id === customerId)
    .map(p => p.id);
  return mockJobs.filter(j => propertyIds.includes(j.property_id));
}

export function getPropertyById(id: string): Property | undefined {
  return mockProperties.find(p => p.id === id);
}

export function getUserById(id: string): User | undefined {
  return mockUsers.find(u => u.id === id);
}

export function getJobTypeByName(name: string): JobType | undefined {
  return mockJobTypes.find(jt => jt.name === name);
}

export function getJobTypeById(id: string): JobType | undefined {
  return mockJobTypes.find(jt => jt.id === id);
}

export function getJobsForDateRange(startDate: Date, endDate: Date): Job[] {
  return mockJobs.filter(job => {
    if (!job.scheduled_date) return false;
    const jobDate = new Date(job.scheduled_date);
    return jobDate >= startDate && jobDate <= endDate;
  });
}

export function getUnassignedJobs(): Job[] {
  return mockJobs.filter(job => !job.assigned_to && job.status === 'scheduled');
}

export function getJobsByAssignee(userId: string): Job[] {
  return mockJobs.filter(job => job.assigned_to === userId);
}

export function getTodaysJobs(): Job[] {
  const today = new Date().toISOString().split('T')[0];
  return mockJobs.filter(job => job.scheduled_date === today);
}

export function getJobById(id: string): Job | undefined {
  return mockJobs.find(j => j.id === id);
}

export function getJobsByType(): { name: string; value: number }[] {
  const typeCounts: Record<string, number> = {};
  mockJobs.forEach(job => {
    typeCounts[job.job_type] = (typeCounts[job.job_type] || 0) + 1;
  });
  return Object.entries(typeCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// Product helpers
export function getActiveProducts(): Product[] {
  return mockProducts.filter(p => p.active);
}

export function getProductById(id: string): Product | undefined {
  return mockProducts.find(p => p.id === id);
}

export function getProductsByType(itemType: string): Product[] {
  return mockProducts.filter(p => p.item_type === itemType && p.active);
}

// Quote helpers
export function getQuoteById(id: string): Quote | undefined {
  return mockQuotes.find(q => q.id === id);
}

export function getQuoteItems(quoteId: string): QuoteItem[] {
  return mockQuoteItems.filter(qi => qi.quote_id === quoteId);
}

export function getQuoteWithDetails(id: string): QuoteWithDetails | undefined {
  const quote = getQuoteById(id);
  if (!quote) return undefined;
  
  const customer = getCustomerById(quote.customer_id);
  if (!customer) return undefined;
  
  const property = quote.property_id ? getPropertyById(quote.property_id) : null;
  const items = getQuoteItems(id);
  
  return { ...quote, customer, property: property || null, items };
}

export function getQuotesByCustomerId(customerId: string): Quote[] {
  return mockQuotes.filter(q => q.customer_id === customerId);
}

export function getQuotesByStatus(status: string): Quote[] {
  return mockQuotes.filter(q => q.status === status);
}

// Invoice helpers
export function getInvoiceById(id: string): Invoice | undefined {
  return mockInvoices.find(inv => inv.id === id);
}

export function getInvoiceItems(invoiceId: string): InvoiceItem[] {
  return mockInvoiceItems.filter(ii => ii.invoice_id === invoiceId);
}

export function getPaymentsByInvoiceId(invoiceId: string): Payment[] {
  return mockPayments.filter(p => p.invoice_id === invoiceId);
}

export function getInvoiceWithDetails(id: string): InvoiceWithDetails | undefined {
  const invoice = getInvoiceById(id);
  if (!invoice) return undefined;
  
  const customer = getCustomerById(invoice.customer_id);
  if (!customer) return undefined;
  
  const job = invoice.job_id ? getJobById(invoice.job_id) : null;
  const quote = invoice.quote_id ? getQuoteById(invoice.quote_id) : null;
  const items = getInvoiceItems(id);
  const payments = getPaymentsByInvoiceId(id);
  
  return { ...invoice, customer, job: job || null, quote: quote || null, items, payments };
}

export function getInvoicesByCustomerId(customerId: string): Invoice[] {
  return mockInvoices.filter(inv => inv.customer_id === customerId);
}

export function getInvoicesByStatus(status: string): Invoice[] {
  return mockInvoices.filter(inv => inv.status === status);
}

export function getUnpaidInvoices(): Invoice[] {
  return mockInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');
}

export function getOverdueInvoices(): Invoice[] {
  const today = new Date().toISOString().split('T')[0];
  return mockInvoices.filter(inv => 
    inv.status !== 'paid' && 
    inv.status !== 'void' && 
    inv.due_date && 
    inv.due_date < today
  );
}

// Aging report helper
export function getInvoiceAgingSummary(): { current: number; days30: number; days60: number; days90Plus: number } {
  const today = new Date();
  let current = 0, days30 = 0, days60 = 0, days90Plus = 0;
  
  mockInvoices.forEach(inv => {
    if (inv.status === 'paid' || inv.status === 'void') return;
    
    const amountDue = inv.total - inv.amount_paid;
    if (amountDue <= 0) return;
    
    if (!inv.due_date) {
      current += amountDue;
      return;
    }
    
    const dueDate = new Date(inv.due_date);
    const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysPastDue <= 0) {
      current += amountDue;
    } else if (daysPastDue <= 30) {
      days30 += amountDue;
    } else if (daysPastDue <= 60) {
      days60 += amountDue;
    } else {
      days90Plus += amountDue;
    }
  });
  
  return { current, days30, days60, days90Plus };
}

// Aging report for reports page
export interface AgingBucket {
  bucket: string;
  amount: number;
  invoices: typeof mockInvoices;
}

export function getAgingReport(): AgingBucket[] {
  const today = new Date();
  const buckets: { [key: string]: { amount: number; invoices: typeof mockInvoices } } = {
    'Current': { amount: 0, invoices: [] },
    '1-30 Days': { amount: 0, invoices: [] },
    '31-60 Days': { amount: 0, invoices: [] },
    '60+ Days': { amount: 0, invoices: [] },
  };

  mockInvoices.forEach(inv => {
    if (inv.status === 'paid' || inv.status === 'void') return;
    
    const amountDue = inv.total - inv.amount_paid;
    if (amountDue <= 0) return;
    
    if (!inv.due_date) {
      buckets['Current'].amount += amountDue;
      buckets['Current'].invoices.push(inv);
      return;
    }
    
    const dueDate = new Date(inv.due_date);
    const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysPastDue <= 0) {
      buckets['Current'].amount += amountDue;
      buckets['Current'].invoices.push(inv);
    } else if (daysPastDue <= 30) {
      buckets['1-30 Days'].amount += amountDue;
      buckets['1-30 Days'].invoices.push(inv);
    } else if (daysPastDue <= 60) {
      buckets['31-60 Days'].amount += amountDue;
      buckets['31-60 Days'].invoices.push(inv);
    } else {
      buckets['60+ Days'].amount += amountDue;
      buckets['60+ Days'].invoices.push(inv);
    }
  });

  return Object.entries(buckets).map(([bucket, data]) => ({
    bucket,
    amount: Math.round(data.amount * 100) / 100,
    invoices: data.invoices,
  }));
}

// Top customers by revenue
export function getTopCustomersByRevenue(limit: number = 5): { id: string; name: string; revenue: number }[] {
  const revenueByCustomer: { [customerId: string]: number } = {};
  
  mockInvoices.forEach(inv => {
    if (inv.status === 'paid') {
      revenueByCustomer[inv.customer_id] = (revenueByCustomer[inv.customer_id] || 0) + inv.amount;
    }
  });
  
  return Object.entries(revenueByCustomer)
    .map(([customerId, revenue]) => {
      const customer = getCustomerById(customerId);
      return {
        id: customerId,
        name: customer?.name || 'Unknown',
        revenue,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

// Missing exports - Activity & Settings
export function getRecentActivity(limit: number = 10) {
  return mockJobs
    .filter(j => j.updated_at)
    .sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime())
    .slice(0, limit)
    .map(job => ({
      id: job.id,
      type: 'job_update' as const,
      description: `Job #${job.job_number} - ${job.status}`,
      timestamp: job.updated_at,
      user: getUserById(job.assigned_to || ''),
    }));
}

export const mockNotifications = [
  {
    id: '1',
    type: 'info' as const,
    title: 'Welcome to SCWS Job Management',
    message: 'Your system is ready to use.',
    read: false,
    read_at: null,
    created_at: new Date().toISOString(),
    sent_at: new Date().toISOString(),
  },
];

export const mockCompanySettings = {
  name: 'Southern California Well Service',
  email: 'brighton@scwellservice.com',
  phone: '(760) 440-8520',
  address: '1077 Main St, Ramona, CA 92065',
  taxRate: 7.75,
};

export const mockNotificationSettings = {
  emailNotifications: true,
  smsNotifications: false,
  jobAlerts: true,
  paymentAlerts: true,
};

// Job Assignments (multiple assignees per job)
export const mockJobAssignments: JobAssignment[] = [
  {
    id: 'ja1',
    job_id: '1',
    user_id: '3', // Mike Thompson
    assigned_at: getDateStr(-1) + 'T08:00:00Z',
    assigned_by: '1', // Brighton
    notes: null,
  },
  {
    id: 'ja2',
    job_id: '2',
    user_id: '3', // Mike Thompson
    assigned_at: getDateStr(-1) + 'T09:00:00Z',
    assigned_by: '1',
    notes: 'Primary tech for emergency',
  },
  {
    id: 'ja3',
    job_id: '2',
    user_id: '4', // Carlos Rivera (backup)
    assigned_at: getDateStr(-1) + 'T09:30:00Z',
    assigned_by: '1',
    notes: 'Backup support',
  },
  {
    id: 'ja4',
    job_id: '3',
    user_id: '4', // Carlos Rivera
    assigned_at: getDateStr(-2) + 'T10:00:00Z',
    assigned_by: '2', // Sarah
    notes: null,
  },
  {
    id: 'ja5',
    job_id: '3',
    user_id: '6', // David Chen (helper)
    assigned_at: getDateStr(-2) + 'T10:00:00Z',
    assigned_by: '2',
    notes: 'Helper for pump replacement',
  },
  {
    id: 'ja6',
    job_id: '4',
    user_id: '5', // Jake Wilson
    assigned_at: getDateStr(-3) + 'T14:00:00Z',
    assigned_by: '1',
    notes: null,
  },
  {
    id: 'ja7',
    job_id: '7',
    user_id: '3', // Mike Thompson
    assigned_at: getDateStr(-1) + 'T11:00:00Z',
    assigned_by: '1',
    notes: null,
  },
  {
    id: 'ja8',
    job_id: '8',
    user_id: '4', // Carlos Rivera
    assigned_at: getDateStr(-2) + 'T16:00:00Z',
    assigned_by: '2',
    notes: null,
  },
  {
    id: 'ja9',
    job_id: '9',
    user_id: '3', // Mike Thompson
    assigned_at: getDateStr(-5) + 'T08:00:00Z',
    assigned_by: '1',
    notes: null,
  },
  {
    id: 'ja10',
    job_id: '10',
    user_id: '5', // Jake Wilson
    assigned_at: getDateStr(-7) + 'T09:00:00Z',
    assigned_by: '1',
    notes: null,
  },
];

// Tasks
export const mockTasks: Task[] = [
  {
    id: 't1',
    title: 'Order replacement pump for Johnson Ranch',
    description: 'Need to order Grundfos 5HP submersible pump for upcoming job',
    assigned_to: '2',
    due_date: getDateStr(1),
    due_time: '10:00',
    status: 'pending',
    priority: 'high',
    related_job_id: null,
    related_customer_id: '1',
    created_by: '1',
    created_at: getDateStr(-2) + 'T09:00:00Z',
    completed_at: null,
  },
  {
    id: 't2',
    title: 'Follow up on overdue invoice',
    description: 'Sunny Acres Farm has an overdue balance - need to call for payment',
    assigned_to: '2',
    due_date: getDateStr(0),
    due_time: '14:00',
    status: 'in_progress',
    priority: 'urgent',
    related_job_id: null,
    related_customer_id: '4',
    created_by: '1',
    created_at: getDateStr(-3) + 'T11:00:00Z',
    completed_at: null,
  },
  {
    id: 't3',
    title: 'Schedule annual maintenance calls',
    description: 'Contact customers due for annual well maintenance',
    assigned_to: '2',
    due_date: getDateStr(3),
    due_time: null,
    status: 'pending',
    priority: 'normal',
    related_job_id: null,
    related_customer_id: null,
    created_by: '1',
    created_at: getDateStr(-1) + 'T08:00:00Z',
    completed_at: null,
  },
  {
    id: 't4',
    title: 'Review water test results',
    description: 'Lab results came in for Garcia property - review and update customer',
    assigned_to: '1',
    due_date: getDateStr(0),
    due_time: '16:00',
    status: 'pending',
    priority: 'normal',
    related_job_id: null,
    related_customer_id: '3',
    created_by: '2',
    created_at: getDateStr(-1) + 'T10:00:00Z',
    completed_at: null,
  },
  {
    id: 't5',
    title: 'Restock truck inventory',
    description: 'Low on pressure switches and fittings',
    assigned_to: '3',
    due_date: null,
    due_time: null,
    status: 'pending',
    priority: 'low',
    related_job_id: null,
    related_customer_id: null,
    created_by: '1',
    created_at: getDateStr(-5) + 'T09:00:00Z',
    completed_at: null,
  },
  {
    id: 't6',
    title: 'Update customer contact info',
    description: 'Williams family has new phone number',
    assigned_to: '2',
    due_date: null,
    due_time: null,
    status: 'pending',
    priority: 'low',
    related_job_id: null,
    related_customer_id: '5',
    created_by: '2',
    created_at: getDateStr(-4) + 'T14:00:00Z',
    completed_at: null,
  },
  {
    id: 't7',
    title: 'Send quote for new water softener',
    description: 'Garcia requested quote for water treatment system',
    assigned_to: '1',
    due_date: getDateStr(2),
    due_time: '12:00',
    status: 'pending',
    priority: 'normal',
    related_job_id: null,
    related_customer_id: '3',
    created_by: '1',
    created_at: getDateStr(-1) + 'T15:00:00Z',
    completed_at: null,
  },
  {
    id: 't8',
    title: 'Complete job report',
    description: 'Write up report for completed pump replacement',
    assigned_to: '3',
    due_date: getDateStr(-1),
    due_time: '17:00',
    status: 'completed',
    priority: 'normal',
    related_job_id: '9',
    related_customer_id: null,
    created_by: '1',
    created_at: getDateStr(-3) + 'T16:00:00Z',
    completed_at: getDateStr(-1) + 'T16:30:00Z',
  },
];

// Task helpers
export function getTaskById(id: string): Task | undefined {
  return mockTasks.find(t => t.id === id);
}

export function getTaskWithDetails(id: string): TaskWithDetails | undefined {
  const task = getTaskById(id);
  if (!task) return undefined;

  return {
    ...task,
    assigned_user: task.assigned_to ? getUserById(task.assigned_to) || null : null,
    related_job: task.related_job_id ? getJobById(task.related_job_id) || null : null,
    related_customer: task.related_customer_id ? getCustomerById(task.related_customer_id) || null : null,
  };
}

export function getTasksByAssignee(userId: string): Task[] {
  return mockTasks.filter(t => t.assigned_to === userId);
}

export function getUnscheduledTasks(): Task[] {
  return mockTasks.filter(t => !t.due_date && t.status !== 'completed');
}

export function getScheduledTasks(): Task[] {
  return mockTasks.filter(t => t.due_date && t.status !== 'completed');
}

export function getTasksForDate(date: string): Task[] {
  return mockTasks.filter(t => t.due_date === date && t.status !== 'completed');
}

export function getPendingTasks(): Task[] {
  return mockTasks.filter(t => t.status !== 'completed');
}

export function getTasksByCustomerId(customerId: string): Task[] {
  return mockTasks.filter(t => t.related_customer_id === customerId);
}

export function getTasksByJobId(jobId: string): Task[] {
  return mockTasks.filter(t => t.related_job_id === jobId);
}

export function getAllTasksWithDetails(): TaskWithDetails[] {
  return mockTasks.map(task => ({
    ...task,
    assigned_user: task.assigned_to ? getUserById(task.assigned_to) || null : null,
    related_job: task.related_job_id ? getJobById(task.related_job_id) || null : null,
    related_customer: task.related_customer_id ? getCustomerById(task.related_customer_id) || null : null,
  }));
}

// Job Assignment helpers
export function getJobAssignments(jobId: string): JobAssignmentWithUser[] {
  return mockJobAssignments
    .filter(a => a.job_id === jobId)
    .map(assignment => ({
      ...assignment,
      user: getUserById(assignment.user_id)!,
      assigned_by_user: assignment.assigned_by ? getUserById(assignment.assigned_by) || null : null,
    }))
    .filter(a => a.user) // Filter out invalid assignments
    .sort((a, b) => new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime());
}

export function getJobsAssignedToUser(userId: string): Job[] {
  const assignedJobIds = mockJobAssignments
    .filter(a => a.user_id === userId)
    .map(a => a.job_id);
  
  return mockJobs.filter(job => assignedJobIds.includes(job.id));
}

export function getActiveJobsAssignedToUser(userId: string): Job[] {
  return getJobsAssignedToUser(userId).filter(
    job => job.status === 'scheduled' || job.status === 'in_progress'
  );
}

export function getTodaysJobsForUser(userId: string): Job[] {
  const today = new Date().toISOString().split('T')[0];
  return getJobsAssignedToUser(userId).filter(
    job => job.scheduled_date === today && 
           (job.status === 'scheduled' || job.status === 'in_progress')
  );
}

export function getAssignedUsersForJob(jobId: string): User[] {
  const userIds = mockJobAssignments
    .filter(a => a.job_id === jobId)
    .map(a => a.user_id);
  
  return userIds
    .map(id => getUserById(id))
    .filter((user): user is User => user !== undefined);
}

export function assignUserToJob(
  jobId: string, 
  userId: string, 
  assignedBy: string | null = null,
  notes: string | null = null
): JobAssignment {
  // Check if already assigned
  const existing = mockJobAssignments.find(
    a => a.job_id === jobId && a.user_id === userId
  );
  if (existing) return existing;

  const newAssignment: JobAssignment = {
    id: `ja${mockJobAssignments.length + 1}`,
    job_id: jobId,
    user_id: userId,
    assigned_at: new Date().toISOString(),
    assigned_by: assignedBy,
    notes: notes,
  };
  
  mockJobAssignments.push(newAssignment);
  
  // Also update the job's assigned_to to the primary assignee (first one)
  const job = mockJobs.find(j => j.id === jobId);
  if (job && !job.assigned_to) {
    job.assigned_to = userId;
  }
  
  return newAssignment;
}

export function unassignUserFromJob(jobId: string, userId: string): boolean {
  const index = mockJobAssignments.findIndex(
    a => a.job_id === jobId && a.user_id === userId
  );
  
  if (index === -1) return false;
  
  mockJobAssignments.splice(index, 1);
  
  // Update job's assigned_to if this was the primary assignee
  const job = mockJobs.find(j => j.id === jobId);
  if (job && job.assigned_to === userId) {
    const remaining = mockJobAssignments.filter(a => a.job_id === jobId);
    job.assigned_to = remaining.length > 0 ? remaining[0].user_id : null;
  }
  
  return true;
}

export function getAllTeamMembers(): User[] {
  return mockUsers;
}

export function getTeamMembersByRole(role: 'admin' | 'office' | 'field'): User[] {
  return mockUsers.filter(u => u.role === role);
}

// Quote Change Request helpers
export function getChangeRequestsByQuoteId(quoteId: string): QuoteChangeRequest[] {
  return mockQuoteChangeRequests.filter(r => r.quote_id === quoteId);
}

export function getPendingChangeRequests(): QuoteChangeRequest[] {
  return mockQuoteChangeRequests.filter(r => r.status === 'pending');
}

export function getAllChangeRequests(): QuoteChangeRequest[] {
  return mockQuoteChangeRequests;
}

export function addChangeRequest(
  quoteId: string,
  customerName: string,
  customerEmail: string | null,
  message: string
): QuoteChangeRequest {
  const newRequest: QuoteChangeRequest = {
    id: `qcr${mockQuoteChangeRequests.length + 1}`,
    quote_id: quoteId,
    customer_name: customerName,
    customer_email: customerEmail,
    message: message,
    status: 'pending',
    created_at: new Date().toISOString(),
    reviewed_at: null,
  };
  
  mockQuoteChangeRequests.push(newRequest);
  return newRequest;
}

export function markChangeRequestReviewed(requestId: string): boolean {
  const request = mockQuoteChangeRequests.find(r => r.id === requestId);
  if (!request) return false;
  
  request.status = 'reviewed';
  request.reviewed_at = new Date().toISOString();
  return true;
}

export function resolveChangeRequest(requestId: string): boolean {
  const request = mockQuoteChangeRequests.find(r => r.id === requestId);
  if (!request) return false;
  
  request.status = 'resolved';
  request.reviewed_at = new Date().toISOString();
  return true;
}
