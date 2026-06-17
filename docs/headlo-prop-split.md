# Headlo vs PROP Server — Data Split

This document defines which database tables belong on Headlo's side vs. the PROP server's side, and why. For the call-flow diagrams (who calls whom at runtime), see [route-split.md](route-split.md).

---

## The principle

**Headlo owns: registry + compiler + billing.**
**PROP server owns: execution + storage + serving.**

The split maps directly to data:

- Anything Headlo **defines or enforces** (slugs, service contracts, billing limits, API keys) lives in Headlo's DB.
- Anything the PROP server **stores and serves to the browser** (component bundles, service client stubs) lives in the PROP server's DB.
- Headlo never stores source code or compiled bundles permanently. It compiles transiently and pushes the result to the PROP server via `/sync`.

---

## Table ownership

| Table | Owner | Why |
|---|---|---|
| `prop_dist.def` | Headlo | Headlo CDN hosts all runtime bundles. Route `GET /v1/prop/dist/:slug/:version/bundle` lives only on Headlo. |
| `prop_component.def` | Headlo | Headlo owns the component registry (slug, name, framework, stage). Route `GET /v1/prop/component/:slug/def` lives only on Headlo. |
| `prop_component.app` | **PROP server** | Source, compiled JS, and bundle are stored here after each Monaco save. Headlo discards all three after the `/sync` push. Bundle is served from the PROP server's domain. |
| `prop_service.def` | Headlo | Headlo owns the service contract/registry. Route `GET /v1/prop/service/:slug/:version/manifest` lives only on Headlo. |
| `prop_service.app` | **PROP server** | `client_js` stubs are authored by Headlo but pushed to and served from the PROP server's domain. Route `GET /v1/prop/service/:slug/:version/bundle` lives on the PROP server. |
| `prop_server.api_key` | Headlo | Headlo issues `pk_live_xxx` keys and caches them in KV for validation. PROP servers validate against Headlo's KV, not a local copy. |
| `prop_server.service_subscription` | Headlo | Billing config and limits are enforced by Headlo's billing service. Headlo reads this row on every billing call-home. |
| `prop_server.usage_period` | Headlo | Aggregated MAU/calls/spend per agency per billing month. Written by Headlo on every billing call-home. Enforcement is Headlo's job. |
| `prop_server.mau_touch` | Headlo | Per-user dedup counter that increments `usage_period.mau`. Must be co-located with `usage_period`; both are written atomically by Headlo. |

---

## PROP server tables in detail

### `prop_component.app`

The only table where the data **originates on the PROP server side**.

- **Written by:** Headlo pushes via `POST /v1/prop/component/:slug/sync` after every Monaco save.
- **Read by:** Browser, via `GET /v1/prop/component/:slug/bundle` served directly from the PROP server's domain.
- **Headlo's role:** Compile-only. Headlo runs esbuild in memory, pushes the result, and discards. `component_src`, `component_js`, and `component_bundle` never enter Headlo's DB.
- **Invariant:** Headlo cannot serve component bundles. It holds only the def metadata (slug, framework, stage). If Headlo goes down, already-loaded components keep working.

### `prop_service.app`

Service client stubs live on the PROP server, not Headlo.

- **Written by:** Headlo pushes `client_js` when a service is published or updated (analogous to component sync, no separate route defined yet).
- **Read by:** Browser, via `GET /v1/prop/service/:slug/:version/bundle` served from the PROP server's domain. The stub sets `window.__headlo_service_{slug}_{version}` and routes calls back through the PROP server.
- **Headlo's role:** Authors the stub. Pushes it. Does not serve it at runtime.
- **Invariant:** Service client stubs are versioned (`UNIQUE (slug, version)`). Old stubs stay live forever — old browser consumers keep reading their pinned global.

---

## Headlo tables in detail

### `prop_dist.def`

Versioned runtime bundles (React UMD, Vue, Lit, etc.). Headlo is the CDN. PROP servers never need a local copy — all dist fetches go directly to `api.headlo.com`.

### `prop_component.def`

The component slug registry. Headlo is the authority on whether a slug exists, what framework it uses, and whether it is published. The PROP server never writes here.

### `prop_service.def`

The service concept registry (e.g. `slug='auth'` groups `headlo-auth` and `clerk-auth`). Headlo owns the abstract contract. PROP servers implement against it.

### `prop_server.api_key`

Headlo issues all `pk_live_xxx` keys. The PROP server validates incoming keys by calling Headlo's KV cache (`prop-key:{key}`, 300s TTL). There is no local copy of this table on the PROP server. A revoked key becomes invalid within one TTL window.

### `prop_server.service_subscription`

Which billing model each agency uses, and the limits (`max_mau`, `max_seats`, etc.). Headlo reads this on every billing call-home to decide whether to return `{ ok: true }` or `{ error: 'limit_exceeded' }`. PROP servers never read this directly.

### `prop_server.usage_period` + `prop_server.mau_touch`

Headlo's billing ledger. `mau_touch` deduplicates users per billing month; each new touch increments `usage_period.mau`. Both tables are written atomically by Headlo on every billing call-home. PROP servers never write to either. These tables live in `docker/sql/prop/tables.sql`, not in the PROP server schema.

---

## What "self-hosted" means for this split

In Headlo-managed mode, Headlo runs the entire schema on its own Postgres. In self-hosted mode, the publisher runs their own Postgres with a subset of this schema. The split above still applies:

- The publisher's DB only needs `prop_component.app` and `prop_service.app` — the two tables with data that originates on their side.
- All Headlo-owned tables remain in Headlo's DB. The PROP server reaches Headlo's API for registry lookups, key validation, and billing enforcement.
- The publisher cannot replicate billing enforcement locally — there is no valid `usage_period` without Headlo's billing call-home writing to it.

---

## The invariants that enforce the split

1. **Headlo cannot serve your component or service bundles.** They live in the PROP server's DB, served from the PROP server's domain. Headlo holds only metadata.
2. **Your source code never enters Headlo's DB.** Monaco compiles transiently in memory and pushes the result. Headlo discards immediately after the `/sync` push.
3. **You cannot bypass billing.** Every service action must call home to Headlo's billing route. No valid `publishable_key` = action rejected. The royalty is enforced at the protocol level.
4. **You cannot self-host billing enforcement.** `usage_period` and `mau_touch` live on Headlo. The 30% royalty remittance is triggered by Headlo, not by the PROP server.
