// API functions for customer operations
import { createClient } from '@/lib/supabase/client';
import type { Customer, CustomerWithProperties, Property, WellInfo } from '@/types/database';
import { 
  mockCustomers, 
  mockProperties, 
  mockWellInfo, 
  getPropertiesByCustomerId,
  getWellInfoByPropertyId,
} from '@/lib/mock-data';

// Check if using mock data
const useMockData = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

// Get all customers
export async function getCustomers(): Promise<Customer[]> {
  if (useMockData) {
    return mockCustomers;
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('name');

  if (error) throw error;
  return data || [];
}

// Get customer by ID with properties
export async function getCustomer(id: string): Promise<CustomerWithProperties | null> {
  if (useMockData) {
    const customer = mockCustomers.find(c => c.id === id);
    if (!customer) return null;
    
    const properties = getPropertiesByCustomerId(id);
    return { ...customer, properties };
  }

  const supabase = createClient();
  const { data: customer, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  if (!customer) return null;

  const { data: properties } = await supabase
    .from('properties')
    .select('*')
    .eq('customer_id', id)
    .order('created_at');

  return { ...customer, properties: properties || [] };
}

// Create customer
export async function createCustomer(data: Omit<Customer, 'id' | 'created_at' | 'updated_at'>): Promise<Customer> {
  if (useMockData) {
    const newCustomer: Customer = {
      ...data,
      id: String(mockCustomers.length + 1),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockCustomers.push(newCustomer);
    return newCustomer;
  }

  const supabase = createClient();
  const { data: customer, error } = await supabase
    .from('customers')
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return customer;
}

// Update customer
export async function updateCustomer(
  id: string, 
  data: Partial<Omit<Customer, 'id' | 'created_at' | 'updated_at'>>
): Promise<Customer> {
  if (useMockData) {
    const index = mockCustomers.findIndex(c => c.id === id);
    if (index === -1) throw new Error('Customer not found');
    
    mockCustomers[index] = { 
      ...mockCustomers[index], 
      ...data,
      updated_at: new Date().toISOString(),
    };
    return mockCustomers[index];
  }

  const supabase = createClient();
  const { data: customer, error } = await supabase
    .from('customers')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return customer;
}

// Delete customer
export async function deleteCustomer(id: string): Promise<void> {
  if (useMockData) {
    const index = mockCustomers.findIndex(c => c.id === id);
    if (index !== -1) {
      mockCustomers.splice(index, 1);
    }
    return;
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Search customers
export async function searchCustomers(query: string): Promise<Customer[]> {
  if (useMockData) {
    const lowerQuery = query.toLowerCase();
    return mockCustomers.filter(c => 
      c.name.toLowerCase().includes(lowerQuery) ||
      c.email?.toLowerCase().includes(lowerQuery) ||
      c.phone?.includes(query)
    );
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
    .order('name')
    .limit(20);

  if (error) throw error;
  return data || [];
}

// Get properties for customer
export async function getCustomerProperties(customerId: string): Promise<Property[]> {
  if (useMockData) {
    return getPropertiesByCustomerId(customerId);
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at');

  if (error) throw error;
  return data || [];
}

// Get property with well info
export async function getPropertyWithWellInfo(propertyId: string): Promise<Property & { well_info: WellInfo | null } | null> {
  if (useMockData) {
    const property = mockProperties.find(p => p.id === propertyId);
    if (!property) return null;
    
    const wellInfo = getWellInfoByPropertyId(propertyId);
    return { ...property, well_info: wellInfo || null };
  }

  const supabase = createClient();
  const { data: property, error } = await supabase
    .from('properties')
    .select(`
      *,
      well_info (*)
    `)
    .eq('id', propertyId)
    .single();

  if (error) throw error;
  return property;
}
