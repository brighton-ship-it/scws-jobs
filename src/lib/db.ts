import { Pool } from 'pg'

// Database connection pool - use Supabase pooler for serverless (IPv4 compatible)
// Transaction mode pooler for short-lived serverless connections
const pool = new Pool({
  host: process.env.DB_HOST || 'aws-0-us-west-1.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '6543'), // Pooler port
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.htzsnpqrrrdfleldgybn', // Pooler requires project ref in username
  password: process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const client = await pool.connect()
  try {
    const result = await client.query(text, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] || null
}

export { pool }
