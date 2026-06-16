#!/usr/bin/env node
import { createServer } from 'node:http'
import { query } from './db.mjs'

const PORT = process.env.PORT || 3001
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const PROP_CLIENT_ID = process.env.PROP_CLIENT_ID
const PROP_SECRET = process.env.PROP_SECRET

if (!PROP_CLIENT_ID || !PROP_SECRET) {
  console.error('PROP_CLIENT_ID and PROP_SECRET are required. See .env.example.')
  process.exit(1)
}

function respond(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-prop-client-id, x-prop-secret',
  })
  res.end(JSON.stringify(body))
}

// Service-to-service auth — validates x-prop-client-id + x-prop-secret headers.
// These are set by Headlo on every request. The values must match what the
// builder registered in the Headlo dashboard and configured in .env.
function isAuthorized(req) {
  return (
    req.headers['x-prop-client-id'] === PROP_CLIENT_ID &&
    req.headers['x-prop-secret'] === PROP_SECRET
  )
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) }
      catch { reject(new Error('Invalid JSON')) }
    })
  })
}

// ── Route handlers ───────────────────────────────────────────

// GET /v1/prop/:defSlug/:appSlug
async function handleGet(res, defSlug, appSlug, userId) {
  const { rows } = await query(`
    SELECT a.app_id, a.config, c.js, s.state, d.contract
    FROM prop.app   a
    JOIN prop.def   d ON d.def_id = a.def_id
    JOIN prop.code  c ON c.app_id = a.app_id
    JOIN prop.state s ON s.app_id = a.app_id
    WHERE d.slug = $1 AND a.slug = $2
  `, [defSlug, appSlug])

  if (!rows.length) return respond(res, 404, { error: 'Not found' })
  const row = rows[0]

  if (userId) {
    const { rows: urows } = await query(`
      SELECT state AS user_state FROM prop.user_state
      WHERE app_id = $1 AND user_id = $2
    `, [row.app_id, userId])
    row.user_state = urows[0]?.user_state ?? {}
  }

  respond(res, 200, row)
}

// POST /v1/prop/:defSlug/:appSlug/:action
async function handleAction(res, defSlug, appSlug, action, args, source = 'browser', userId) {
  const { rows } = await query(`
    SELECT a.app_id, a.config, d.handlers, s.state, s.version
    FROM prop.app   a
    JOIN prop.def   d ON d.def_id = a.def_id
    JOIN prop.state s ON s.app_id = a.app_id
    WHERE d.slug = $1 AND a.slug = $2
  `, [defSlug, appSlug])

  if (!rows.length) return respond(res, 404, { error: 'Not found' })
  const { app_id, config, handlers, state, version } = rows[0]

  let userState = {}, userVersion = 0
  if (userId) {
    const { rows: urows } = await query(`
      SELECT state, version FROM prop.user_state WHERE app_id = $1 AND user_id = $2
    `, [app_id, userId])
    if (urows.length) { userState = urows[0].state; userVersion = urows[0].version }
  }

  const handler = handlers[action]
  if (!handler) return respond(res, 400, { error: `Unknown action: ${action}` })

  let result = {}
  try {
    const mod = await import(`./handlers/${defSlug}.mjs`)
    result = await mod[action]({ args, state, user_state: userState, app_id, user_id: userId, config })
  } catch {
    return respond(res, 500, { error: 'Handler failed' })
  }

  const nextState = { ...state }
  for (const key of handler.updates_state || []) {
    if (key in result) nextState[key] = result[key]
  }

  await query(`
    UPDATE prop.state
    SET state = $1, version = version + 1, updated_at = NOW()
    WHERE app_id = $2 AND version = $3
  `, [JSON.stringify(nextState), app_id, version])

  if (userId && (handler.updates_user_state || []).length > 0) {
    const nextUserState = { ...userState }
    for (const key of handler.updates_user_state) {
      if (key in result) nextUserState[key] = result[key]
    }
    await query(`
      INSERT INTO prop.user_state (app_id, user_id, state, version, updated_at)
      VALUES ($1, $2, $3, 1, NOW())
      ON CONFLICT (app_id, user_id) DO UPDATE
        SET state = $3, version = prop.user_state.version + 1, updated_at = NOW()
        WHERE prop.user_state.version = $4
    `, [app_id, userId, JSON.stringify(nextUserState), userVersion])
  }

  await query(`
    INSERT INTO prop.event (app_id, action, args, result, source)
    VALUES ($1, $2, $3, $4, $5)
  `, [app_id, action, JSON.stringify(args), JSON.stringify(result), source])

  respond(res, 200, { state: nextState, user_state: userId ? userState : undefined, ...result })
}

// PATCH /v1/prop/:defSlug/:appSlug
async function handleSave(res, defSlug, appSlug, body) {
  const { src, js } = body
  const { rows } = await query(`
    SELECT a.app_id FROM prop.app a
    JOIN prop.def d ON d.def_id = a.def_id
    WHERE d.slug = $1 AND a.slug = $2
  `, [defSlug, appSlug])

  if (!rows.length) return respond(res, 404, { error: 'Not found' })
  const { app_id } = rows[0]

  await query(`
    INSERT INTO prop.code (app_id, src, js, updated_at) VALUES ($1, $2, $3, NOW())
    ON CONFLICT (app_id) DO UPDATE SET src = $2, js = $3, updated_at = NOW()
  `, [app_id, src, js])

  respond(res, 200, { ok: true })
}

// ── Data query handlers ──────────────────────────────────────────────────────

async function handleDataDefs(res) {
  const { rows } = await query(`SELECT * FROM prop.def ORDER BY name`)
  respond(res, 200, { defs: rows })
}

