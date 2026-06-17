# Headlo PROP Server

**PROP — Platform Reactive Observable Protocol.** Ship React components as native web custom elements — no npm, no bundler, no framework required on the host page.

```html
<!-- Two script tags. Any site. Done. -->
<script src="https://prop.acme.com/v1/prop/dist/react/19/bundle"></script>
<script src="https://prop.acme.com/v1/prop/component/headlo-auth-button/bundle"></script>

<headlo-auth-button></headlo-auth-button>
```

Or use the SDK:

```ts
import { createService } from 'headlo'

const prop = createService({ publishableKey: 'pk_live_xxx', url: 'https://prop.acme.com' })
await prop.component('headlo-auth-button').load()
// <headlo-auth-button> is now registered and ready
```

---

## How it works

**[docs/route-split.md](docs/route-split.md)** — full breakdown of which routes live on Headlo, which routes Headlo calls on your server, and which routes your server serves directly to the browser. Includes call diagrams for all three flows: author saves a component, browser loads a component, user triggers a service action.

---

## Three deployment modes

| Mode | Folder | Data lives in | HYPERDRIVE binding |
|---|---|---|---|
| **Proxy** | `prop-worker/` (CF Worker) | Headlo's DB | not needed |
| **Self-hosted — Cloudflare** | `prop-worker/` (CF Worker + Hyperdrive) | Your Postgres / MySQL | required |
| **Self-hosted — Node.js** | `prop-node/` (Node 18+ HTTP server) | Your Postgres / MySQL / SQL Server | n/a |

The worker detects the mode automatically: if `HYPERDRIVE` is bound it handles four routes locally; if not, it proxies all requests to Headlo. Start with proxy. Add Hyperdrive later for data sovereignty — your SDK config and page code don't change.

---

## Proxy mode (recommended start)

Deploy the Cloudflare Worker in `prop-worker/` **without** a Hyperdrive binding. Every request is forwarded to `api.headlo.com` with your publishable key. You get a branded domain; Headlo manages all the data.

**1. Configure `prop-worker/wrangler.jsonc`**

- Set `name` to something like `acme-prop-worker`
- Remove (or leave blank) the `hyperdrive` block — it is not needed for proxy mode
- Set your production domain in the `routes` under `env.production`

**2. Deploy**

```bash
cd prop-worker
npm install
wrangler deploy --env production
```

**3. Set your publishable key**

