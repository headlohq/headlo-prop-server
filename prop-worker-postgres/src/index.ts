// headlo-prop-worker
// Cloudflare Worker implementing the PROP server API.
// Uses Hyperdrive for fast, pooled connections to any Postgres database.
// Validates x-prop-client-id + x-prop-secret on every request from Headlo.
//
// Deploy: wrangler deploy
// Secrets: wrangler secret put PROP_CLIENT_ID
//          wrangler secret put PROP_SECRET
//          wrangler secret put OPENAI_API_KEY
//          wrangler secret put ANTHROPIC_API_KEY

import { Client } from 'pg'

export interface Env {
  DB: Hyperdrive
  SESSIONS: DurableObjectNamespace
  PROP_CLIENT_ID: string
  PROP_SECRET: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(request: Request, env: Env): boolean {
  return (
    request.headers.get('x-prop-client-id') === env.PROP_CLIENT_ID &&
    request.headers.get('x-prop-secret') === env.PROP_SECRET
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function withDb<T>(env: Env, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: env.DB.connectionString })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleGet(env: Env, defSlug: string, appSlug: string, userId?: string): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT a.app_id, a.config, c.js, s.state, d.contract
      FROM prop.app   a
      JOIN prop.def   d ON d.def_id = a.def_id
      JOIN prop.code  c ON c.app_id = a.app_id
      JOIN prop.state s ON s.app_id = a.app_id
      WHERE d.slug = $1 AND a.slug = $2
    `, [defSlug, appSlug])

    if (!rows.length) return json({ error: 'Not found' }, 404)
    const row = rows[0]

    if (userId) {
      const { rows: urows } = await db.query(`
        SELECT state AS user_state FROM prop.user_state
        WHERE app_id = $1 AND user_id = $2
      `, [row.app_id, userId])
      row.user_state = urows[0]?.user_state ?? {}
    }

    return json(row)
  })
}

async function handleAction(
  env: Env,
  defSlug: string,
  appSlug: string,
  action: string,
  args: Record<string, unknown>,
  source: string,
  userId?: string,
): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT a.app_id, a.config, d.handlers, s.state, s.version
      FROM prop.app   a
      JOIN prop.def   d ON d.def_id = a.def_id
      JOIN prop.state s ON s.app_id = a.app_id
      WHERE d.slug = $1 AND a.slug = $2
    `, [defSlug, appSlug])

    if (!rows.length) return json({ error: 'Not found' }, 404)
    const { app_id, config, handlers, state, version } = rows[0]

    // Load user state if user context provided
    let userState: Record<string, unknown> = {}
    let userVersion = 0
    if (userId) {
      const { rows: urows } = await db.query(`
        SELECT state, version FROM prop.user_state WHERE app_id = $1 AND user_id = $2
      `, [app_id, userId])
      if (urows.length) { userState = urows[0].state; userVersion = urows[0].version }
    }

    const handler = handlers[action]
    if (!handler) return json({ error: `Unknown action: ${action}` }, 400)

    // Dispatch to the built-in action handlers
    let result: Record<string, unknown> = {}
    if (defSlug === 'ask-widget' && action === 'onSubmit') {
      result = await askWidgetOnSubmit(env, args as { question: string }, state)
    } else if (defSlug === 'llm-chat' && action === 'chat') {
      result = await llmChat(env, args as { messages: Message[]; systemPrompt: string }, config as LlmConfig)
    } else {
      return json({ error: `No handler registered for ${defSlug}.${action}` }, 501)
    }

    // Merge into global state
    const nextState = { ...state }
    for (const key of handler.updates_state ?? []) {
      if (key in result) nextState[key] = result[key]
    }

    await db.query(`
      UPDATE prop.state
      SET state = $1, version = version + 1, updated_at = NOW()
      WHERE app_id = $2 AND version = $3
    `, [JSON.stringify(nextState), app_id, version])

    // Merge into user state if handler declares user-scoped keys
    if (userId && (handler.updates_user_state ?? []).length > 0) {
      const nextUserState = { ...userState }
      for (const key of handler.updates_user_state) {
        if (key in result) nextUserState[key] = result[key]
      }
      await db.query(`
        INSERT INTO prop.user_state (app_id, user_id, state, version, updated_at)
        VALUES ($1, $2, $3, 1, NOW())
        ON CONFLICT (app_id, user_id) DO UPDATE
          SET state = $3, version = prop.user_state.version + 1, updated_at = NOW()
          WHERE prop.user_state.version = $4
      `, [app_id, userId, JSON.stringify(nextUserState), userVersion])
    }

