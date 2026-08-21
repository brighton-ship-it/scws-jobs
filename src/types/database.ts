// Database types for SCWS Job Management System
// These types mirror the Supabase schema

export type UserRole = 'admin' | 'office' | 'tech' | 'field';
export type CommunicationType = 'email' | 'sms' | 'call' | 'note';
export type CommunicationDirection = 'inbound' | 'outbound';
export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'invoiced';
export type LineItemType = 'labor' | 'part' | 'equipment' | 'service';
export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'void';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
export type PaymentMethod = 'cash' | 'check' | 'card' | 'transfer' | 'ach';

// Lead Source Tracking
export type LeadSource = 'google_ads' | 'organic_seo' | 'referral' | 'repeat_customer' | 'phone' | 'walk_in' | 'website_form' | 'other';
export type LeadStage = 'lead' | 'quote_sent' | 'quote_accepted' | 'job_scheduled' | 'job_completed' | 'paid';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  qb_customer_id?: string | null;  // QuickBooks customer ID
  // Lead tracking fields
  lead_source?: LeadSource | null;
  lead_source_detail?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  referrer_url?: string | null;
  lead_stage?: LeadStage | null;
  lead_stage_updated_at?: string | null;
  quote_sent_at?: string | null;
  quote_accepted_at?: string | null;
  job_scheduled_at?: string | null;
  job_completed_at?: string | null;
  first_paid_at?: string | null;
}

// Lead Source Costs for ROI tracking
export interface LeadSourceCost {
  id: string;
  lead_source: LeadSource;
  month: string; // ISO date string (first day of month)
  cost: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  customer_id: string;
  address: string;
  city: string | null;
  county: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  access_notes: string | null;
  created_at: string;
}

export interface WellInfo {
  id: string;
  property_id: string;
  well_depth: number | null;
  casing_diameter: number | null;
  static_water_level: number | null;
  pump_depth: number | null;
  pump_model: string | null;
  pump_hp: number | null;
  install_date: string | null;
  notes: string | null;
}

export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

export type CrewType = 'solo' | 'two_man' | 'drill';
export type TechType = 'service' | 'pump_lead' | 'mixed' | 'driller' | 'helper' | 'office' | 'sales';

export interface Job {
  id: string;
  property_id: string;
  assigned_to: string | null;
  status: JobStatus;
  job_type: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  estimated_duration: string | null;
  description: string | null;
  internal_notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at?: string;
  priority?: JobPriority;
  recurring_schedule_id?: string | null;
  job_number?: string;
  // Crew tracking fields
  crew_lead_id?: string | null;
  crew_helper_id?: string | null;
  completed_by_id?: string | null;
  crew_type?: CrewType | null;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone: string | null;
  active: boolean;
  created_at: string;
  updated_at?: string;
  // Performance tracking fields
  hourly_rate?: number | null;
  tech_type?: TechType | null;
}

export interface TechPerformanceMonthly {
  id: string;
  team_member_id: string;
  month: string; // First day of month
  visits: number;
  unique_jobs: number;
  revenue: number;
  parts_revenue: number;
  labor_revenue: number;
  days_worked: number;
  sourced_followups: number;
  sourced_revenue: number;
  created_at: string;
  updated_at?: string;
}

export interface JobLineItem {
  id: string;
  job_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  item_type: LineItemType;
}

