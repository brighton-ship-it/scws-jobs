/**
 * QuickBooks Sync Service
 * Handles token refresh and database sync operations
 */

import { createClient } from '@/lib/supabase/server';
import { QuickBooksClient } from './client';
import { refreshAccessToken, getOAuthConfig } from './oauth';

export interface QBOConnection {
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

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  qb_customer_id: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: number;
  customer_id: string;
  due_date: string | null;
  internal_notes: string | null;
  qb_invoice_id: string | null;
  customers?: CustomerRow;
}

interface InvoiceItemRow {
  id: string;
  description: string;
  item_description: string | null;
  quantity: number;
  unit_price: number;
  total: number;
}

interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: number;
  notes: string | null;
  qb_payment_id: string | null;
  invoices?: {
    id: string;
    qb_invoice_id: string | null;
    customer_id: string;
    customers: CustomerRow;
  };
}

/**
 * Get authenticated QuickBooks client with auto token refresh
 */
export async function getQuickBooksClient(): Promise<{ client: QuickBooksClient; connection: QBOConnection } | null> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Not authenticated');
  }

  // Get existing connection
  const { data, error } = await supabase
    .from('quickbooks_connections')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return null;
  }
  
  const connection = data as unknown as QBOConnection;

  // Check if token needs refresh (5 min buffer)
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  let accessToken = connection.access_token;

  if (expiresAt.getTime() - now.getTime() < bufferMs) {
    // Token expired or about to expire, refresh it
    try {
      const config = getOAuthConfig();
      const tokens = await refreshAccessToken({
        refreshToken: connection.refresh_token,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });

      // Update tokens in database
      const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      
      await supabase
        .from('quickbooks_connections')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: newExpiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', connection.id);

      accessToken = tokens.access_token;
      connection.access_token = tokens.access_token;
      connection.refresh_token = tokens.refresh_token;
      connection.token_expires_at = newExpiresAt.toISOString();
    } catch (error) {
      console.error('Failed to refresh QuickBooks token:', error);
      throw new Error('QuickBooks token expired and refresh failed. Please reconnect.');
    }
  }

  const client = new QuickBooksClient({
    accessToken,
    realmId: connection.realm_id,
    environment: connection.environment,
  });

  return { client, connection };
}

/**
 * Sync a customer to QuickBooks
 * Returns the QBO customer ID
 */
export async function syncCustomerToQBO(customerId: string): Promise<string> {
  const supabase = await createClient();
  const qbo = await getQuickBooksClient();
  
  if (!qbo) {
    throw new Error('QuickBooks not connected');
  }

  // Get customer from database
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (error || !data) {
    throw new Error('Customer not found');
  }
  
  const customer = data as unknown as CustomerRow;

  // Check if already synced
  if (customer.qb_customer_id) {
    return customer.qb_customer_id;
  }

  // Try to find existing customer in QBO by name or email
  let qboCustomer = await qbo.client.findCustomerByName(customer.name);
  
  if (!qboCustomer && customer.email) {
    qboCustomer = await qbo.client.findCustomerByEmail(customer.email);
  }

  if (!qboCustomer) {
    // Create new customer in QBO
    // Parse billing address if available
    let address;
    if (customer.billing_address) {
      // Simple address parsing - assumes "street, city, state zip" format
      const parts = customer.billing_address.split(',').map((p: string) => p.trim());
      if (parts.length >= 2) {
        address = {
          street1: parts[0],
          city: parts[1],
          state: parts[2]?.split(' ')[0],
          zip: parts[2]?.split(' ')[1],
        };
      }
    }

    qboCustomer = await qbo.client.createCustomer({
      name: customer.name,
      email: customer.email || undefined,
      phone: customer.phone || undefined,
      address,
    });
  }

  // Store QBO customer ID in database
  await supabase
    .from('customers')
    .update({ qb_customer_id: qboCustomer.Id })
    .eq('id', customerId);

  return qboCustomer.Id!;
}

/**
 * Sync an invoice to QuickBooks
 * Returns the QBO invoice ID
 */
