-- ============================================================
-- PROP Schema — Clean Install
-- Platform Reactive Observable Protocol
-- ============================================================
-- Run this on a fresh Postgres to get the full schema.
-- Do NOT run upgrades.sql after this — everything is already
-- incorporated here. upgrades.sql is only for existing installs.
--
-- Schemas:
--   prop_component  UI PROPs — component code delivered as custom elements
--   prop_service    Service PROPs — versioned browser stubs (auth, billing, llm…)
--   prop_server     Infrastructure — keys, subscriptions, usage
--
-- Two hosting modes, one schema:
--   Headlo-managed: Headlo runs this for you (default)
--   Self-hosted:    You run this — your DB is the source of truth.
--                   Register your connection URL with Headlo and
--                   it will sync a routing cache from your DB.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS prop_component;
CREATE SCHEMA IF NOT EXISTS prop_service;
CREATE SCHEMA IF NOT EXISTS prop_server;

-- ============================================================
-- prop_component.def — UI PROP interface
-- ============================================================
-- The public identity of a PROP type. One row per component slug.
-- def is the interface — framework choice, name, visibility.
-- Code lives in prop_component.app (canonical implementation).
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.def (
  def_id     TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  slug       TEXT NOT NULL UNIQUE,
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  framework  TEXT NOT NULL DEFAULT 'react',  -- 'react' | 'vue' | 'svelte' | 'angular'
  stage      TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'published'
  is_public  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_component.app — canonical implementation
-- ============================================================
-- The code artifact for a PROP component. One row per component.
--
-- component_src    = TypeScript/JSX the author edits in Monaco
-- component_js     = compiled output
-- component_bundle = pre-generated custom element shell + component_js,
--                    written to KV at publish time, served immutably
-- requires         = extracted from prop: imports at compile time
--                    e.g. ['service:auth:v1', 'component:headlo-auth-button']
-- framework_version = pinned version: '19' (React) | '3' (Vue) | '5' (Svelte) | '18' (Angular)
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.app (
  app_id            TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  def_id            TEXT NOT NULL CONSTRAINT fk_component_app_def REFERENCES prop_component.def(def_id),
  owner_id          TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,  -- embeddable id: <headlo-auth>, <clerk-auth>
  name              TEXT NOT NULL,         -- human label: "Headlo Auth", "Clerk Auth"
  framework_version TEXT NOT NULL DEFAULT '19',
  requires          TEXT[] NOT NULL DEFAULT '{}',
  component_src     TEXT,
  component_js      TEXT,
  component_bundle  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_service.def — service PROP interface
-- ============================================================
-- The abstract identity of a service type. One row per service concept.
-- e.g. slug='auth'    groups headlo-auth, clerk-auth implementations.
--      slug='billing' groups billing-mau, billing-per-seat, billing-po, billing-per-call.
-- Concrete implementations live in prop_service.app.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_service.def (
  def_id     TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  slug       TEXT NOT NULL UNIQUE,
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  stage      TEXT NOT NULL DEFAULT 'draft',
  is_public  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_service.app — service implementation
-- ============================================================
-- One row per versioned service implementation.
-- client_js is the browser stub served at /v1/prop/service/slug/version/bundle.
-- It sets window.__headlo_service_{slug}_{version} and routes
-- calls to headlo-worker.
-- Breaking changes create a new version row — old consumers
-- keep reading the old global forever.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_service.app (
  app_id     TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  def_id     TEXT NOT NULL CONSTRAINT fk_service_app_def REFERENCES prop_service.def(def_id),
  owner_id   TEXT NOT NULL,
  slug       TEXT NOT NULL,            -- e.g. 'headlo-auth', 'clerk-auth', 'billing-mau'
  name       TEXT NOT NULL,            -- e.g. 'Headlo Auth', 'Clerk Auth', 'Billing — MAU'
  version    TEXT NOT NULL DEFAULT 'v1',
  client_js  TEXT,
  stage      TEXT NOT NULL DEFAULT 'draft',
  is_public  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (slug, version)
);

-- ============================================================
-- prop_server.api_key — publishable keys for browser clients
-- ============================================================
-- Two key types, two headers, never confused:
--
--   X-Headlo-Prop-Publishable-Key: pk_live_xxx
--     Set by the init script / <PropServer>. Safe for browser.
--     Validated against allowed_origins on every service call.
--     Cached in KV (prop-key:{key}) with 300s TTL.
--
--   X-Headlo-Prop-Private-Key: hlk_xxx
--     Server-side only (.env). Bypasses origin validation.
--     Never stored here — validated against platform.api_key.
--
-- agency_id links to platform.agency — the billing entity.
-- The agency owner (platform.agency.owner_id) is the billing contact.
-- allowed_origins: domain allowlist.
-- Empty array = all origins allowed (dev/internal use only).
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_server.api_key (
  key_id          TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  agency_id       TEXT NOT NULL,                 -- FK → platform.agency.agency_id
  client_id       TEXT NOT NULL UNIQUE,          -- cid_xxx — safe for browser (X-Headlo-Prop-Client-Id)
  secret_key      TEXT UNIQUE,                   -- sk_xxx  — server-side only (X-Headlo-Prop-Secret)
  name            TEXT,                           -- human label e.g. "Production", "Staging"
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',  -- ['https://acme.com', 'http://localhost:3000']
  billing_status  TEXT NOT NULL DEFAULT 'trialing',
  -- billing_status: 'trialing' | 'active' | 'past_due' | 'cancelled'
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_server.service_subscription
-- ============================================================
-- Which service implementation and billing model each agency uses.
-- One row per agency × service. Billing config is model-specific JSONB:
--   billing-mau:        { "max_mau": 1000, "price_per_mau": 0.02 }
--   billing-per-seat:   { "max_seats": 50, "price_per_seat": 10.00 }
--   billing-per-call:   { "max_calls": 10000, "price_per_call": 0.001 }
--   billing-po:         { "po_number": "PO-2026-00441", "seats": 2000, "expires_at": "2027-06-14" }
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_server.service_subscription (
  subscription_id     TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  agency_id           TEXT NOT NULL,             -- FK → platform.agency.agency_id
  service_app_slug    TEXT NOT NULL,             -- 'headlo-auth', 'clerk-auth'
  service_app_version TEXT NOT NULL DEFAULT 'v1',
  billing_app_slug    TEXT NOT NULL,             -- 'billing-mau', 'billing-per-seat', 'billing-po', 'billing-per-call'
  billing_app_version TEXT NOT NULL DEFAULT 'v1',
  billing_config      JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'active',
  -- status: 'active' | 'paused' | 'cancelled'
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agency_id, service_app_slug, service_app_version)
);

-- ============================================================
-- prop_server.usage_period
-- ============================================================
-- Aggregated usage per agency per service per billing month.
-- Compared against billing_config limits at enforcement time.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_server.usage_period (
  period_id        TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  agency_id        TEXT NOT NULL,
  service_app_slug TEXT NOT NULL,
  period_start     DATE NOT NULL,  -- first day of billing month
  period_end       DATE NOT NULL,  -- last day of billing month
  mau              INT NOT NULL DEFAULT 0,
  calls            INT NOT NULL DEFAULT 0,
  renders          INT NOT NULL DEFAULT 0,
  spend_usd        NUMERIC(10,2) NOT NULL DEFAULT 0,
  UNIQUE (agency_id, service_app_slug, period_start)
);

-- ============================================================
-- prop_server.mau_touch
-- ============================================================
-- One row per unique user per agency per service per billing month.
-- INSERT ... ON CONFLICT DO NOTHING is the MAU counter.
-- When a new row is inserted, increment usage_period.mau.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_server.mau_touch (
  agency_id        TEXT NOT NULL,
  service_app_slug TEXT NOT NULL,
  period_start     DATE NOT NULL,
  user_id          TEXT NOT NULL,
  first_seen       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (agency_id, service_app_slug, period_start, user_id)
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_component_def_slug         ON prop_component.def(slug);
CREATE INDEX IF NOT EXISTS idx_component_def_owner        ON prop_component.def(owner_id);
CREATE INDEX IF NOT EXISTS idx_component_app_slug         ON prop_component.app(slug);
CREATE INDEX IF NOT EXISTS idx_component_app_def          ON prop_component.app(def_id);
CREATE INDEX IF NOT EXISTS idx_component_app_owner        ON prop_component.app(owner_id);
CREATE INDEX IF NOT EXISTS idx_service_def_slug           ON prop_service.def(slug);
CREATE INDEX IF NOT EXISTS idx_service_def_owner          ON prop_service.def(owner_id);
CREATE INDEX IF NOT EXISTS idx_service_app_slug           ON prop_service.app(slug);
CREATE INDEX IF NOT EXISTS idx_service_app_def            ON prop_service.app(def_id);
CREATE INDEX IF NOT EXISTS idx_api_key_client             ON prop_server.api_key(client_id);
CREATE INDEX IF NOT EXISTS idx_api_key_secret             ON prop_server.api_key(secret_key);
CREATE INDEX IF NOT EXISTS idx_api_key_agency             ON prop_server.api_key(agency_id);
CREATE INDEX IF NOT EXISTS idx_subscription_agency        ON prop_server.service_subscription(agency_id);
CREATE INDEX IF NOT EXISTS idx_usage_period_agency        ON prop_server.usage_period(agency_id, service_app_slug, period_start);
CREATE INDEX IF NOT EXISTS idx_mau_touch_agency           ON prop_server.mau_touch(agency_id, service_app_slug, period_start);