export interface JobPhoto {
  id: string;
  job_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

// Products/Services Catalog
export interface Product {
  id: string;
  name: string;
  description: string | null;
  default_price: number;
  unit_cost: number | null;  // Internal cost per unit (for margin tracking)
  item_type: LineItemType;
  sku: string | null;
  active: boolean;
  default_taxable: boolean;  // Whether this product is taxable by default
  jobber_category: string | null;  // Original category from Jobber (SERVICE/PRODUCT)
  created_at: string;
  updated_at?: string;
}

// Quote Templates
export interface QuoteTemplate {
  id: string;
  name: string;
  description: string | null;
  template_type: string;
  line_items: QuoteTemplateLineItem[];
  variables: Record<string, QuoteTemplateVariable>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuoteTemplateLineItem {
  description: string;
  item_description: string | null;
  quantity_formula: string;  // e.g. 'depth', 'depth * 0.8', '1'
  unit_price: number;
  unit_cost: number;
  taxable: boolean;
  item_type: string;
}

export interface QuoteTemplateVariable {
  label: string;
  default: number;
  min?: number;
  max?: number;
}

// Quotes
export interface Quote {
  id: string;
  quote_number: number;
  customer_id: string;
  property_id: string | null;
  status: QuoteStatus;
  valid_until: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  required_deposit: number | null;
  notes: string | null;
  internal_notes: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

// Quote Change Requests
export interface QuoteChangeRequest {
  id: string;
  quote_id: string;
  customer_name: string;
  customer_email: string | null;
  message: string;
  status: 'pending' | 'reviewed' | 'resolved';
  created_at: string;
  reviewed_at: string | null;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  description: string;
  item_description: string | null;  // Extended description shown below the item name
  quantity: number;
  unit_price: number;
  total: number;
  item_type: LineItemType | null;
  taxable: boolean;  // Whether this item is subject to tax (default true)
  sort_order: number;
}

// Invoices
export interface Invoice {
  id: string;
  invoice_number: number;
  customer_id: string;
  job_id: string | null;
  quote_id: string | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  notes: string | null;
  internal_notes: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  qb_invoice_id?: string | null;  // QuickBooks invoice ID
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  item_description: string | null;  // Extended description shown below the item name
  quantity: number;
  unit_price: number;
  total: number;
  item_type: LineItemType | null;
  taxable: boolean;  // Whether this item is subject to tax (default true)
  sort_order: number;
}

// Payments
export type PaymentStatus = 'completed' | 'pending' | 'failed' | 'refunded' | 'voided';

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_method: PaymentMethod | null;
  reference_number: string | null;
  payment_date: string;
  notes: string | null;
  created_at: string;
  qb_payment_id?: string | null;  // QuickBooks payment ID
  // Stax payment fields
  stax_transaction_id?: string | null;
  stax_customer_id?: string | null;
  stax_payment_method_id?: string | null;
  processing_fee?: number | null;
  total_charged?: number | null;
  payment_status?: PaymentStatus;
  customer_email?: string | null;
}

// Portal Tokens
export interface PortalToken {
  id: string;
  customer_id: string;
  token: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface JobType {
  id: string;
  name: string;
  default_duration: string | null;
  description: string | null;
}

// Extended types with relations
export interface CustomerWithProperties extends Customer {
  properties: Property[];
}

export interface PropertyWithWellInfo extends Property {
  well_info: WellInfo | null;
  customer?: Customer;
}

export interface JobWithDetails extends Job {
  property: PropertyWithWellInfo;
  assigned_user: User | null;
  line_items: JobLineItem[];
  photos: JobPhoto[];
}

export interface QuoteWithDetails extends Quote {
  customer: Customer;
  property: Property | null;
  items: QuoteItem[];
}

export interface InvoiceWithDetails extends Invoice {
  customer: Customer;
  job: Job | null;
  quote: Quote | null;
  items: InvoiceItem[];
  payments: Payment[];
}

// Database type helper for Supabase
export interface Database {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: Omit<User, 'created_at'>;
        Update: Partial<Omit<User, 'id' | 'created_at'>>;
      };
      customers: {
        Row: Customer;
        Insert: Omit<Customer, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Customer, 'id' | 'created_at' | 'updated_at'>>;
      };
      properties: {
        Row: Property;
        Insert: Omit<Property, 'id' | 'created_at'>;
        Update: Partial<Omit<Property, 'id' | 'created_at'>>;
      };
      well_info: {
        Row: WellInfo;
        Insert: Omit<WellInfo, 'id'>;
        Update: Partial<Omit<WellInfo, 'id'>>;
      };
      jobs: {
        Row: Job;
        Insert: Omit<Job, 'id' | 'created_at'>;
        Update: Partial<Omit<Job, 'id' | 'created_at'>>;
      };
      job_line_items: {
        Row: JobLineItem;
        Insert: Omit<JobLineItem, 'id'>;
        Update: Partial<Omit<JobLineItem, 'id'>>;
      };
      job_photos: {
        Row: JobPhoto;
        Insert: Omit<JobPhoto, 'id' | 'created_at'>;
        Update: Partial<Omit<JobPhoto, 'id' | 'created_at'>>;
      };
      products: {
        Row: Product;
        Insert: Omit<Product, 'id' | 'created_at'>;
        Update: Partial<Omit<Product, 'id' | 'created_at'>>;
      };
      quotes: {
        Row: Quote;
        Insert: Omit<Quote, 'id' | 'quote_number' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Quote, 'id' | 'quote_number' | 'created_at' | 'updated_at'>>;
      };
      quote_items: {
        Row: QuoteItem;
        Insert: Omit<QuoteItem, 'id'>;
        Update: Partial<Omit<QuoteItem, 'id'>>;
      };
      invoices: {
        Row: Invoice;
        Insert: Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'>>;
      };
      invoice_items: {
        Row: InvoiceItem;
        Insert: Omit<InvoiceItem, 'id'>;
        Update: Partial<Omit<InvoiceItem, 'id'>>;
      };
      payments: {
        Row: Payment;
        Insert: Omit<Payment, 'id' | 'created_at'>;
        Update: Partial<Omit<Payment, 'id' | 'created_at'>>;
      };
      job_types: {
        Row: JobType;
        Insert: Omit<JobType, 'id'>;
        Update: Partial<Omit<JobType, 'id'>>;
      };
      portal_tokens: {
        Row: PortalToken;
        Insert: Omit<PortalToken, 'id' | 'created_at'>;
        Update: Partial<Omit<PortalToken, 'id' | 'created_at'>>;
      };
    };
  };
}

