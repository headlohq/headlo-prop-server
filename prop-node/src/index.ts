// headlo-prop-node
//
// Node.js HTTP server — same routes as prop-worker but runs anywhere Node.js 18+ runs.
// Use this if you don't use Cloudflare Workers / Hyperdrive.
//
// Route ownership (headlo-prop-server/docs/headlo-prop-split.md):
//   PROP server owns (handled here):
//     GET  /v1/prop/component/:slug/bundle   serve bundle from DB
//     POST /v1/prop/component/:slug/sync     receive + store compiled code from Headlo
//     GET  /v1/prop/sync                     return slug list for Headlo routing cache
//     GET  /v1/prop/status                   health check
//   Headlo owns (proxied):
//     everything else under /v1/prop/*
//
// Environment variables (.env or process.env):
//   DATABASE_URL               postgres://user:pass@host:5432/db
//   HEADLO_PUBLISHABLE_KEY     pk_live_xxx  (from Headlo dashboard)
//   HEADLO_ORIGIN              https://api.headlo.com  (optional override)
//   PORT                       3000 (optional)

// ── DB implementation ──────────────────────────────────────────────────────
// Default: Postgres / MySQL (db-pg.ts)
// SQL Server: swap to db-mssql.ts — see db-mssql.ts for instructions
import http from 'node:http'
import { PostgresDB } from './db-pg.js'
import type { PropDB, SyncBody } from './db.js'

const DATABASE_URL           = process.env.DATABASE_URL ?? ''
const HEADLO_PUBLISHABLE_KEY = process.env.HEADLO_PUBLISHABLE_KEY ?? ''
const HEADLO_ORIGIN          = process.env.HEADLO_ORIGIN ?? 'https://api.headlo.com'
const PORT                   = Number(process.env.PORT ?? 3000)

const db: PropDB = new PostgresDB(DATABASE_URL)

const CORS_HEADERS: Record<string, string> = {
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

function sendJson(res: http.ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS })
  res.end(payload)
}

function sendJs(res: http.ServerResponse, bundle: string): void {
  res.writeHead(200, {
    'Content-Type': 'application/javascript',
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
  })
  res.end(bundle)
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function proxyToHeadlo(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawBody: string,
): Promise<void> {
  const target = new URL(req.url ?? '/', HEADLO_ORIGIN)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (k === 'host') continue
    if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v
  }
  headers['x-headlo-prop-publishable-key'] = HEADLO_PUBLISHABLE_KEY

  const upstream = await fetch(target.toString(), {
    method: req.method,
    headers,
    body: rawBody || undefined,
  })

  const upstreamHeaders: Record<string, string> = {}
  upstream.headers.forEach((v, k) => { upstreamHeaders[k] = v })

  res.writeHead(upstream.status, { ...upstreamHeaders, ...CORS_HEADERS })
  const buf = await upstream.arrayBuffer()
  res.end(Buffer.from(buf))
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const method   = req.method ?? 'GET'

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  try {
    // ── Health check ──────────────────────────────────────────────────────
    if (pathname === '/v1/prop/status') {
      return sendJson(res, { ok: true, mode: 'node', version: '1.0.0' })
    }

    // ── Slug sync ─────────────────────────────────────────────────────────
    if (pathname === '/v1/prop/sync' && method === 'GET') {
      const slugs = await db.listSlugs()
      return sendJson(res, { slugs })
    }

    // ── Component bundle — served from this DB, never from Headlo ─────────
    const bundleMatch = pathname.match(/^\/v1\/prop\/component\/([^/]+)\/bundle$/)
    if (bundleMatch && method === 'GET') {
      const bundle = await db.getBundle(bundleMatch[1])
      if (!bundle) return sendJson(res, { error: 'Not found' }, 404)
      return sendJs(res, bundle)
    }

    // ── Component sync — Headlo pushes compiled code here ─────────────────
    const syncMatch = pathname.match(/^\/v1\/prop\/component\/([^/]+)\/sync$/)
    if (syncMatch && method === 'POST') {
      const key = req.headers['x-headlo-prop-publishable-key']
      if (key !== HEADLO_PUBLISHABLE_KEY) return sendJson(res, { error: 'Unauthorized' }, 401)
      const raw  = await readBody(req)
      const body = JSON.parse(raw) as SyncBody
      await db.upsertComponent(syncMatch[1], body)
      return sendJson(res, { ok: true, slug: syncMatch[1] })
    }

    // ── Everything else → Headlo ──────────────────────────────────────────
    if (pathname.startsWith('/v1/prop/')) {
      const raw = await readBody(req)
      return await proxyToHeadlo(req, res, raw)
    }

    sendJson(res, { error: 'Not found' }, 404)
  } catch (err) {
    console.error(err)
    sendJson(res, { error: 'Internal server error' }, 500)
  }
})

server.listen(PORT, () => {
  console.log(`headlo-prop-node listening on :${PORT}`)
})
