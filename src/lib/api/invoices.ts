// API functions for invoice operations
import { createClient } from '@/lib/supabase/client';
import type { Invoice, InvoiceWithDetails } from '@/types/database';
import { mockInvoices, mockJobs, getCustomerById } from '@/lib/mock-data';

// Check if using mock data
const useMockData = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

// Get all invoices
export async function getInvoices(filters?: {
  status?: string;
  customerId?: string;
}): Promise<Invoice[]> {
  if (useMockData) {
    let filtered = [...mockInvoices];
    
    if (filters?.status) {
      filtered = filtered.filter(i => i.status === filters.status);
    }
    if (filters?.customerId) {
      filtered = filtered.filter(i => i.customer_id === filters.customerId);
    }
    
    return filtered.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  const supabase = createClient();
  let query = supabase.from('invoices').select('*');

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.customerId) {
    query = query.eq('customer_id', filters.customerId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Get invoice by ID with details
export async function getInvoice(id: string): Promise<InvoiceWithDetails | null> {
  if (useMockData) {
    const invoice = mockInvoices.find(i => i.id === id);
    if (!invoice) return null;
    
    const customer = getCustomerById(invoice.customer_id);
    const job = invoice.job_id ? mockJobs.find(j => j.id === invoice.job_id) : null;

    return {
      ...invoice,
      customer: customer!,
      job: job || null,
    };
  }

  const supabase = createClient();
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`
      *,
      customer:customers (*),
      job:jobs (*)
    `)
    .eq('id', id)
    .single();

  if (error) throw error;
  return invoice;
}

// Create invoice
export async function createInvoice(data: {
  customer_id: string;
  job_id?: string;
  amount: number;
  due_date?: string;
}): Promise<Invoice> {
  if (useMockData) {
    const year = new Date().getFullYear();
    const nextNum = mockInvoices.length + 1;
    const invoice_number = `${year}-${String(nextNum).padStart(5, '0')}`;
    
    const newInvoice: Invoice = {
      id: String(mockInvoices.length + 1),
      invoice_number,
      customer_id: data.customer_id,
      job_id: data.job_id || null,
      amount: data.amount,
      status: 'draft',
      due_date: data.due_date || null,
      paid_at: null,
      created_at: new Date().toISOString(),
    };
    mockInvoices.push(newInvoice);
    return newInvoice;
  }

  const supabase = createClient();
  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      customer_id: data.customer_id,
      job_id: data.job_id || null,
      amount: data.amount,
      due_date: data.due_date || null,
      status: 'draft',
    })
    .select()
    .single();

  if (error) throw error;
  return invoice;
}

// Update invoice
export async function updateInvoice(
  id: string, 
  data: Partial<Omit<Invoice, 'id' | 'created_at' | 'invoice_number'>>
): Promise<Invoice> {
  if (useMockData) {
    const index = mockInvoices.findIndex(i => i.id === id);
    if (index === -1) throw new Error('Invoice not found');
    
    mockInvoices[index] = { ...mockInvoices[index], ...data };
    return mockInvoices[index];
  }

  const supabase = createClient();
  const { data: invoice, error } = await supabase
    .from('invoices')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return invoice;
}

// Mark invoice as sent
export async function sendInvoice(id: string): Promise<Invoice> {
  return updateInvoice(id, { status: 'sent' });
}

// Mark invoice as paid
export async function markInvoicePaid(id: string): Promise<Invoice> {
  return updateInvoice(id, { 
    status: 'paid',
    paid_at: new Date().toISOString(),
  });
}

// Delete invoice
export async function deleteInvoice(id: string): Promise<void> {
  if (useMockData) {
    const index = mockInvoices.findIndex(i => i.id === id);
    if (index !== -1) {
      mockInvoices.splice(index, 1);
    }
    return;
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Get invoices for customer
export async function getCustomerInvoices(customerId: string): Promise<Invoice[]> {
  return getInvoices({ customerId });
}

// Get invoice statistics
export async function getInvoiceStats(): Promise<{
  totalDraft: number;
  totalSent: number;
  totalPaid: number;
  countDraft: number;
  countSent: number;
  countPaid: number;
}> {
  const invoices = await getInvoices();
  
  return {
    totalDraft: invoices.filter(i => i.status === 'draft').reduce((s, i) => s + i.amount, 0),
    totalSent: invoices.filter(i => i.status === 'sent').reduce((s, i) => s + i.amount, 0),
    totalPaid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0),
    countDraft: invoices.filter(i => i.status === 'draft').length,
    countSent: invoices.filter(i => i.status === 'sent').length,
    countPaid: invoices.filter(i => i.status === 'paid').length,
  };
}