    await db.query(`
      INSERT INTO prop.event (app_id, action, args, result, source)
      VALUES ($1, $2, $3, $4, $5)
    `, [app_id, action, JSON.stringify(args), JSON.stringify(result), source])

    return json({ state: nextState, user_state: userId ? userState : undefined, ...result })
  })
}

async function handleSave(env: Env, defSlug: string, appSlug: string, body: { src?: string; js?: string }): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT a.app_id FROM prop.app a
      JOIN prop.def d ON d.def_id = a.def_id
      WHERE d.slug = $1 AND a.slug = $2
    `, [defSlug, appSlug])

    if (!rows.length) return json({ error: 'Not found' }, 404)
    const { app_id } = rows[0]

    await db.query(`
      INSERT INTO prop.code (app_id, src, js, updated_at) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (app_id) DO UPDATE SET src = $2, js = $3, updated_at = NOW()
    `, [app_id, body.src ?? null, body.js ?? null])

    return json({ ok: true })
  })
}

async function handleSync(env: Env): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT a.slug, d.slug AS def_slug
      FROM prop.app a JOIN prop.def d ON d.def_id = a.def_id
    `)
    return json({ apps: rows })
  })
}

// ── Data query handlers ───────────────────────────────────────────────────────

async function handleDataDefs(env: Env): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`SELECT * FROM prop.def ORDER BY name`)
    return json({ defs: rows })
  })
}

async function handleDataDef(env: Env, defSlug: string): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`SELECT * FROM prop.def WHERE slug = $1`, [defSlug])
    if (!rows.length) return json({ error: 'Not found' }, 404)
    return json(rows[0])
  })
}

async function handleDataApps(env: Env): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT a.*, d.slug AS def_slug
      FROM prop.app a JOIN prop.def d ON d.def_id = a.def_id
      ORDER BY a.slug
    `)
    return json({ apps: rows })
  })
}

async function handleDataApp(env: Env, appSlug: string): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT a.*, d.slug AS def_slug, s.state, s.version
      FROM prop.app a
      JOIN prop.def d ON d.def_id = a.def_id
      JOIN prop.state s ON s.app_id = a.app_id
      WHERE a.slug = $1
    `, [appSlug])
    if (!rows.length) return json({ error: 'Not found' }, 404)
    return json(rows[0])
  })
}

async function handleDataState(env: Env, appSlug: string): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT s.* FROM prop.state s
      JOIN prop.app a ON a.app_id = s.app_id
      WHERE a.slug = $1
    `, [appSlug])
    if (!rows.length) return json({ error: 'Not found' }, 404)
    return json(rows[0])
  })
}

async function handleDataEvents(env: Env, appSlug: string): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT e.* FROM prop.event e
      JOIN prop.app a ON a.app_id = e.app_id
      WHERE a.slug = $1
      ORDER BY e.created_at DESC
    `, [appSlug])
    return json({ events: rows })
  })
}

async function handleDataImpls(env: Env, defSlug: string): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT i.* FROM prop.impl i
      JOIN prop.def d ON d.def_id = i.def_id
      WHERE d.slug = $1
    `, [defSlug])
    return json({ impls: rows })
  })
}

async function handleDataUserState(env: Env, appSlug: string, userId: string): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT us.* FROM prop.user_state us
      JOIN prop.app a ON a.app_id = us.app_id
      WHERE a.slug = $1 AND us.user_id = $2
    `, [appSlug, userId])
    if (!rows.length) return json({ state: {}, version: 0 })
    return json(rows[0])
  })
}

async function handleDataSessions(env: Env, appSlug: string): Promise<Response> {
  return withDb(env, async (db) => {
    const { rows } = await db.query(`
      SELECT s.* FROM prop.session s
      JOIN prop.app a ON a.app_id = s.app_id
      WHERE a.slug = $1
      ORDER BY s.created_at DESC
    `, [appSlug])
    return json({ sessions: rows })
  })
}

// ── llm-chat built-in handler ────────────────────────────────────────────────
// Two providers, one contract: chat({ messages, systemPrompt }) → { answer }
// The implementation is selected by prop.app.config.provider.
// Swap provider by pointing to a different prop.app — nothing else changes.

interface Message { role: string; content: string }
interface LlmConfig { provider: string; model: string; temperature?: number }

