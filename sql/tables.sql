-- ============================================================
-- PROP Schema — Platform Reactive Open Protocol
-- ============================================================
-- Open source. Self-hostable. This is the exact schema Headlo
-- uses internally. Run it in your own Postgres to own your data.
--
-- Two schemas, two kinds of PROP:
--
--   prop_component  UI PROPs — component code, live state, per-user state
--   prop_service    Service PROPs — stateless adapters (LLM, auth, realtime, etc.)
--
-- Two hosting modes, one schema:
--   Headlo-managed: Headlo runs this for you (default)
--   Self-hosted:    You run this — your DB is the source of truth.
--                   Register your connection URL with Headlo and
--                   it will sync a routing cache from your DB.
--
-- Source of truth is always the database running this schema.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS prop_component;
CREATE SCHEMA IF NOT EXISTS prop_service;

-- ============================================================
-- prop_component.def — UI PROP definition
-- ============================================================
-- The contract the builder designed. One row per UI PROP type.
--
-- def_id  = stable surrogate PK — FKs reference this so slug
--           can be renamed without cascading updates.
-- slug    = URL-safe identifier used in editor and public paths.
--
-- prop_component.def.contract full shape (PropComponentContract):
-- {
--   "config_fields": [              <- static config (prop_component.app.config)
--     { "name": "display_name", "type": "string", "label": "..." }
--   ],
--   "state_fields": [               <- global live state (prop_component.state)
--     { "name": "messages", "type": "ChatMessage[]", "default": [] }
--   ],
--   "user_state_fields": [          <- per-user live state (prop_component.user_state)
--     { "name": "best_time", "type": "number" }
--   ],
--   "actions": [                    <- mutations the component can fire
--     { "name": "onSubmit", "args": { "question": "string" } }
--   ],
--   "requires": {                   <- PROP dependencies declared by the component
--     "props": [
--       { "prop_type": "service",   "def_slug": "realtime-session-cf" },
--       { "prop_type": "service",   "def_slug": "auth-clerk" },
--       { "prop_type": "component", "def_slug": "date-picker" }
--     ],
--     "external": [
--       { "url": "https://api.polygon.io/v2", "env_var": "POLYGON_API_KEY" }
--     ],
--     "mcp": [
--       { "tool": "search_knowledge" }
--     ],
--     "auto": true
--   },
--   "routes": [                     <- multi-page PROPs (optional)
--     { "path": "/",                "component": "Lobby" },
--     { "path": "/race/:sessionId", "component": "Race"  }
--   ]
-- }
--
-- Component types (ChatMessage, PlayerState, etc.) live in
-- prop_component.app.component_types_src — raw TypeScript the
-- builder edits in Monaco, injected as a virtual .d.ts at runtime.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.def (
  def_id            TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  slug              TEXT NOT NULL UNIQUE,
  prop_type         TEXT NOT NULL DEFAULT 'component',
  owner_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  stage             TEXT NOT NULL DEFAULT 'draft',
  contract          JSONB NOT NULL DEFAULT '{}',
  contract_version  TEXT,
  requires          JSONB NOT NULL DEFAULT '{}',
  public_path       TEXT NOT NULL,
  is_public         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_component.app — deployed UI PROP instance
-- ============================================================
-- One row per live component app. Holds config values and all
-- component code. Separated from def so code is independently
-- portable and can live in the builder's own Postgres.
--
-- component_src        = TypeScript/JSX the builder edits in Monaco
-- component_types_src  = TypeScript .d.ts the builder edits in Monaco
--                        injected as virtual file — no import needed
-- component_js         = compiled output (loaded by useCompCache)
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.app (
  app_id               TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  def_id               TEXT NOT NULL CONSTRAINT fk_component_app_def REFERENCES prop_component.def(def_id),
  owner_id             TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  config               JSONB NOT NULL DEFAULT '{}',
  component_src        TEXT,
  component_types_src  TEXT,
  component_js         TEXT,
  prop_runtime_version TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_component.state — global live state
-- ============================================================
-- Current values of all state_fields. Written by action handlers.
-- version = optimistic lock — incremented on every write.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.state (
  app_id     TEXT PRIMARY KEY CONSTRAINT fk_component_state_app REFERENCES prop_component.app(app_id),
  fields     JSONB NOT NULL DEFAULT '{}',
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_component.user_state — per-user state partition
-- ============================================================
-- Values of user_state_fields scoped to a single user:
-- scores, progress, preferences, inventory.
-- Keyed by (app_id, user_id).
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.user_state (
  app_id     TEXT NOT NULL CONSTRAINT fk_component_user_state_app REFERENCES prop_component.app(app_id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  fields     JSONB NOT NULL DEFAULT '{}',
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

-- ============================================================
-- prop_component.event — action event log
-- ============================================================
-- Every action fired: browser component or direct API call.
-- Audit trail, analytics, replay, debugging.
-- source: 'browser' | 'api'
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.event (
  event_id      TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  app_id        TEXT NOT NULL CONSTRAINT fk_component_event_app REFERENCES prop_component.app(app_id),
  action        TEXT NOT NULL,
  action_args   JSONB NOT NULL DEFAULT '{}',
  action_result JSONB,
  source        TEXT NOT NULL DEFAULT 'browser',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT component_event_source_values CHECK (source IN ('browser', 'api'))
);

-- ============================================================
-- prop_component.session — real-time session record
-- ============================================================
-- Written when a Durable Object session starts and ends.
-- metadata holds session context: ticker, player list, result.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.session (
  session_id  TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  app_id      TEXT NOT NULL CONSTRAINT fk_component_session_app REFERENCES prop_component.app(app_id) ON DELETE CASCADE,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  ended_at    TIMESTAMPTZ
);

-- ============================================================
-- prop_component.impl — marketplace alternative implementations
-- ============================================================
-- One def can have many visual implementations. Builders publish
-- alternative components that any app can adopt.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.impl (
  impl_id        TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  def_id         TEXT NOT NULL CONSTRAINT fk_component_impl_def REFERENCES prop_component.def(def_id),
  owner_id       TEXT NOT NULL,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  component_src  TEXT NOT NULL,
  component_js   TEXT NOT NULL,
  is_published   BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_service.def — service PROP definition
-- ============================================================
-- The interface contract for a swappable service.
-- Multiple prop_service.app rows implement the same def.
-- Swap the app slug — component code changes nothing.
--
-- prop_service.def.contract full shape (PropServiceDefContract):
-- {
--   "config_fields": [              <- static config per implementation
--     { "name": "provider", "type": "string", "label": "..." }
--   ],
--   "actions": [                    <- actions callers can invoke
--     { "name": "join",  "args": { "roomId": "string" }, "returns": "SessionHandle" },
--     { "name": "leave", "args": { "roomId": "string" }, "returns": { "ok": "boolean" } }
--   ],
--   "service_types": {              <- complex return types; code-gen'd for callers
--     "SessionHandle": {
--       "kind": "interface",
--       "methods": { ... },
--       "properties": { "id": "string" }
--     }
--   }
-- }
--
-- handlers declares side effects per action (for state routing):
-- { "join": { "updates_state": [] }, "leave": { "updates_state": [] } }
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_service.def (
  def_id            TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  slug              TEXT NOT NULL UNIQUE,
  prop_type         TEXT NOT NULL DEFAULT 'service',
  owner_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  stage             TEXT NOT NULL DEFAULT 'draft',
  contract          JSONB NOT NULL DEFAULT '{}',
  contract_version  TEXT,
  handlers          JSONB NOT NULL DEFAULT '{}',
  public_path       TEXT NOT NULL,
  is_public         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- Column type annotations
-- ============================================================

COMMENT ON COLUMN prop_component.def.contract              IS 'Type: PropComponentDefContract — config_fields, state_fields, user_state_fields, actions, routes. Versioned by contract_version.';
COMMENT ON COLUMN prop_component.def.contract_version      IS 'sha256(JSON.stringify(contract)) — auto-updated on save; drives prop_runtime_version recompile check. Does NOT change on requires updates.';
COMMENT ON COLUMN prop_component.def.requires              IS 'Type: PropRequires — props (PropRef[]), external (PropHttpRef[]), mcp (PropMcpTool[]). Top-level so changing a PropRef def_slug does not bump contract_version.';
COMMENT ON COLUMN prop_component.app.config                IS 'Type: PropComponentAppConfigIntent — keys match contract.config_fields[n].name, validated at save time';
COMMENT ON COLUMN prop_component.app.component_types_src   IS 'Raw TypeScript .d.ts edited in Monaco — injected as virtual file at runtime';
COMMENT ON COLUMN prop_component.app.prop_runtime_version  IS 'PROP runtime version when component_js was compiled (e.g. 1.0) — injected props contract; recompile if mismatch';
COMMENT ON COLUMN prop_component.state.fields              IS 'Type: PropComponentStateFields — live field data matching contract.state_fields names';
COMMENT ON COLUMN prop_component.user_state.fields         IS 'Type: PropComponentUserStateFields — per-user field data matching contract.user_state_fields names';
COMMENT ON COLUMN prop_component.event.action_args         IS 'Type: PropComponentEventActionArgs — matches contract.actions[n].args';
COMMENT ON COLUMN prop_component.event.action_result       IS 'Type: PropComponentEventActionResult — matches contract.actions[n].returns';
COMMENT ON COLUMN prop_component.session.metadata          IS 'Type: PropComponentSessionMetadata — session context (players, result, ticker)';
COMMENT ON COLUMN prop_service.def.contract                IS 'Type: PropServiceDefContract — see interfaces/types.ts';
COMMENT ON COLUMN prop_service.def.contract_version        IS 'sha256(JSON.stringify(contract)) — auto-updated on save; compared against dep_versions in component apps to detect stale service types';
COMMENT ON COLUMN prop_service.def.handlers                IS 'Type: PropServiceDefHandlers — { [actionName]: { updates_state?: string[] } }';

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_component_def_slug         ON prop_component.def(slug);
CREATE INDEX IF NOT EXISTS idx_component_def_owner        ON prop_component.def(owner_id);
CREATE INDEX IF NOT EXISTS idx_component_app_def          ON prop_component.app(def_id);
CREATE INDEX IF NOT EXISTS idx_component_app_owner        ON prop_component.app(owner_id);
CREATE INDEX IF NOT EXISTS idx_component_event_app_time   ON prop_component.event(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_component_impl_def_public  ON prop_component.impl(def_id, is_published);
CREATE INDEX IF NOT EXISTS idx_component_user_state_app   ON prop_component.user_state(app_id);
CREATE INDEX IF NOT EXISTS idx_component_session_app_time ON prop_component.session(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_def_slug           ON prop_service.def(slug);
CREATE INDEX IF NOT EXISTS idx_service_def_owner          ON prop_service.def(owner_id);
