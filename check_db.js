const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function main() {
    console.log('Testing Supabase connection...');
    
    // Check if we can query
    const { data, error } = await supabase
        .from('customers')
        .select('id')
        .limit(1);
    
    if (error) {
        console.log('Query error:', error.message);
    } else {
        console.log('✓ Can query tables');
    }
    
    // Check if utility tables exist
    const { data: d2, error: e2 } = await supabase
        .from('sd_sewer_mains')
        .select('id')
        .limit(1);
    
    if (e2 && e2.message.includes('does not exist')) {
        console.log('✗ Utility tables not created yet - need migration');
    } else if (e2) {
        console.log('Table check:', e2.message);
    } else {
        console.log('✓ Utility tables exist!');
    }
}

main();