async function llmChat(
  env: Env,
  args: { messages: Message[]; systemPrompt: string },
  config: LlmConfig,
): Promise<Record<string, unknown>> {
  const { messages, systemPrompt } = args
  const { provider, model, temperature = 0.7 } = config

  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model, temperature,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`)
    const data = await res.json() as { choices: { message: { content: string } }[] }
    return { answer: data.choices[0].message.content.trim() }
  }

  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 1024, temperature, system: systemPrompt, messages }),
    })
    if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`)
    const data = await res.json() as { content: { text: string }[] }
    return { answer: data.content[0].text.trim() }
  }

  throw new Error(`Unknown provider: ${provider}. Use 'openai' or 'anthropic'.`)
}

// ── Ask Widget built-in handler ───────────────────────────────────────────────

async function askWidgetOnSubmit(
  env: Env,
  args: { question: string },
  state: { messages?: { role: string; text: string }[] },
): Promise<Record<string, unknown>> {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')

  const history = state.messages ?? []
  const openaiMessages = [
    ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: args.question },
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: openaiMessages }),
  })

  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`)
  const data = await res.json() as { choices: { message: { content: string } }[] }
  const answer = data.choices?.[0]?.message?.content?.trim() ?? ''

  const messages = [
    ...history,
    { role: 'user',      text: args.question },
    { role: 'assistant', text: answer },
  ]

  return { messages }
}

// ── PropSession Durable Object — real-time WebSocket room ────────────────────
// Each session_id gets its own DO instance. Broadcasts all messages to every
// connected client in the room. Used for multiplayer PROPs (races, live polls).

export class PropSession {
  private sessions: Set<WebSocket> = new Set()

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    this.sessions.add(server)

    server.addEventListener('message', (event: MessageEvent) => {
      const msg = typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
      for (const s of this.sessions) {
        if (s !== server && s.readyState === WebSocket.READY_STATE_OPEN) s.send(msg)
      }
    })

    server.addEventListener('close', () => {
      this.sessions.delete(server)
    })

    return new Response(null, { status: 101, webSocket: client })
  }
}

// ── Main fetch handler ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-prop-client-id, x-prop-secret, x-prop-source, x-prop-user-id',
        },
      })
    }

    // /status — public, no auth required (Headlo checks this to verify the server is live)
    if (request.method === 'GET' && parts[0] === 'status') {
      return json({ ok: true, version: '0.1.0' })
    }

    // All other routes require service-to-service auth
    if (!isAuthorized(request, env)) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const source = request.headers.get('x-prop-source') ?? 'browser'
    const userId  = request.headers.get('x-prop-user-id') ?? undefined

    // GET /sync — Headlo syncs app slugs for its routing cache
    if (request.method === 'GET' && parts[0] === 'sync') {
      return handleSync(env)
    }

    // GET /v1/data/* — direct table access for all prop tables
    if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'data') {
      const [,, resource, param] = parts
      if (resource === 'def' && !param)         return handleDataDefs(env)
      if (resource === 'def' && param)          return handleDataDef(env, param)
      if (resource === 'app' && !param)         return handleDataApps(env)
      if (resource === 'app' && param)          return handleDataApp(env, param)
      if (resource === 'state' && param)        return handleDataState(env, param)
      if (resource === 'events' && param)       return handleDataEvents(env, param)
      if (resource === 'impl' && param)         return handleDataImpls(env, param)
      if (resource === 'sessions' && param)     return handleDataSessions(env, param)
      if (resource === 'user-state' && param) {
        if (!userId) return json({ error: 'x-prop-user-id required' }, 400)
        return handleDataUserState(env, param, userId)
      }
      return json({ error: 'Not found' }, 404)
    }

    if (parts[0] !== 'v1' || parts[1] !== 'prop' || parts.length < 4) {
      return json({ error: 'Not found' }, 404)
    }

    const [,, defSlug, appSlug, action, sessionId] = parts

    // WebSocket session: GET /v1/prop/:defSlug/:appSlug/session/:sessionId
    if (request.headers.get('Upgrade') === 'websocket' && action === 'session' && sessionId) {
      const id = env.SESSIONS.idFromName(`${defSlug}:${appSlug}:${sessionId}`)
      return env.SESSIONS.get(id).fetch(request)
    }

    if (request.method === 'GET' && !action) {
      return handleGet(env, defSlug, appSlug, userId)
    }

    if (request.method === 'POST' && action) {
      const body = await request.json() as Record<string, unknown>
      return handleAction(env, defSlug, appSlug, action, body, source, userId)
    }

    if (request.method === 'PATCH' && !action) {
      const body = await request.json() as { src?: string; js?: string }
      return handleSave(env, defSlug, appSlug, body)
    }

    return json({ error: 'Method not allowed' }, 405)
  },
}
