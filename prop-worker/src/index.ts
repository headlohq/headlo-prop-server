// headlo-prop-worker
//
// Two modes — determined automatically by whether HYPERDRIVE is bound:
//
//   Proxy mode     (no HYPERDRIVE binding): all /v1/prop/* forwarded to Headlo.
//                  Branded domain, Headlo holds the data.
//
//   Self-hosted    (HYPERDRIVE bound): four routes handled locally against your DB;
//                  everything else still proxied to Headlo.
//     GET  /v1/prop/component/:slug/bundle   serve bundle from your DB
//     POST /v1/prop/component/:slug/sync     receive + store compiled code from Headlo
//     GET  /v1/prop/sync                     return slug list for Headlo routing cache
//     GET  /v1/prop/status                   health check (returns mode)
//
// See headlo-prop-server/docs/headlo-prop-split.md for full ownership breakdown.

// ── DB implementation ──────────────────────────────────────────────────────
// Default: Postgres / MySQL via Hyperdrive (db-pg.ts)
// SQL Server: swap to db-mssql.ts — see db-mssql.ts for instructions
import { PostgresDB } from './db-pg'
import type { PropDB, SyncBody } from './db'

export interface Env {
  HEADLO_PUBLISHABLE_KEY: string
  HEADLO_ORIGIN?: string
  HYPERDRIVE?: Hyperdrive  // omit from wrangler.jsonc for proxy-only mode
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'X-Headlo-Prop-Publishable-Key',
    'X-Headlo-Prop-Secret',
    'X-Prop-User-Id',
    'X-Prop-Source',
  ].join(', '),
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function validateKey(request: Request, env: Env): boolean {
  return request.headers.get('X-Headlo-Prop-Publishable-Key') === env.HEADLO_PUBLISHABLE_KEY
}

async function proxyToHeadlo(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const origin = env.HEADLO_ORIGIN ?? 'https://api.headlo.com'
  const target = new URL(url.pathname + url.search, origin)
  const headers = new Headers(request.headers)
  headers.set('X-Headlo-Prop-Publishable-Key', env.HEADLO_PUBLISHABLE_KEY)
  headers.delete('host')
  const upstream = await fetch(new Request(target.toString(), {
    method: request.method,
    headers,
    body: request.body,
  }))
  const proxied = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: new Headers(upstream.headers),
  })
  for (const [k, v] of Object.entries(CORS_HEADERS)) proxied.headers.set(k, v)
  return proxied
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ── Health check ──────────────────────────────────────────────────────
    if (pathname === '/v1/prop/status') {
      return json({ ok: true, mode: env.HYPERDRIVE ? 'self-hosted' : 'proxy', version: '1.0.0' })
    }

    // ── Self-hosted routes — only when HYPERDRIVE is bound ─────────────────
    if (env.HYPERDRIVE) {
      const db: PropDB = new PostgresDB(env.HYPERDRIVE.connectionString)

      if (pathname === '/v1/prop/sync' && request.method === 'GET') {
        const slugs = await db.listSlugs()
        return json({ slugs })
      }

      const bundleMatch = pathname.match(/^\/v1\/prop\/component\/([^/]+)\/bundle$/)
      if (bundleMatch && request.method === 'GET') {
        const bundle = await db.getBundle(bundleMatch[1])
        if (!bundle) return json({ error: 'Not found' }, 404)
        return new Response(bundle, {
          headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', ...CORS_HEADERS },
        })
      }

      const syncMatch = pathname.match(/^\/v1\/prop\/component\/([^/]+)\/sync$/)
      if (syncMatch && request.method === 'POST') {
        if (!validateKey(request, env)) return json({ error: 'Unauthorized' }, 401)
        const body = await request.json() as SyncBody
        await db.upsertComponent(syncMatch[1], body)
        return json({ ok: true, slug: syncMatch[1] })
      }
    }

    // ── Everything else → Headlo ──────────────────────────────────────────
    if (pathname.startsWith('/v1/prop/')) return proxyToHeadlo(request, env)

    return json({ error: 'Not found' }, 404)
  },
}