Get `pk_live_xxx` from the [Headlo dashboard](https://headlo.com/dashboard/settings) → API Keys.

```bash
wrangler secret put HEADLO_PUBLISHABLE_KEY --env production
# paste pk_live_xxx at the prompt
```

**4. Point a custom domain**

In the Cloudflare dashboard → Workers → your worker → Triggers → add `prop.acme.com`.

**5. Use it**

```ts
const prop = createService({
  publishableKey: 'pk_live_xxx',
  url: 'https://prop.acme.com',
})
```

All requests now go through your branded domain. Add Hyperdrive later to go self-hosted — just change `url` in your `createService` call.

**Optional — dev environment**

```bash
wrangler secret put HEADLO_ORIGIN --env development  # https://api-dev.headlo.com
```

---

## Self-hosted — Cloudflare Worker + Hyperdrive

Same `prop-worker/` folder, but with a Hyperdrive binding pointing at your own Postgres or MySQL. Headlo syncs compiled component bundles into your DB; your worker serves them directly from your DB.

Hyperdrive supports: **Postgres, Neon, Supabase, CockroachDB, RDS, MySQL, PlanetScale.**

**1. Run the schema**

```bash
psql $DATABASE_URL -f sql/tables.sql
```

**2. Create a Hyperdrive config**

```bash
wrangler hyperdrive create acme-prop-db \
  --connection-string "postgresql://user:pass@your-host:5432/prop"
```

Copy the Hyperdrive ID from the output.

**3. Configure `prop-worker/wrangler.jsonc`**

Paste the Hyperdrive ID into the `hyperdrive[].id` field under `env.production` (and `env.development` if using staging). Full template is in the file.

**4. Deploy**

```bash
cd prop-worker
wrangler deploy --env production
```

**5. Set your publishable key**

```bash
wrangler secret put HEADLO_PUBLISHABLE_KEY --env production
```

**5. Lock down your DB firewall**

Hyperdrive connects from Cloudflare's network to your DB on port 5432. Restrict that port to Cloudflare IPs and your personal IP only.

> **Cloudflare IP ranges** (verify current list at https://www.cloudflare.com/ips/):
> ```
> IPv4: 173.245.48.0/20  103.21.244.0/22  103.22.200.0/22  103.31.4.0/22
>       141.101.64.0/18  108.162.192.0/18  190.93.240.0/20  188.114.96.0/20
>       197.234.240.0/22  198.41.128.0/17  162.158.0.0/15  104.16.0.0/13
>       104.24.0.0/14  172.64.0.0/13  131.0.72.0/22
> IPv6: 2400:cb00::/32  2606:4700::/32  2803:f800::/32  2405:b500::/32
>       2405:8100::/32  2a06:98c0::/29  2c0f:f248::/32
> ```

---

**Ionos (my.ionos.com) — no SSH needed**

1. Log in → **Server & Cloud** → select your server
2. **Network** tab → **Firewall Policies** → **Add Rule**
3. For each CF IP range above, add a rule:
   - Direction: **Inbound** · Protocol: **TCP** · Port: **5432** · Source IP: *(paste one range)*
4. Add one more rule for your personal IP (`curl ifconfig.me` to find it)
5. Add a final rule: Direction: Inbound · Protocol: TCP · Port: 5432 · Source: **0.0.0.0/0** · Action: **DENY**
6. Apply the policy to your server

---

**AWS — EC2 Security Groups**

1. EC2 → **Security Groups** → select the group attached to your instance
2. **Inbound rules** → **Edit inbound rules** → **Add rule**
3. For each CF IP range:
   - Type: **Custom TCP** · Port: **5432** · Source: **Custom** · *(paste CIDR)*
4. Add one rule for your personal IP
5. **Save rules** — any IP not listed is implicitly denied

---

**Google Cloud — VPC Firewall**

1. **VPC Network** → **Firewall** → **Create firewall rule**
2. Set: Direction: **Ingress** · Action: **Allow** · Targets: your instance tag or all
3. Protocols and ports: **TCP** · **5432**
4. Source IPv4 ranges: paste all CF IPv4 ranges comma-separated
5. Create a second rule for your personal IP
6. Create a **deny-all** rule for port 5432 with lower priority (higher number = lower priority) and source `0.0.0.0/0`

---

**Azure — Network Security Group (NSG)**

1. Your VM → **Networking** → **Inbound port rules** → **Add inbound port rule**
2. For each CF range:
   - Source: **IP Addresses** · Source IP: *(paste range)* · Protocol: **TCP** · Port: **5432** · Action: **Allow** · Priority: **100–199**
3. Add a rule for your personal IP at priority **200**
4. Add a final rule: Source: **Any** · Port: **5432** · Action: **Deny** · Priority: **300**

---

**DigitalOcean — Cloud Firewall**

1. **Networking** → **Firewalls** → **Create Firewall** (or edit existing)
2. **Inbound Rules** → **Add rule**:
   - Protocol: **TCP** · Port: **5432** · Sources: paste each CF range as a custom CIDR
3. Add your personal IP as a source on the same rule or a separate rule
4. Apply the firewall to your Droplet
5. DigitalOcean drops all traffic not matching an inbound rule by default — no explicit deny needed

---

**Hetzner — Firewall**

1. **Firewalls** → **Create Firewall** (or edit existing)
2. **Add Rule** → Direction: **Inbound** · Protocol: **TCP** · Port: **5432**
3. Source IPs: paste all CF IPv4 ranges (one per line or comma-separated)
4. Add a second inbound rule for your personal IP
5. **Apply to servers** → select your server
6. Hetzner drops everything not explicitly allowed — no deny rule needed

---

**Linux VPS (any provider) — ufw**

```bash
curl ifconfig.me   # find your personal IP first

ufw allow from YOUR.PERSONAL.IP to any port 5432

# CF IPv4
ufw allow from 173.245.48.0/20  to any port 5432
ufw allow from 103.21.244.0/22  to any port 5432
ufw allow from 103.22.200.0/22  to any port 5432
ufw allow from 103.31.4.0/22    to any port 5432
ufw allow from 141.101.64.0/18  to any port 5432
ufw allow from 108.162.192.0/18 to any port 5432
ufw allow from 190.93.240.0/20  to any port 5432
ufw allow from 188.114.96.0/20  to any port 5432
ufw allow from 197.234.240.0/22 to any port 5432
ufw allow from 198.41.128.0/17  to any port 5432
ufw allow from 162.158.0.0/15   to any port 5432
ufw allow from 104.16.0.0/13    to any port 5432
ufw allow from 104.24.0.0/14    to any port 5432
ufw allow from 172.64.0.0/13    to any port 5432
ufw allow from 131.0.72.0/22    to any port 5432

# CF IPv6
ufw allow from 2400:cb00::/32   to any port 5432
ufw allow from 2606:4700::/32   to any port 5432
ufw allow from 2803:f800::/32   to any port 5432
ufw allow from 2405:b500::/32   to any port 5432
ufw allow from 2405:8100::/32   to any port 5432
ufw allow from 2a06:98c0::/29   to any port 5432
ufw allow from 2c0f:f248::/32   to any port 5432

ufw deny 5432
ufw reload
```

---

## Self-hosted — Node.js

Use `prop-node/` if you're not on Cloudflare. Requires **Node.js 18+** (built-in `fetch` used for proxying). Supports Postgres, MySQL, and SQL Server.

**1. Install**

```bash
cd prop-node
npm install
cp .env.example .env
```

**2. Configure `.env`**

```env
DATABASE_URL=postgres://user:pass@localhost:5432/prop
HEADLO_PUBLISHABLE_KEY=pk_live_xxx
PORT=3000
```

Get `pk_live_xxx` from the [Headlo dashboard](https://headlo.com/dashboard/settings) → API Keys.

**3. Run the schema**

```bash
psql $DATABASE_URL -f ../sql/tables.sql
```

**4. Build and start**

```bash
npm run build   # compiles TypeScript → dist/
npm start       # node dist/index.js
```

For development with live reload on TypeScript source changes:

```bash
npm run dev     # tsx watch src/index.ts — reloads on any .ts change, no build step needed
```

**5. Switch to SQL Server**

In `src/index.ts`, swap the one import line:

```ts
// Before (Postgres / MySQL)
import { PostgresDB } from './db-pg.js'
const db: PropDB = new PostgresDB(DATABASE_URL)

// After (SQL Server)
import { MssqlDB } from './db-mssql.js'
const db: PropDB = new MssqlDB(DATABASE_URL)
```

SQL Server `DATABASE_URL` format:
```
Server=tcp:myserver.database.windows.net,1433;Database=prop;User Id=myuser;Password=mypass;Encrypt=true;
```

**6. Register with Headlo**

1. Go to **[headlo.com/dashboard/settings](https://headlo.com/dashboard/settings)**
2. Under **PROP Server** — paste `https://prop.acme.com`
3. Headlo sends a verification request to `/v1/prop/status`, then syncs your component rows into its routing cache
4. Your DB stays the source of truth

**Environment variables**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Postgres / MySQL / SQL Server connection string |
| `HEADLO_PUBLISHABLE_KEY` | Yes | — | `pk_live_xxx` from Headlo dashboard |
| `HEADLO_ORIGIN` | No | `https://api.headlo.com` | Override Headlo API origin |
| `PORT` | No | `3000` | HTTP listen port |

**Supported `DATABASE_URL` formats**

```
# Neon
postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require

# Supabase
postgresql://postgres:pass@db.xxx.supabase.co:5432/postgres

# RDS / self-hosted Postgres
postgresql://user:pass@your-host:5432/prop

# Local
postgresql://localhost:5432/prop

# SQL Server
Server=tcp:myserver.database.windows.net,1433;Database=prop;User Id=myuser;Password=mypass;Encrypt=true;
```

---

## API keys

Two key types, two headers, never confused:

| Header | Prefix | Where used | Purpose |
|---|---|---|---|
| `X-Headlo-Prop-Publishable-Key` | `pk_live_` | Browser / init script | Validated by Headlo. Safe to expose. |
| `X-Headlo-Prop-Secret` | `sk_` | Server-side only | Bypasses origin check. Never put in browser code. |

---

## API reference

### `GET /v1/prop/status`
Health check — public, no auth.
```json
{ "ok": true, "mode": "self-hosted", "version": "1.0.0" }
```
`mode` values: `"proxy"` (prop-worker, no Hyperdrive), `"self-hosted"` (prop-worker + Hyperdrive), `"node"` (prop-node).

### `GET /v1/prop/dist/:runtime/:version/bundle`
Shared runtime bundle (React UMD). No auth required. Proxied to Headlo.
```
/v1/prop/dist/react/19/bundle
```

### `GET /v1/prop/component/:slug/def`
Component definition JSON. Requires `X-Headlo-Prop-Publishable-Key`. Proxied to Headlo.
```json
{
  "def_id": "...", "slug": "headlo-auth-button", "framework": "react",
  "react_version": "19", "stage": "published", "is_public": true
}
```

### `GET /v1/prop/component/:slug/bundle`
Compiled custom element bundle. Served from **your DB** — never proxied.

### `POST /v1/prop/component/:slug/sync`
Headlo pushes compiled code here after each build. Requires `X-Headlo-Prop-Publishable-Key`. Handled locally, not proxied.

### `GET /v1/prop/service/:slug/:version/manifest`
Service metadata. Requires `X-Headlo-Prop-Publishable-Key`. Proxied to Headlo.

### `GET /v1/prop/service/:slug/:version/bundle`
Service client stub JS. Proxied to Headlo.

### `GET /v1/prop/sync`
Returns all component slugs — used by Headlo to build its routing cache. Handled locally.

---

## Schema

Full DDL: [sql/tables.sql](sql/tables.sql)

**Your DB (publisher side)** — `sql/tables.sql`

| Table | What it stores |
|---|---|
| `prop_component.app` | Component source, compiled JS, and bundle — pushed here by Headlo via `/v1/prop/component/:slug/sync`, served to browser from your domain |
| `prop_service.app` | Service client stubs — pushed here by Headlo, served to browser from your domain |

**Headlo's DB** — registry, billing, keys. You never write to these.

| Table | What it stores |
|---|---|
| `prop_component.def` | Component registry (slug, framework, stage) |
| `prop_service.def` | Service registry |
| `prop_server.api_key` | Publishable keys + origin allowlists |
| `prop_server.service_subscription` | Agency × service × billing model |
| `prop_server.usage_period` | Aggregated usage per billing month |
| `prop_server.mau_touch` | Per-user dedup for MAU counting |

See [docs/headlo-prop-split.md](docs/headlo-prop-split.md) for the full ownership breakdown.

---

## Billing

Billing is a first-class PROP service with swappable implementations:

| `billing_app_slug` | Model |
|---|---|
| `billing-mau` | Monthly active users |
| `billing-per-seat` | Fixed seat count |
| `billing-per-call` | Per API call |
| `billing-po` | Purchase order / enterprise |

Per-agency billing model is stored in `prop_server.service_subscription.billing_config` (JSONB).

---

## License

[Elastic License 2.0](LICENSE) — © Headlo Team

Source available. Free for internal use and self-hosting. You may not offer this software as a competing hosted or managed service.
