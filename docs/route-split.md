# Route Split — Headlo vs your PROP server

**Headlo owns: registry + compiler + billing.**  
**You own: execution + storage + serving.**

Neither side can cut the other out. That's the design.

---

## How it works — full call diagram

Three distinct flows. Each arrow shows who initiates the call.

### 1. Author saves a component (Monaco → compile → your server)

```
┌─────────────────────────────────────────────────────────────────┐
│  Headlo Dashboard                                               │
│  Monaco Editor (hosted by Headlo)                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │  POST /v1/studio/prop/component/:slug/save
                           │  { src: "/* your TSX */" }
                           ▼
              ┌────────────────────────┐
              │  api.headlo.com        │
              │  headlo-worker         │
              │                        │
              │  compile(src)          │  ← esbuild + CE wrapper
              │  → { js, bundle }      │    runs in memory, never stored
              └──────────┬─────────────┘
                         │  POST /v1/prop/component/:slug/sync
                         │  { component_src, component_js, component_bundle }
                         │  X-Headlo-Prop-Publishable-Key: pk_live_xxx
                         ▼
              ┌────────────────────────┐
              │  prop.acme.com         │
              │  Your PROP server      │
              │                        │
              │  validate pk_live_xxx  │
              │  store in              │
              │  prop_component.app    │
              └────────────────────────┘
                  ↑ your DB, your data
                  Headlo discards src/js/bundle immediately after push
```

---

### 2. Browser loads a component (page load)

```
                    Browser
                       │
         ┌─────────────┼──────────────────┐
         │             │                  │
         ▼             ▼                  ▼
  api.headlo.com  api.headlo.com    prop.acme.com
  GET /v1/prop/   GET /v1/prop/     GET /v1/prop/
  dist/react/     component/        component/
  19/bundle       :slug/def         :slug/bundle
                                         │
  React UMD       slug metadata     component_bundle
  (Headlo CDN,    (name, framework, (from your DB,
  1yr cache)      stage — no code)  your domain)
         │             │                  │
         └─────────────┴──────────────────┘
                       │
                 browser registers
                 <your-component>
                 as a custom element
                 ✓ renders
```

The SDK runs these three fetches. React and the def are always fetched from Headlo.
The actual bundle — the code — is always fetched from your server.

---

### 3. User triggers a service action (runtime)

```
                    Browser
                       │
                       │  calls SDK / custom element action
                       ▼
              ┌────────────────────────┐
              │  prop.acme.com         │
              │  Your PROP server      │
              │                        │
              │  validate user         │
              │  read your DB          │
              │  run your logic        │
              └──────────┬─────────────┘
                         │  POST api.headlo.com/v1/prop/
                         │       service/billing-mau/v1/call
                         │  { action: 'recordUsage', user_id }
                         │  X-Headlo-Prop-Publishable-Key: pk_live_xxx
                         ▼
              ┌────────────────────────┐
              │  api.headlo.com        │
              │  Billing PROP service  │
              │                        │
              │  check limit           │
              │  record usage          │
              │  enforce royalty       │
              └──────────┬─────────────┘
                         │  { ok: true } or { error: 'limit_exceeded' }
                         ▼
              ┌────────────────────────┐
              │  prop.acme.com         │
              │  Your PROP server      │
              │  returns result        │
              │  (or 402 if exceeded)  │
              └──────────┬─────────────┘
                         │
                         ▼
                       Browser
                  receives response
```

Your server does all the work. Headlo only sees the billing ping —
never the user's data, never the action args, never the result.

---

---

## Routes that only live on Headlo

You never implement these. Headlo is the sole authority.

