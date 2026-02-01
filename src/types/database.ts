// Database types for SCWS Job Management System
// These types mirror the Supabase schema

export type UserRole = 'admin' | 'office' | 'field';
export type JobStatus = 'scheduled' | 'in_progress' | 'completed' | 'invoiced';
export type LineItemType = 'labor' | 'part' | 'equipment' | 'service';
export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'void';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
export type PaymentMethod = 'cash' | 'check' | 'card' | 'transfer';

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
  item_type: LineItemType;
  active: boolean;
  created_at: string;
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
  notes: string | null;
  internal_notes: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  item_type: LineItemType | null;
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
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  item_type: LineItemType | null;
  sort_order: number;
}

// Payments
export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_method: PaymentMethod | null;
  reference_number: string | null;
  payment_date: string;
  notes: string | null;
  created_at: string;
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
