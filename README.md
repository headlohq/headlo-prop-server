# Headlo PROP Server

Self-hosted server for **PROP — Platform Reactive Observable Protocol**. Run your own PROP backend against any Postgres database. Your data never touches Headlo's infrastructure.

## What is PROP?

PROP is Headlo's component platform. A PROP component is a compiled React function component distributed as a native web custom element — drop it onto any page with two script tags, no npm, no bundler, no framework required on the host.

```html
<script src="https://api.headlo.com/prop/embed/react/19"></script>
<script src="https://api.headlo.com/prop/embed/component/headlo-auth-signin"></script>

<headlo-auth-signin label="Sign in"></headlo-auth-signin>
```

The slug in the URL is the custom element tag name. No mapping to learn.

### Why "Observable"

Every PROP component's dependencies — React, libraries, service contracts — are versioned and served by Headlo's edge infrastructure. Every service call goes through Headlo's worker routes. Usage is naturally observable: MAU, per-call, per-render. Publishers set a price; Headlo meters and routes 70% to the publisher's Stripe account automatically.

Self-hosted components (via this server) are not observable by Headlo. The protocol is yours. The platform layer is Headlo's product.

## Versioned, sealed components

A PROP component's def has four runtime fields:

| Field | Purpose |
|---|---|
| `slug` | Identity — URL path and custom element tag name |
| `react_version` | Which Headlo-hosted React bundle to load (`"19"`) |
| `requires.libs` | Additional library versions (`[{ name: "chartjs", version: "4" }]`) |
| `requires.services` | Versioned service client stubs (`[{ slug: "auth", version: "v1" }]`) |

All dependencies are served as version-scoped globals — `window.__headlo_React_19`, `window.__headlo_service_auth_v1` — so multiple versions coexist on the same page without conflict, and the host page's own libraries are never touched.