export async function syncInvoiceToQBO(invoiceId: string): Promise<string> {
  const supabase = await createClient();
  const qbo = await getQuickBooksClient();
  
  if (!qbo) {
    throw new Error('QuickBooks not connected');
  }

  // Get invoice with items and customer
  const { data: invoiceData, error: invoiceError } = await supabase
    .from('invoices')
    .select(`
      *,
      customers (id, name, email, qb_customer_id)
    `)
    .eq('id', invoiceId)
    .single();

  if (invoiceError || !invoiceData) {
    throw new Error('Invoice not found');
  }
  
  const invoice = invoiceData as unknown as InvoiceRow;

  // Check if already synced
  if (invoice.qb_invoice_id) {
    return invoice.qb_invoice_id;
  }

  // Get invoice items
  const { data: itemsData } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('sort_order');
    
  const items = (itemsData || []) as unknown as InvoiceItemRow[];

  // Ensure customer is synced first
  let qbCustomerId = invoice.customers?.qb_customer_id;
  if (!qbCustomerId) {
    qbCustomerId = await syncCustomerToQBO(invoice.customer_id);
  }

  // Create invoice in QBO
  const qboInvoice = await qbo.client.createInvoice({
    customerId: qbCustomerId,
    lineItems: items.map(item => ({
      description: item.description + (item.item_description ? `\n${item.item_description}` : ''),
      amount: item.total,
      quantity: item.quantity,
      unitPrice: item.unit_price,
    })),
    dueDate: invoice.due_date || undefined,
    invoiceNumber: String(invoice.invoice_number),
    notes: invoice.internal_notes || undefined,
    email: invoice.customers?.email || undefined,
  });

  // Store QBO invoice ID in database
  await supabase
    .from('invoices')
    .update({ qb_invoice_id: qboInvoice.Id })
    .eq('id', invoiceId);

  return qboInvoice.Id!;
}

/**
 * Sync a payment to QuickBooks
 * Returns the QBO payment ID
 */
export async function syncPaymentToQBO(paymentId: string): Promise<string> {
  const supabase = await createClient();
  const qbo = await getQuickBooksClient();
  
  if (!qbo) {
    throw new Error('QuickBooks not connected');
  }

  // Get payment with invoice and customer
  const { data: paymentData, error: paymentError } = await supabase
    .from('payments')
    .select(`
      *,
      invoices (
        id, 
        qb_invoice_id,
        customer_id,
        customers (id, qb_customer_id)
      )
    `)
    .eq('id', paymentId)
    .single();

  if (paymentError || !paymentData) {
    throw new Error('Payment not found');
  }
  
  const payment = paymentData as unknown as PaymentRow;

  // Check if already synced
  if (payment.qb_payment_id) {
    return payment.qb_payment_id;
  }

  const invoice = payment.invoices;

  // Ensure invoice is synced first
  let qbInvoiceId = invoice?.qb_invoice_id;
  if (!qbInvoiceId && invoice?.id) {
    qbInvoiceId = await syncInvoiceToQBO(invoice.id);
  }

  // Ensure customer is synced
  let qbCustomerId = invoice?.customers?.qb_customer_id;
  if (!qbCustomerId && invoice?.customer_id) {
    qbCustomerId = await syncCustomerToQBO(invoice.customer_id);
  }

  if (!qbCustomerId) {
    throw new Error('Could not determine QuickBooks customer ID for payment');
  }

  // Create payment in QBO
  const qboPayment = await qbo.client.createPayment({
    customerId: qbCustomerId,
    amount: payment.amount,
    invoiceId: qbInvoiceId || undefined,
    notes: payment.notes || undefined,
  });

  // Store QBO payment ID in database
  await supabase
    .from('payments')
    .update({ qb_payment_id: qboPayment.Id })
    .eq('id', paymentId);

  return qboPayment.Id!;
}

/**
 * Get QuickBooks connection status
 */
export async function getQBOConnectionStatus(): Promise<{
  connected: boolean;
  companyName?: string;
  environment?: string;
  connectedAt?: string;
  tokenExpired?: boolean;
} | null> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data } = await supabase
    .from('quickbooks_connections')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!data) {
    return { connected: false };
  }
  
  const connection = data as unknown as QBOConnection;
  const tokenExpired = new Date(connection.token_expires_at) < new Date();

  // Try to get company info if token is valid
  let companyName: string | undefined;
  if (!tokenExpired) {
    try {
      const qbo = await getQuickBooksClient();
      if (qbo) {
        const companyInfo = await qbo.client.getCompanyInfo();
        companyName = companyInfo.CompanyName;
      }
    } catch {
      // Ignore errors getting company info
    }
  }

  return {
    connected: true,
    companyName,
    environment: connection.environment,
    connectedAt: connection.connected_at,
    tokenExpired,
  };
}