async function handleDataDef(res, defSlug) {
  const { rows } = await query(`SELECT * FROM prop.def WHERE slug = $1`, [defSlug])
  if (!rows.length) return respond(res, 404, { error: 'Not found' })
  respond(res, 200, rows[0])
}

async function handleDataApps(res) {
  const { rows } = await query(`
    SELECT a.*, d.slug AS def_slug
    FROM prop.app a JOIN prop.def d ON d.def_id = a.def_id
    ORDER BY a.slug
  `)
  respond(res, 200, { apps: rows })
}

async function handleDataApp(res, appSlug) {
  const { rows } = await query(`
    SELECT a.*, d.slug AS def_slug, s.state, s.version
    FROM prop.app a
    JOIN prop.def d ON d.def_id = a.def_id
    JOIN prop.state s ON s.app_id = a.app_id
    WHERE a.slug = $1
  `, [appSlug])
  if (!rows.length) return respond(res, 404, { error: 'Not found' })
  respond(res, 200, rows[0])
}

async function handleDataState(res, appSlug) {
  const { rows } = await query(`
    SELECT s.* FROM prop.state s
    JOIN prop.app a ON a.app_id = s.app_id
    WHERE a.slug = $1
  `, [appSlug])
  if (!rows.length) return respond(res, 404, { error: 'Not found' })
  respond(res, 200, rows[0])
}

async function handleDataEvents(res, appSlug) {
  const { rows } = await query(`
    SELECT e.* FROM prop.event e
    JOIN prop.app a ON a.app_id = e.app_id
    WHERE a.slug = $1
    ORDER BY e.created_at DESC
  `, [appSlug])
  respond(res, 200, { events: rows })
}

async function handleDataImpls(res, defSlug) {
  const { rows } = await query(`
    SELECT i.* FROM prop.impl i
    JOIN prop.def d ON d.def_id = i.def_id
    WHERE d.slug = $1
  `, [defSlug])
  respond(res, 200, { impls: rows })
}

async function handleDataUserState(res, appSlug, userId) {
  const { rows } = await query(`
    SELECT us.* FROM prop.user_state us
    JOIN prop.app a ON a.app_id = us.app_id
    WHERE a.slug = $1 AND us.user_id = $2
  `, [appSlug, userId])
  if (!rows.length) return respond(res, 200, { state: {}, version: 0 })
  respond(res, 200, rows[0])
}

async function handleDataSessions(res, appSlug) {
  const { rows } = await query(`
    SELECT s.* FROM prop.session s
    JOIN prop.app a ON a.app_id = s.app_id
    WHERE a.slug = $1
    ORDER BY s.created_at DESC
  `, [appSlug])
  respond(res, 200, { sessions: rows })
}

// GET /sync — Headlo calls this to sync prop.app slugs into its routing cache.
// Returns all public slugs and their def_slug so Headlo can route requests.
async function handleSync(res) {
  const { rows } = await query(`
    SELECT a.slug, d.slug AS def_slug
    FROM prop.app a JOIN prop.def d ON d.def_id = a.def_id
  `)
  respond(res, 200, { apps: rows })
}

// GET /v1/prop/status
function handleStatus(res) {
  respond(res, 200, { ok: true, version: '0.1.0' })
}

// ── Router ───────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return respond(res, 204, {})

  // /v1/prop/status is public — used by Headlo to verify the server is reachable
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'prop' && parts[2] === 'status') {
    return handleStatus(res)
  }

  // All other routes require service-to-service auth
  if (!isAuthorized(req)) {
    return respond(res, 401, { error: 'Unauthorized' })
  }

  const source = req.headers['x-prop-source'] || 'browser'
  const userId = req.headers['x-prop-user-id'] || undefined

  try {
    if (req.method === 'GET' && parts[0] === 'sync') {
      return await handleSync(res)
    }

    if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'data') {
      const [,, resource, param] = parts
      if (resource === 'def' && !param)      return await handleDataDefs(res)
      if (resource === 'def' && param)       return await handleDataDef(res, param)
      if (resource === 'app' && !param)      return await handleDataApps(res)
      if (resource === 'app' && param)       return await handleDataApp(res, param)
      if (resource === 'state' && param)     return await handleDataState(res, param)
      if (resource === 'events' && param)    return await handleDataEvents(res, param)
      if (resource === 'impl' && param)      return await handleDataImpls(res, param)
      if (resource === 'sessions' && param)  return await handleDataSessions(res, param)
      if (resource === 'user-state' && param) {
        if (!userId) return respond(res, 400, { error: 'x-prop-user-id required' })
        return await handleDataUserState(res, param, userId)
      }
      return respond(res, 404, { error: 'Not found' })
    }

    if (parts[0] !== 'v1' || parts[1] !== 'prop' || parts.length < 4) {
      return respond(res, 404, { error: 'Not found' })
    }

    const [,, defSlug, appSlug, action] = parts

    if (req.method === 'GET' && !action) return await handleGet(res, defSlug, appSlug, userId)
    if (req.method === 'POST' && action) {
      const body = await readBody(req)
      return await handleAction(res, defSlug, appSlug, action, body, source, userId)
    }
    if (req.method === 'PATCH' && !action) {
      const body = await readBody(req)
      return await handleSave(res, defSlug, appSlug, body)
    }

    respond(res, 405, { error: 'Method not allowed' })
  } catch (err) {
    console.error(err)
    respond(res, 500, { error: 'Internal server error' })
  }
})

server.listen(PORT, () => {
  console.log(`headlo-prop-server running on http://localhost:${PORT}`)
})