Breaking changes always create a new version. Old versions stay live forever. A compiled component is permanently stable from the moment it ships.

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
psql $DATABASE_URL -f sql/upgrades.sql
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
| `CORS_ORIGIN` | No | Allowed CORS origin (default: `*`) |
| `PROP_SERVER_KEY` | No | MCP key from [headlo.com/mcp/key](https://headlo.com/mcp/key) — lets Headlo sync routing and authorizes calls to Headlo's managed services |

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

### `GET /v1/prop/component/:slug`
Returns def and compiled component JS for a public component.

```json
{
  "error": null,
  "def": { "slug": "headlo-auth-signin", "react_version": "19", "requires": { "services": [{ "slug": "auth", "version": "v1" }] }, "is_public": true },
  "app": { "component_js": "function Component(...) { ... }", "prop_runtime_version": "abc123" }
}
```

### `GET /v1/prop/service/:slug`
Returns the service def contract for a public service.

### `POST /v1/prop/service/:slug/:version/:action`
Fires a versioned service action. The version is pinned in the client stub URL — the handler for that version never changes after publication.

```bash
curl -X POST http://localhost:3001/v1/prop/service/auth/v1/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "..."}'
```

## Schema

The `prop_component` and `prop_service` schemas. All tables owned by you.

| Table | What it stores |
|---|---|
| `prop_component.def` | Component definitions — `slug`, `react_version`, `requires`, `contract` |
| `prop_component.app` | Deployed component instances — `component_src`, `component_js` |
| `prop_service.def` | Service definitions — contract, action signatures, `contract_tag` |

Full schema: [sql/tables.sql](sql/tables.sql)  
Upgrades: [sql/upgrades.sql](sql/upgrades.sql)

## Adding your own component

1. Insert a row into `prop_component.def` with `slug`, `react_version`, `requires`, `is_public: true`
2. Insert a `prop_component.app` row with your compiled `component_js`
3. Done — components are served at `GET /v1/prop/component/:slug`

## Calling PROP services from your backend

Use your secret key (`hlk_xxx`) to call service actions server-side — bypasses browser Origin checks entirely.

Generate a secret key at **[headlo.com/dashboard/settings](https://headlo.com/dashboard/settings) → PROP Server Secret Key**, then set it in your server environment:

```bash
# .env (server-side only — never in browser code)
PROP_SERVER_KEY=hlk_xxx
```

### Direct REST call

```bash
curl -X POST https://your-prop-server.com/v1/prop/service/auth/v1/me \
  -H "Authorization: Bearer $PROP_SERVER_KEY" \
  -H "Content-Type: application/json"
```

### Node.js / edge runtime

```ts
const res = await fetch('https://your-prop-server.com/v1/prop/service/auth/v1/signin', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.PROP_SERVER_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email: 'user@example.com', password: '...' }),
})
const data = await res.json()
```

### When to use this vs browser `createService`

| | Browser (`createService`) | Backend (secret key) |
|---|---|---|
| Key | `pk_live_xxx` publishable | `hlk_xxx` secret |
| Origin check | Yes — must be in allowlist | No — server-to-server |
| Use case | React components, script embeds | Webhooks, cron jobs, SSR, admin scripts |

---

## Connecting to Headlo

Self-hosting means you own the data and serve your own component definitions. Headlo still provides the visual editor, the public component marketplace, and managed services. To connect:

1. Go to your Headlo dashboard → Settings → Self-host
2. Paste your server URL and set `PROP_SERVER_KEY` in your `.env`
3. Headlo verifies the connection and syncs routing from your component rows
4. Your DB stays the source of truth — Headlo routes requests to your server

---

## Hybrid Model — Self-Host Components, Use Headlo Services

Self-hosting your component definitions does not mean you have to self-host every service your components depend on. Service routing is determined by which embed URL loads the service client stub — not by where the component definition lives.

### How service routing works

A PROP component's `def.requires.services` declares which services it needs. When the component is embedded in a page, a service client stub is loaded per service. That stub is a JS object whose methods call a URL. That URL determines where service calls go.

**Option A — Use Headlo's managed services**

Load the service stubs from Headlo's CDN:

```html
<script src="https://api.headlo.com/prop/embed/react/19"></script>
<script src="https://api.headlo.com/prop/embed/service/auth/v1"></script>
<script src="https://your-prop-server.com/v1/prop/component/my-component"></script>
```

The component definition comes from your server. Service calls (`auth.signIn()`, `auth.me()`) go to headlo-worker at `api.headlo.com`. You get Headlo's managed `headlo-auth`, `clerk-auth`, and `billing` services — the same services any managed PROP customer uses.

Requires `PROP_SERVER_KEY` to be set — Headlo's worker validates that service calls from your origin are authorized.

**Option B — Use your own service handlers**

Load the service stubs from your own server:

```html
<script src="https://api.headlo.com/prop/embed/react/19"></script>
<script src="https://your-prop-server.com/prop/embed/service/auth/v1"></script>
<script src="https://your-prop-server.com/v1/prop/component/my-component"></script>
```

Service calls go to your `headlo-prop-server` at `POST /v1/prop/service/:slug/:version/:action`. You implement the handlers yourself against your own database and auth stack. No Headlo involvement at runtime.

**Option C — Mix**

Use Headlo's managed auth and billing but self-host a custom service:

```html
<script src="https://api.headlo.com/prop/embed/react/19"></script>
<script src="https://api.headlo.com/prop/embed/service/auth/v1"></script>        <!-- Headlo -->
<script src="https://api.headlo.com/prop/embed/service/billing/v1"></script>     <!-- Headlo -->
<script src="https://your-prop-server.com/prop/embed/service/inventory/v1"></script>  <!-- yours -->
<script src="https://your-prop-server.com/v1/prop/component/my-component"></script>
```

### What `PROP_SERVER_KEY` enables

| Without key | With key |
|---|---|
| Self-hosted components only | Self-hosted components + Headlo managed services |
| No Headlo visibility | Headlo syncs component routing from your DB |
| No marketplace distribution | Components appear in Headlo's marketplace |
| No Headlo visual editor | Headlo editor connects to your server |

The key authorizes your self-hosted server to call Headlo's managed service routes. Without it, `api.headlo.com/prop/service/*` rejects requests from your origin.

## License

[Elastic License 2.0](LICENSE) — © Headlo Team

Source available. Free for internal use and self-hosting. You may not offer this software as a competing hosted or managed service. See [LICENSE](LICENSE) for the full terms.
