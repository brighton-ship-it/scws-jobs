/**
 * POST /api/quickbooks/sync/customer
 * Syncs a customer to QuickBooks
 */

import { createClient } from '@/lib/supabase/server';
import { QuickBooksClient } from '@/lib/quickbooks/client';
import { refreshAccessToken } from '@/lib/quickbooks/oauth';

async function getQBClient(supabase, userId) {
  // Get QuickBooks connection
  const { data: connection, error } = await supabase
    .from('quickbooks_connections')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !connection) {
    throw new Error('QuickBooks not connected');
  }

  // Check if token needs refresh (expires in less than 5 minutes)
  const expiresAt = new Date(connection.token_expires_at);
  if (expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
    // Refresh token
    const tokens = await refreshAccessToken({
      refreshToken: connection.refresh_token,
      clientId: process.env.QUICKBOOKS_CLIENT_ID,
      clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
    });

    // Update stored tokens
    await supabase
      .from('quickbooks_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      })
      .eq('user_id', userId);

    connection.access_token = tokens.access_token;
  }

  return new QuickBooksClient({
    accessToken: connection.access_token,
    realmId: connection.realm_id,
    environment: connection.environment,
  });
}

export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { customerId } = await request.json();
    
    // Get customer from our database
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      return Response.json({ error: 'Customer not found' }, { status: 404 });
    }

    // Get QuickBooks client
    const qb = await getQBClient(supabase, user.id);

    // Check if customer already exists in QuickBooks
    let qbCustomer = null;
    if (customer.qb_customer_id) {
      qbCustomer = await qb.getCustomer(customer.qb_customer_id);
    } else if (customer.email) {
      qbCustomer = await qb.findCustomerByEmail(customer.email);
    }

    if (qbCustomer) {
      // Update existing customer
      qbCustomer = await qb.updateCustomer({
        ...qbCustomer,
        DisplayName: customer.name || `${customer.first_name} ${customer.last_name}`.trim(),
        GivenName: customer.first_name,
        FamilyName: customer.last_name,
        PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
        PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
      });
    } else {
      // Create new customer
      qbCustomer = await qb.createCustomer({
        name: customer.name,
        firstName: customer.first_name,
        lastName: customer.last_name,
        companyName: customer.company_name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address ? {
          street1: customer.address.street,
          city: customer.address.city,
          state: customer.address.state,
          zip: customer.address.zip,
        } : null,
      });
    }

    // Save QuickBooks customer ID back to our database
    await supabase
      .from('customers')
      .update({ qb_customer_id: qbCustomer.Id })
      .eq('id', customerId);

    return Response.json({ 
      success: true, 
      qbCustomerId: qbCustomer.Id,
      message: 'Customer synced to QuickBooks'
    });

  } catch (error) {
    console.error('Customer sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
