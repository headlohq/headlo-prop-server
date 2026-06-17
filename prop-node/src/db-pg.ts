// PostgreSQL / MySQL implementation of PropDB.
// Works with any pg-compatible database:
//   postgresql://user:pass@host:5432/db  ← Postgres, Neon, Supabase, CockroachDB, RDS
//   mysql://user:pass@host:3306/db       ← MySQL, PlanetScale (swap pg import for mysql2)

import { Pool } from 'pg'
import type { PropDB, SyncBody } from './db.js'

export class PostgresDB implements PropDB {
  private pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString })
  }

  async getBundle(slug: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ component_bundle: string | null }>(
      'SELECT component_bundle FROM prop_component.app WHERE slug = $1',
      [slug]
    )
    return rows[0]?.component_bundle ?? null
  }

  async upsertComponent(slug: string, body: SyncBody): Promise<void> {
    await this.pool.query(
      `INSERT INTO prop_component.app
         (def_id, owner_id, slug, name, component_src, component_js, component_bundle, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (slug) DO UPDATE SET
         component_src    = EXCLUDED.component_src,
         component_js     = EXCLUDED.component_js,
         component_bundle = EXCLUDED.component_bundle,
         updated_at       = NOW()`,
      [
        body.def_id           ?? '',
        body.owner_id         ?? '',
        slug,
        body.name             ?? slug,
        body.component_src    ?? null,
        body.component_js     ?? null,
        body.component_bundle ?? null,
      ]
    )
  }

  async listSlugs(): Promise<string[]> {
    const { rows } = await this.pool.query<{ slug: string }>(
      'SELECT slug FROM prop_component.app ORDER BY slug'
    )
    return rows.map(r => r.slug)
  }
}
