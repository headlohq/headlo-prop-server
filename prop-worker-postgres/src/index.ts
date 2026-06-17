// headlo-prop-worker — PROP server (postgres mode)
//
// Route ownership per the split (headlo-prop-server/docs/headlo-prop-split.md):
//
//   PROP server owns (handled here, reads/writes local DB):
//     GET  /v1/prop/component/:slug/bundle   serve component_bundle from prop_component.app
//     POST /v1/prop/component/:slug/sync     receive compiled code from Headlo, store it
//     GET  /sync                             return slug list so Headlo can update routing cache
//     GET  /status                           health check
//
//   Headlo owns (proxied):
//     GET  /v1/prop/dist/:runtime/:version/bundle    Headlo CDN
//     GET  /v1/prop/component/:slug/def              Headlo registry
//     GET  /v1/prop/service/:slug/:version/manifest  Headlo registry
//     POST /v1/prop/service/billing-*/v1/call        Headlo billing (called server→Headlo, not browser→here)
//     everything else under /v1/prop/*

import { Pool } from 'pg'

export interface Env {
  HEADLO_PUBLISHABLE_KEY: string  // pk_live_xxx — from Headlo dashboard
  HEADLO_ORIGIN?: string          // override for dev: https://api-dev.headlo.com
  HYPERDRIVE: Hyperdrive          // wrangler hyperdrive binding → prop_component DB
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
  const key = request.headers.get('X-Headlo-Prop-Publishable-Key')
  return key === env.HEADLO_PUBLISHABLE_KEY
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
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    proxied.headers.set(k, v)
  }
  return proxied
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ── Health check ────────────────────────────────────────────
    if (pathname === '/status') {
      return json({ ok: true, mode: 'postgres', version: '0.3.0' })
    }

    // ── Slug sync — Headlo calls this to refresh its routing cache
    if (pathname === '/sync' && request.method === 'GET') {
      const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString })
      try {
        const { rows } = await pool.query<{ slug: string }>(
          'SELECT slug FROM prop_component.app ORDER BY slug'
        )
        return json({ slugs: rows.map(r => r.slug) })
      } finally {
        await pool.end()
      }
    }

    // ── Component bundle — served directly from this DB, never from Headlo
    const bundleMatch = pathname.match(/^\/v1\/prop\/component\/([^/]+)\/bundle$/)
    if (bundleMatch && request.method === 'GET') {
      const slug = bundleMatch[1]
      const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString })
      try {
        const { rows } = await pool.query<{ component_bundle: string | null }>(
          'SELECT component_bundle FROM prop_component.app WHERE slug = $1',
          [slug]
        )
        if (!rows.length || !rows[0].component_bundle) {
          return json({ error: 'Not found' }, 404)
        }
        return new Response(rows[0].component_bundle, {
          headers: {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-store',
            ...CORS_HEADERS,
          },
        })
      } finally {
        await pool.end()
      }
    }

    // ── Component sync — Headlo pushes compiled output after every Monaco save
    const syncMatch = pathname.match(/^\/v1\/prop\/component\/([^/]+)\/sync$/)
    if (syncMatch && request.method === 'POST') {
      if (!validateKey(request, env)) {
        return json({ error: 'Unauthorized' }, 401)
      }
      const slug = syncMatch[1]
      const body = await request.json() as {
        component_src?: string
        component_js?: string
        component_bundle?: string
        def_id?: string
        owner_id?: string
        name?: string
      }
      const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString })
      try {
        await pool.query(
          `INSERT INTO prop_component.app
             (def_id, owner_id, slug, name, component_src, component_js, component_bundle, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (slug) DO UPDATE SET
             component_src    = EXCLUDED.component_src,
             component_js     = EXCLUDED.component_js,
             component_bundle = EXCLUDED.component_bundle,
             updated_at       = NOW()`,
          [
            body.def_id    ?? '',
            body.owner_id  ?? '',
            slug,
            body.name      ?? slug,
            body.component_src    ?? null,
            body.component_js     ?? null,
            body.component_bundle ?? null,
          ]
        )
        return json({ ok: true, slug })
      } finally {
        await pool.end()
      }
    }

    // ── All other /v1/prop/* routes → proxy to Headlo ───────────
    if (pathname.startsWith('/v1/prop/')) {
      return proxyToHeadlo(request, env)
    }

    return json({ error: 'Not found' }, 404)
  },
}
