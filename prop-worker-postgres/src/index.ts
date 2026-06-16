// headlo-prop-worker — proxy mode
// Forwards all /v1/prop/* requests to api.headlo.com, injecting the
// publishable key so Headlo knows which agency's data to serve.
//
// Publishers deploy this to get a branded domain (prop.acme.com) while
// Headlo manages all component/service/distribution data.
//
// Deploy:  wrangler deploy
// Secrets: wrangler secret put HEADLO_PUBLISHABLE_KEY

export interface Env {
  HEADLO_PUBLISHABLE_KEY: string  // pk_live_xxx — from Headlo dashboard
  HEADLO_ORIGIN?: string          // override for dev: https://api-dev.headlo.com
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // Health check — public, no proxy
    if (url.pathname === '/status') {
      return json({ ok: true, mode: 'proxy', version: '0.2.0' })
    }

    // Only proxy recognised paths
    if (!url.pathname.startsWith('/v1/prop/') && url.pathname !== '/sync') {
      return json({ error: 'Not found' }, 404)
    }

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

    // Re-apply CORS for the branded domain
    const proxied = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: new Headers(upstream.headers),
    })
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      proxied.headers.set(k, v)
    }
    return proxied
  },
}
