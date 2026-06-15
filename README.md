# Headlo PROP Server

Self-hosted server for **PROP — Platform Reactive Observable Protocol**. Run your own PROP backend against any Postgres database. Your data never touches Headlo's infrastructure.

## What is PROP?

PROP is Headlo's component platform. A PROP component is a compiled React/Vue/Svelte function component distributed as a native web custom element — drop it onto any page with two script tags, no npm, no bundler, no framework required on the host.

```html
<script src="https://api.headlo.com/v1/prop/react/19/bundle"></script>
<script src="https://api.headlo.com/v1/prop/component/headlo-auth-button/bundle"></script>

<headlo-auth-button></headlo-auth-button>
```

The slug in the URL is the custom element tag name. No mapping to learn.

## Schema: def and app

Each PROP type has two layers:

| Layer | Table | What it is |
|---|---|---|
| **def** | `prop_component.def` / `prop_service.def` | Abstract interface — name, slug, framework, visibility |
| **app** | `prop_component.app` / `prop_service.app` | Concrete implementation — compiled code, version, config |

One def can have many apps (e.g. `auth` def → `headlo-auth` app, `clerk-auth` app). Each app has its own slug and is served independently.

## API keys

Two key types, two headers, never confused:

| Header | Value prefix | Where | Purpose |
|---|---|---|---|
| `X-Headlo-Prop-Publishable-Key` | `pk_live_` | Browser / init script | Validates against domain allowlist. Safe to expose. |
| `X-Headlo-Prop-Private-Key` | anything | Server-side only | Bypasses origin check. Never put in browser code. |

### Generating a private key

Generate any secure random string:

```bash
openssl rand -hex 32
```

or with Node:

```bash
node -e "console.log('hlpk_' + require('crypto').randomBytes(32).toString('hex'))"
```

**Headlo-managed worker** — set it as a secret:

```bash
wrangler secret put HEADLO_PROP_PRIVATE_KEY
# paste the value at the prompt
```

For local dev, add to `.dev.vars`:

```
HEADLO_PROP_PRIVATE_KEY=hlpk_your_generated_value
```

**Self-hosted server** — add to `.env`:

```
HEADLO_PROP_PRIVATE_KEY=hlpk_your_generated_value
```

Then in any server-side call, send it as a header alongside the publishable key:

```bash
curl https://api.headlo.com/v1/prop/component/headlo-auth-button \
  -H "X-Headlo-Prop-Publishable-Key: pk_live_xxx" \
  -H "X-Headlo-Prop-Private-Key: hlpk_your_value"
```

The private key bypasses the `allowed_origins` check — useful for server-side rendering, cron jobs, and admin scripts where no browser `Origin` header is present.

### Creating a publishable key

Insert a row into `prop_server.api_key`:

```sql
INSERT INTO prop_server.api_key (agency_id, publishable_key, name, allowed_origins)
VALUES (
  'your_agency_id',
  'pk_live_xxx',          -- generate with: openssl rand -hex 20 | awk '{print "pk_live_"$1}'
  'Production',
  '{"https://yoursite.com", "http://localhost:3000"}'
);
```

`allowed_origins` — leave as `'{}'` to allow all origins (dev mode only).

---

## Quickstart (self-hosted)

```bash
git clone https://github.com/headlohq/headlo-prop-server
cd headlo-prop-server
npm install
cp .env.example .env
# Edit .env — set DATABASE_URL
```

**Set up the schema:**

```bash
psql $DATABASE_URL -f sql/tables-clean-install.sql
```

**Start:**

```bash
npm start
```

Default port: `3001`.

---

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `PORT` | No | Port (default: `3001`) |
| `CORS_ORIGIN` | No | Allowed CORS origin (default: `*`) |
| `HEADLO_PROP_PRIVATE_KEY` | No | Secret key for server-side calls — bypasses origin check |

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

---

## API

### `GET /status`
Health check.
```json
{ "ok": true }
```

### `GET /v1/prop/react/:version/bundle`
React UMD bundle. No auth required. Cached immutably.

```html
<script src="https://api.headlo.com/v1/prop/react/19/bundle"></script>
```

### `GET /v1/prop/component/:slug`
Component JSON — def + compiled JS. Requires `X-Headlo-Prop-Publishable-Key`.

```json
{
  "error": null,
  "def":  { "def_id": "...", "slug": "headlo-auth-button-def", "framework": "react", "name": "Headlo Auth Button", "stage": "published", "owner_id": "headlo" },
  "app":  { "app_id": "...", "slug": "headlo-auth-button", "name": "Headlo Auth Button", "framework_version": "19", "requires": ["service:auth:v1"], "component_js": "..." }
}
```

### `GET /v1/prop/component/:slug/bundle`
Component JS bundle (custom element shell + compiled JS). No auth required — served publicly if `is_public = true`.

### `GET /v1/prop/service/:slug/:version`
Service JSON — def + app metadata. Requires `X-Headlo-Prop-Publishable-Key`.

```json
{
  "error": null,
  "def":  { "def_id": "...", "slug": "auth", "name": "Auth" },
  "app":  { "app_id": "...", "slug": "headlo-auth", "name": "Headlo Auth", "version": "v1", "stage": "published" }
}
```

### `GET /v1/prop/service/:slug/:version/bundle`
Service client stub JS. Sets `window.__headlo_service_{slug}_{version}`. No auth required — served publicly if `is_public = true`.

---

## Schema

Three Postgres schemas. Full DDL: [sql/tables-clean-install.sql](sql/tables-clean-install.sql)

| Table | What it stores |
|---|---|
| `prop_component.def` | Component type definitions |
| `prop_component.app` | Compiled component implementations |
| `prop_service.def` | Service type definitions |
| `prop_service.app` | Versioned service client implementations |
| `prop_server.api_key` | Publishable keys + origin allowlists |
| `prop_server.service_subscription` | Agency × service × billing model |
| `prop_server.usage_period` | Aggregated usage per billing month |
| `prop_server.mau_touch` | Per-user deduplication for MAU counting |

---

## Adding a component

```sql
-- 1. def (the interface)
INSERT INTO prop_component.def (slug, owner_id, name, framework, stage, is_public)
VALUES ('my-button-def', 'your-agency-id', 'My Button', 'react', 'published', true);

-- 2. app (the implementation)
INSERT INTO prop_component.app (def_id, owner_id, slug, name, framework_version, component_js)
VALUES (
  (SELECT def_id FROM prop_component.def WHERE slug = 'my-button-def'),
  'your-agency-id',
  'my-button',
  'My Button',
  '19',
  'export default function MyButton() { return null; }'
);
```

Served at: `GET /v1/prop/component/my-button`

---

## Billing as a service

Billing is a first-class `prop_service.def` with swappable implementations:

| `billing_app_slug` | Model |
|---|---|
| `billing-mau` | Monthly active users |
| `billing-per-seat` | Fixed seat count |
| `billing-per-call` | Per API call |
| `billing-po` | Purchase order / enterprise |

Per-agency billing model is stored in `prop_server.service_subscription.billing_config` (JSONB).

---

## Connecting to Headlo

Self-hosting means you own the data and serve your own definitions. Headlo still provides the visual editor, component marketplace, and managed services.

1. Go to Headlo dashboard → Settings → Self-host
2. Paste your server URL and set `HEADLO_PROP_PRIVATE_KEY` to the same value on both sides
3. Headlo verifies the connection and syncs routing from your component rows
4. Your DB stays the source of truth

---

## License

[Elastic License 2.0](LICENSE) — © Headlo Team

Source available. Free for internal use and self-hosting. You may not offer this software as a competing hosted or managed service.