// Notifications
export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
  read: boolean;
  read_at: string | null;
  created_at: string;
  sent_at: string;
  user_id?: string;
}

// Tasks
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  due_date: string | null;
  due_time: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  related_job_id: string | null;
  related_customer_id: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TaskWithDetails extends Task {
  assigned_user: User | null;
  related_job: Job | null;
  related_customer: Customer | null;
}

// Map marker types for schedule map
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  job: Job;
  property: Property;
  color: 'green' | 'orange' | 'red' | 'blue';
}

// Job Assignments (for multiple assignees per job)
export interface JobAssignment {
  id: string;
  job_id: string;
  user_id: string;
  assigned_at: string;
  assigned_by: string | null;
  notes: string | null;
}

export interface JobAssignmentWithUser extends JobAssignment {
  user: User;
  assigned_by_user: User | null;
}

// Extended JobWithDetails to include assignments
export interface JobWithAssignments extends JobWithDetails {
  assignments: JobAssignmentWithUser[];
}

// QuickBooks Integration
export interface QuickBooksConnection {
  id: string;
  user_id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  environment: 'sandbox' | 'production';
  connected_at: string;
  updated_at: string;
}

// Tech Location Tracking
export interface TechLocation {
  id: string;
  tech_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  updated_at: string;
  created_at: string;
}

export interface TechLocationWithUser extends TechLocation {
  user: User;
}

// E-Signatures
export interface Signature {
  id: string;
  quote_id: string;
  signature_data: string;  // Base64 encoded PNG image
  signer_name: string;
  signer_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  signed_at: string;
  created_at: string;
}

export interface QuoteWithSignature extends QuoteWithDetails {
  signature: Signature | null;
}

// Job Photos with Categories
export type PhotoCategory = 'before' | 'after' | 'documentation';

export interface JobPhoto {
  id: string;
  job_id: string;
  url: string;
  thumbnail_url: string | null;
  filename: string | null;
  file_size: number | null;
  category: PhotoCategory;
  sort_order: number;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  created_at: string;
}

