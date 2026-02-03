#!/usr/bin/env node

// Run the marketing tables migration against Supabase using pg
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const pool = new Pool({
  host: 'db.htzsnpqrrrdfleldgybn.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Scwellservice123!',
  ssl: { rejectUnauthorized: false }
})

async function runMigration() {
  console.log('Connecting to Supabase...')
  const client = await pool.connect()
  
  try {
    console.log('Running marketing tables migration...')
    
    const sqlPath = path.join(__dirname, '../supabase/migrations/20260202_marketing_tables.sql')
    const sql = fs.readFileSync(sqlPath, 'utf-8')
    
    await client.query(sql)
    
    console.log('✅ Migration complete!')
    
    // Verify tables were created
    const { rows } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name LIKE 'marketing_%'
    `)
    
    console.log('Created tables:')
    rows.forEach(r => console.log(`  - ${r.table_name}`))
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))
