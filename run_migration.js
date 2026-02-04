const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// Supabase PostgreSQL connection
// Format: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PROJECT_REF = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || process.env.POSTGRES_PASSWORD;

if (!DB_PASSWORD) {
    console.log('Need SUPABASE_DB_PASSWORD in .env.local');
    console.log('Find it in Supabase Dashboard > Settings > Database > Connection string');
    process.exit(1);
}

const pool = new Pool({
    host: `db.${PROJECT_REF}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    const sql = fs.readFileSync(
        path.join(__dirname, 'supabase/migrations/20260204_utility_infrastructure.sql'),
        'utf8'
    );
    
    try {
        console.log('Connecting to Supabase PostgreSQL...');
        const client = await pool.connect();
        console.log('Connected! Running migration...');
        
        await client.query(sql);
        console.log('✅ Migration complete!');
        
        client.release();
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

runMigration();