| Route | What it does |
|---|---|
| `GET /v1/prop/dist/:runtime/:version/bundle` | Shared runtime (React UMD). Served from Headlo CDN. Immutable — 1-year browser cache. |
| `GET /v1/prop/component/:slug/def` | Slug registry lookup. Headlo owns the def (name, framework, stage). Not the bundle. |
| `GET /v1/prop/service/:slug/:version/manifest` | Service registry lookup. Headlo owns the contract. |
| `POST /v1/prop/service/billing-xxx/v1/call` | Billing call-home. Your PROP server calls this on every action. No valid `publishable_key` = action rejected. Royalty is structurally guaranteed. |
| `POST /v1/studio/prop/component/:slug/save` | Monaco save → Headlo compiles transiently → pushes to your server via `/sync` → Headlo discards. Your source never enters Headlo's DB. |

---

## Routes Headlo calls on your server

Headlo initiates these. You must implement them.

| Route | What it does |
|---|---|
| `POST /v1/prop/component/:slug/sync` | Headlo pushes compiled output after every Monaco save. Body: `{ component_src, component_js, component_bundle }`. Authenticated via `X-Headlo-Prop-Publishable-Key`. You store all three; Headlo discards. |
| `POST /v1/prop/service/:slug/:version/call` | Service action routed to your server (CAP experts, LLM, custom logic). You read your own DB and return the result. Billing call-home to Headlo happens inside this handler. |
| `GET /status` | Health check. Headlo calls this at registration and periodically to verify your server is live. |
| `GET /sync` | Slug sync. Headlo fetches the list of component slugs your server can serve bundles for, and updates its routing cache. |

---

## Routes your server serves to the browser

The SDK calls these directly. Headlo is not in the loop at runtime.

| Route | What it does |
|---|---|
| `GET /v1/prop/component/:slug/bundle` | Serves `component_bundle` from your DB. Browser fetches this directly from your domain. |
| `GET /v1/prop/service/:slug/:version/bundle` | Serves service client stub JS from your DB. Sets `window.__headlo_service_{slug}_{version}` in the browser. |

---

## Why this split works

**You cannot bypass billing.**  
Every service action your server handles must call back to Headlo's billing route with your `publishable_key`. No valid key = action rejected. The royalty is enforced at the protocol level, not by trust.

**Headlo cannot hold your code hostage.**  
Source, compiled JS, and all runtime data live on your server. You can migrate or stop at any time. Nothing you care about is locked in Headlo's infrastructure.

**Headlo cannot serve your component bundles.**  
`component_bundle` lives in your DB and is served from your domain. Headlo holds only the def metadata (slug, framework, stage) — not the code.

**Your source code never touches Headlo's DB.**  
Monaco compiles your code transiently in memory, pushes the result to your `/sync` endpoint, and discards everything. Headlo is a compile server, not a code host.

---

## The `/sync` push in detail

```
You write code in Monaco (Headlo-hosted editor)
  → on save:
      Headlo compiles in memory (esbuild + custom element wrapper)
      POST https://prop.acme.com/v1/prop/component/:slug/sync
      {
        component_src:    "/* your TypeScript/JSX */",
        component_js:     "/* compiled output */",
        component_bundle: "/* custom element shell + compiled JS */"
      }
      X-Headlo-Prop-Publishable-Key: pk_live_xxx
  → Your server validates the key against prop_server.api_key
  → Your server stores all three in prop_component.app
  → Headlo discards — stateless from this point
```

Validate the `X-Headlo-Prop-Publishable-Key` header before accepting any `/sync` push.
An unauthenticated `/sync` endpoint would let anyone overwrite your component bundles.

---

## The billing call-home in detail

```
Browser calls your service (e.g. CAP expert query)
  POST https://prop.acme.com/v1/prop/service/ask/v1/call
  → Your server: validate user, read from your DB
  → Your server: POST https://api.headlo.com/v1/prop/service/billing-mau/v1/call
        X-Headlo-Prop-Publishable-Key: pk_live_xxx
        { action: 'recordUsage', args: { user_id, service_slug } }
      ← { ok: true } or { error: 'limit_exceeded' }
  → If limit_exceeded: your server returns 402 to the browser
  → If ok: your server returns the result
```

Headlo's billing service checks your `registered_server` row, applies your billing model
(`billing-mau`, `billing-per-seat`, `billing-po`), and tracks usage. The 30% royalty is
remitted automatically from your billing config.
