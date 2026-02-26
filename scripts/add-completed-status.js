#!/usr/bin/env node
/**
 * Add 'completed' status to quotes table
 * Uses Supabase Management API or direct connection
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://htzsnpqrrrdfleldgybn.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0enNucHFycnJkZmxlbGRneWJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTkxNDQ0OCwiZXhwIjoyMDg1NDkwNDQ4fQ.7YxD2rqsh0CfESPK3DBLC4dhZL5kJy8XDtyinBgU49c';

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // First, check current constraint
  console.log('Checking current quotes table constraints...');
  
  const { data: constraints, error: constraintError } = await supabase
    .from('information_schema.check_constraints')
    .select('*')
    .eq('constraint_name', 'quotes_status_check');
  
  if (constraintError) {
    console.log('Cannot query constraints directly:', constraintError.message);
  } else {
    console.log('Current constraints:', constraints);
  }

  // Try using rpc to execute SQL
  console.log('\nAttempting to run ALTER TABLE via RPC...');
  
  const sql = `
    ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
    ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check 
      CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'completed'));
  `;

  // Method 1: Try exec_sql RPC (if it exists)
  const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', { 
    sql_query: sql 
  });

  if (rpcError) {
    console.log('RPC method failed:', rpcError.message);
    
    // Method 2: Try using the postgrest hints
    console.log('\nTrying alternative approaches...');
    
    // Check if we can at least verify the current state
    const { data: testQuote, error: testError } = await supabase
      .from('quotes')
      .select('id, status')
      .limit(1);
    
    if (testError) {
      console.log('Cannot even read quotes:', testError);
    } else {
      console.log('Can read quotes, current sample:', testQuote);
      
      // Try updating with completed status to see exact error
      if (testQuote && testQuote[0]) {
        const { error: updateError } = await supabase
          .from('quotes')
          .update({ status: 'completed' })
          .eq('id', testQuote[0].id);
        
        if (updateError) {
          console.log('\nConstraint blocks update:', updateError.message);
          console.log('\n=== MANUAL ACTION REQUIRED ===');
          console.log('Run this SQL in Supabase Dashboard SQL Editor:');
          console.log('https://supabase.com/dashboard/project/htzsnpqrrrdfleldgybn/sql/new\n');
          console.log(sql);
        } else {
          console.log('Update succeeded! Constraint may already include completed.');
          // Revert the test
          await supabase
            .from('quotes')
            .update({ status: testQuote[0].status })
            .eq('id', testQuote[0].id);
        }
      }
    }
  } else {
    console.log('Migration succeeded via RPC!', rpcData);
  }
}

main().catch(console.error);
