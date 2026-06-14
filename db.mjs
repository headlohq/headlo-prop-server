import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Copy .env.example to .env and fill it in.')
  process.exit(1)
}

export const db = new Pool({ connectionString: process.env.DATABASE_URL })

export async function query(sql, params = []) {
  return db.query(sql, params)
}
