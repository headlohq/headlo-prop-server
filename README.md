# Headlo Prop Server SDK

Self-hosted server for the **Headlo PROP** (Platform Reactive Open Protocol). Run your own PROP backend in any Postgres environment — Neon, Supabase, Railway, or your own server. Your data never touches Headlo's infrastructure.

## What is PROP?

PROP is Headlo's Universal Abstraction Layer — a contract-driven programming model for interactive web applications. A **PROP contract** defines what props a component receives, what actions it can fire, and what service dependencies it needs. From one contract definition, Headlo auto-generates Monaco TypeScript types, MCP tools, API docs, and this SQL schema.

The `prop_*.*` schema is the complete data model. It is open source and identical to what Headlo uses internally.

## Quickstart

```bash
git clone https://github.com/headlohq/headlo-prop-server
cd headlo-prop-server
npm install
cp .env.example .env
# Edit .env — set DATABASE_URL to your Postgres connection string
```

**Set up the schema:**

```bash
psql $DATABASE_URL -f sql/tables.sql
```

**Seed the Ask Widget (optional reference implementation):**

```bash
psql $DATABASE_URL -f sql/ask-widget.sql
```

**Start the server:**

```bash
npm start
```

Server runs on `http://localhost:3001` by default.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (Neon, Supabase, Hyperdrive, local) |
| `PORT` | No | Port to listen on (default: `3001`) |
| `OPENAI_API_KEY` | Ask Widget only | OpenAI key for the built-in Ask Widget handler |
| `CORS_ORIGIN` | No | Allowed CORS origin (default: `*`) |
| `HEADLO_PROP_KEY` | No | Headlo API key — lets Headlo sync routing from this server |

**Supported `DATABASE_URL` formats:**

```
# Neon
postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require

# Supabase
postgresql://postgres:pass@db.xxx.supabase.co:5432/postgres

# Cloudflare Hyperdrive
postgresql://user:pass@<hyperdrive-id>.hyperdrive.io:5432/db

# Local
postgresql://localhost:5432/mydb
```

## API

### `GET /status`
Health check.
```json
{ "ok": true, "version": "0.1.0" }
```

### `GET /v1/prop/:defSlug/:appSlug`
Returns config, compiled component JS, and current state for the app. This is what the Headlo host application calls to load a PROP app.

```json
{
  "app_id": "abc123",
  "config": { "widgetConfig": { "name": "My Widget" } },
  "js": "function Component(...) { ... }",
  "state": { "messages": [], "loading": false },
  "contract": { "config_fields": [...], "state_fields": [...], "actions": [...] }
}
```

### `POST /v1/prop/:defSlug/:appSlug/:action`
Fires an action. The server calls the matching handler, updates `prop.state`, logs to `prop.event`, and returns the updated state fields.

```bash
curl -X POST http://localhost:3001/v1/prop/ask-widget/my-widget/onSubmit \
  -H "Content-Type: application/json" \
  -d '{"question": "What is PROP?"}'
```

```json
{ "state": { "messages": [...] }, "messages": [...] }
```

Set `x-prop-source: mcp` or `x-prop-source: api` header to tag the event source in `prop.event`.

### `PATCH /v1/prop/:defSlug/:appSlug`
Save component source and compiled JS from the editor.

```json
{ "src": "function Component(...) { ... }", "js": "..." }
```

## Schema

Six tables in the `prop` schema. All owned by you. No Headlo-specific columns.

| Table | What it stores |
|---|---|
| `prop.def` | PROP contract definitions — `contract` JSONB drives everything |
| `prop.app` | Deployed apps — one row per live PROP instance |
| `prop.code` | Component `src` (editable) + `js` (compiled) |
| `prop.state` | Live state — `state` JSONB + optimistic lock `version` |
| `prop.event` | Action log — browser, MCP, and API calls unified |
| `prop.impl` | Marketplace implementations — many visuals per one contract |

Full schema: [sql/tables.sql](sql/tables.sql)

## Adding your own PROP

1. Insert a row into `prop.def` with your contract and handlers
2. Create a handler file at `handlers/<your-slug>.mjs` that exports a function per action
3. Insert a `prop.app` row for each deployed instance
4. Done — the generic server routes everything automatically

See [sql/ask-widget.sql](sql/ask-widget.sql) and [handlers/ask-widget.mjs](handlers/ask-widget.mjs) as reference.

## Connecting to Headlo

Self-hosting means you own the data. Headlo still provides the visual editor, the marketplace, and the public URLs. To connect:

1. Go to your Headlo dashboard → Settings → Self-host
2. Paste your server URL and your `DATABASE_URL`
3. Headlo verifies the connection and syncs a routing cache from your `prop.app` rows
4. Your DB stays the source of truth — Headlo is just the request router

## Going deeper

| Doc | What it covers |
|---|---|
| [docs/ual.md](docs/ual.md) | The Universal Abstraction Layer — what interfaces exist, their stage, what's missing |
| [docs/service-design.md](docs/service-design.md) | How to design a Service PROP interface — the methodology behind every interface in the UAL |
| [docs/contributing.md](docs/contributing.md) | Three ways to contribute: implement an existing interface, propose a new one, or challenge an existing contract |

## License

MIT — © Headlo Team
