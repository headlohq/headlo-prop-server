// SQL Server implementation of PropDB.
//
// Connection: Hyperdrive does NOT support SQL Server.
// Pass DATABASE_URL as a wrangler secret instead:
//   wrangler secret put DATABASE_URL
//   Value: Server=tcp:myserver.database.windows.net,1433;Database=prop;
//          User Id=myuser;Password=mypass;Encrypt=true;
//
// CF Workers support TCP sockets natively (connect() API) so mssql/tedious
// works without a proxy. Requires Workers Paid plan.
//
// To activate: in index.ts swap
//   import { PostgresDB } from './db-pg'        → db = new PostgresDB(env.HYPERDRIVE.connectionString)
// for
//   import { MssqlDB }    from './db-mssql'     → db = new MssqlDB(env.DATABASE_URL)
// and remove the HYPERDRIVE binding from wrangler.jsonc.

import sql from 'mssql'
import type { PropDB, SyncBody } from './db'

export class MssqlDB implements PropDB {
  private connStr: string

  constructor(connectionString: string) {
    this.connStr = connectionString
  }

  private async connect(): Promise<sql.ConnectionPool> {
    return sql.connect(this.connStr)
  }

  async getBundle(slug: string): Promise<string | null> {
    const pool = await this.connect()
    const result = await pool.request()
      .input('slug', sql.NVarChar, slug)
      .query('SELECT component_bundle FROM prop_component_app WHERE slug = @slug')
    return result.recordset[0]?.component_bundle ?? null
  }

  async upsertComponent(slug: string, body: SyncBody): Promise<void> {
    const pool = await this.connect()
    await pool.request()
      .input('def_id',           sql.NVarChar, body.def_id           ?? '')
      .input('owner_id',         sql.NVarChar, body.owner_id         ?? '')
      .input('slug',             sql.NVarChar, slug)
      .input('name',             sql.NVarChar, body.name             ?? slug)
      .input('component_src',    sql.NVarChar(sql.MAX), body.component_src    ?? null)
      .input('component_js',     sql.NVarChar(sql.MAX), body.component_js     ?? null)
      .input('component_bundle', sql.NVarChar(sql.MAX), body.component_bundle ?? null)
      .query(`
        MERGE prop_component_app AS target
        USING (SELECT @slug AS slug) AS src ON target.slug = src.slug
        WHEN MATCHED THEN UPDATE SET
          component_src    = @component_src,
          component_js     = @component_js,
          component_bundle = @component_bundle,
          updated_at       = GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT
          (def_id, owner_id, slug, name, component_src, component_js, component_bundle, created_at, updated_at)
        VALUES
          (@def_id, @owner_id, @slug, @name, @component_src, @component_js, @component_bundle, GETUTCDATE(), GETUTCDATE());
      `)
  }

  async listSlugs(): Promise<string[]> {
    const pool = await this.connect()
    const result = await pool.request()
      .query('SELECT slug FROM prop_component_app ORDER BY slug')
    return result.recordset.map((r: { slug: string }) => r.slug)
  }
}