// Customer Equipment
export interface CustomerEquipment {
  id: string;
  customer_id: string;
  property_id: string | null;
  equipment_type: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  warranty_expires: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CustomerEquipmentWithProperty extends CustomerEquipment {
  property?: Property;
}

// Warranty status for alerts
export type WarrantyStatus = 'expired' | 'expiring_soon' | 'valid';

export interface EquipmentWarrantyAlert extends CustomerEquipment {
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  property_address: string | null;
  warranty_status: WarrantyStatus;
  days_until_expiry: number;
}

// ==================== INVENTORY MANAGEMENT ====================

export type InventoryCategory = 'Pumps' | 'Motors' | 'Tanks' | 'Fittings' | 'Wire' | 'Controls' | 'Misc';

export interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  category: InventoryCategory;
  quantity: number;
  unit_cost: number;
  reorder_level: number;
  location: string | null;
  vendor: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type StockAdjustmentReason = 'purchase' | 'job_usage' | 'manual_adjustment' | 'return' | 'damaged' | 'inventory_count';

export interface StockAdjustment {
  id: string;
  inventory_item_id: string;
  quantity_change: number;
  reason: StockAdjustmentReason;
  notes: string | null;
  job_id: string | null;
  adjusted_by: string | null;
  created_at: string;
}

export interface StockAdjustmentWithDetails extends StockAdjustment {
  inventory_item?: InventoryItem;
  job?: Job;
  adjusted_by_user?: User;
}

export interface JobPart {
  id: string;
  job_id: string;
  inventory_item_id: string;
  quantity_used: number;
  unit_price: number;
  created_at: string;
}

export interface JobPartWithDetails extends JobPart {
  inventory_item: InventoryItem;
}

// ==================== EXPENSE TRACKING ====================

export type ExpenseCategory = 'Fuel' | 'Materials' | 'Permits' | 'Disposal' | 'Subcontractor' | 'Equipment Rental' | 'Other';

export interface JobExpense {
  id: string;
  job_id: string | null;
  category: ExpenseCategory;
  description: string;
  amount: number;
  vendor: string | null;
  expense_date: string;
  receipt_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobExpenseWithDetails extends JobExpense {
  job?: Job;
  created_by_user?: User;
}

// Recurring Jobs
export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual';

export interface RecurringSchedule {
  id: string;
  job_id: string;  // Template job this is based on
  customer_id: string;
  property_id: string;
  frequency: RecurringFrequency;
  next_run: string;  // Date of next scheduled job
  last_run: string | null;  // Date of last generated job
  active: boolean;
  job_type: string;
  description: string | null;
  estimated_duration: string | null;
  assigned_to: string | null;
  price: number | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  jobs_created: number;
}

export interface RecurringScheduleWithDetails extends RecurringSchedule {
  customer?: Customer;
  property?: Property;
  assigned_user?: User | null;
  template_job?: Job;
}

// Online Booking / Service Requests
export type BookingStatus = 'pending' | 'confirmed' | 'scheduled' | 'cancelled';

// Communications
export interface Communication {
  id: string;
  customer_id: string;
  job_id: string | null;
  type: CommunicationType;
  direction: CommunicationDirection;
  subject: string | null;
  body: string;
  sent_at: string;
  sent_by: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface CommunicationWithDetails extends Communication {
  customer?: Customer;
  job?: Job;
  sent_by_user?: User;
}

export interface BookingRequest {
  id: string;
  service_type: string;
  customer_name: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  preferred_date: string | null;
  preferred_time: string | null;
  notes: string | null;
  status: BookingStatus;
  customer_id: string | null;  // Linked customer if matched/created
  job_id: string | null;  // Created job if scheduled
  source: 'website' | 'embed' | 'manual' | 'phone' | 'google_ads' | 'cost-calculator';
  ip_address: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== VEHICLE FLEET MANAGEMENT ====================

export type VehicleStatus = 'active' | 'inactive' | 'sold' | 'maintenance';
export type VehicleRegistrationStatus = 'expired' | 'due_soon' | 'upcoming' | 'current';

export interface Vehicle {
  id: string;
  name: string;  // e.g., "White F-350"
  license_plate: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;  // e.g., "Ford"
  model: string | null;  // e.g., "F-350"
  registration_due_date: string | null;  // Date
  insurance_expiry_date: string | null;  // Date
  assigned_user_id: string | null;
  status: VehicleStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleWithUser extends Vehicle {
  assigned_user?: User | null;
  registration_status?: VehicleRegistrationStatus;
  days_until_due?: number;
}

export interface VehicleReminder {
  id: string;
  vehicle_id: string;
  reminder_type: 'registration' | 'insurance';
  days_before: number;  // 60, 30, 14, 7
  sent_at: string;
  created_at: string;
}
