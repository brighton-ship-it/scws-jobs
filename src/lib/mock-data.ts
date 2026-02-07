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
    name: 'Brighton Scala',
    role: 'admin',
    phone: '(760) 440-8520',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '2',
    email: 'bschroeder@scwellservice.com',
    name: 'Brian Schroeder',
    role: 'admin',
    phone: '(760) 440-8520',
    created_at: '2024-01-15T00:00:00Z',
  },
  {
    id: '3',
    email: 'lizbeth@scwellservice.com',
    name: 'Lizbeth Nunez',
    role: 'office',
    phone: '(760) 440-8520',
    created_at: '2024-02-01T00:00:00Z',
  },
  {
    id: '4',
    email: 'roger@scwellservice.com',
    name: 'Roger Scala',
    role: 'admin',
    phone: '(760) 440-8520',
    created_at: '2024-03-01T00:00:00Z',
  },
  {
    id: '5',
    email: 'shanicey@scwellservice.com',
    name: 'Shanicey Sego',
    role: 'office',
    phone: '(760) 440-8520',
    created_at: '2024-04-01T00:00:00Z',
  },
  {
    id: '6',
    email: 'travis@scwellservice.com',
    name: 'Travis Sego',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-04-15T00:00:00Z',
  },
  {
    id: '7',
    email: 'austin@scwellservice.com',
    name: 'Austin Tipton',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-05-01T00:00:00Z',
  },
  {
    id: '8',
    email: 'brian@scwellservice.com',
    name: 'Brian Eads',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-05-15T00:00:00Z',
  },
  {
    id: '9',
    email: 'christopher@scwellservice.com',
    name: 'Chris Glass',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-06-01T00:00:00Z',
  },
  {
    id: '10',
    email: 'cowin@scwellservice.com',
    name: 'Cowin',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-06-15T00:00:00Z',
  },
  {
    id: '11',
    email: 'dakota@scwellservice.com',
    name: 'Dakota Cole',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-07-01T00:00:00Z',
  },
  {
    id: '12',
    email: 'damian@scwellservice.com',
    name: 'Damian Famania',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-07-15T00:00:00Z',
  },
  {
    id: '13',
    email: 'dylan@scwellservice.com',
    name: 'Dylan Rabas',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-08-01T00:00:00Z',
  },
  {
    id: '14',
    email: 'hazemtarbell@gmail.com',
    name: 'Haze Tarbell',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-08-15T00:00:00Z',
  },
  {
    id: '15',
    email: 'jeff@scwellservice.com',
    name: 'Jeff Gezewski',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-09-01T00:00:00Z',
  },
  {
    id: '16',
    email: 'marshall@scwellservice.com',
    name: 'Marshall Car',
    role: 'field',
    phone: '(760) 440-8520',
    created_at: '2024-09-15T00:00:00Z',
  },
  {
    id: '17',
    email: 'sergio@scwellservice.com',
    name: 'Sergio Valdovinos',
    role: 'field',
    phone: '(760) 440-8520',
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

// Cleared mock jobs - use real data from Supabase
export const mockJobs: Job[] = [];

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
// Cleared mock quotes - use real data from Supabase
export const mockQuotes: Quote[] = [];

// Quote Change Requests
// Cleared mock data - use real data from Supabase
export const mockQuoteChangeRequests: QuoteChangeRequest[] = [];
export const mockQuoteItems: QuoteItem[] = [];

// Invoices
// Cleared mock invoices - use real data from Supabase
export const mockInvoices: Invoice[] = [];

// Cleared mock data - use real data from Supabase
export const mockInvoiceItems: InvoiceItem[] = [];
export const mockPayments: Payment[] = [];

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

// Cleared mock notifications - use real data from Supabase
export const mockNotifications: any[] = [];

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
// Cleared mock job assignments - use real data from Supabase
export const mockJobAssignments: JobAssignment[] = [];

// Cleared mock tasks - use real data from Supabase
export const mockTasks: Task[] = [];

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
