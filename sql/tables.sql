-- ============================================================
-- PROP Server Schema — Clean Install (publisher side)
-- ============================================================
-- Run this on a fresh Postgres for a self-hosted PROP server.
-- This is ONLY the publisher's tables — code artifacts that live
-- on your server and are served from your domain.
--
-- Headlo-owned tables (registry, billing, keys) live in:
--   docker/sql/prop/tables.sql  (Headlo's DB)
--
-- See headlo-prop-server/docs/headlo-prop-split.md for the full split.
--
-- ============================================================

CREATE SCHEMA IF NOT EXISTS prop_component;
CREATE SCHEMA IF NOT EXISTS prop_service;

-- ============================================================
-- prop_component.app — canonical implementation
-- SIDE: PROP SERVER — the only table that must live on the publisher's DB.
--   Source, compiled JS, and bundle are stored here after each Monaco save.
--   Headlo discards all three immediately after pushing via /sync.
--   Bundle is served from your domain: GET /v1/prop/component/:slug/bundle.
-- ============================================================
-- The code artifact for a PROP component. One row per component.
--
-- component_src    = TypeScript/JSX the author edits in Monaco
-- component_js     = compiled output
-- component_bundle = custom element shell + compiled JS, served to the browser
-- requires         = extracted from prop: imports at compile time
--                    e.g. ['service:auth:v1', 'component:headlo-auth-button']
--
-- Note: no FK to prop_component.def — that table lives on Headlo's DB.
--       def_id is stored for reference only; integrity is enforced by Headlo.
-- ============================================================

CREATE TABLE IF NOT EXISTS prop_component.app (
  app_id           TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  def_id           TEXT NOT NULL,   -- ref → prop_component.def on Headlo (no local FK)
  owner_id         TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  requires         TEXT[] NOT NULL DEFAULT '{}',
  component_src    TEXT,
  component_js     TEXT,
  component_bundle TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- prop_service.app — service client stubs
-- SIDE: PROP SERVER — client_js stubs are pushed here by Headlo and served
--   from your domain: GET /v1/prop/service/:slug/:version/bundle.
--   The stub sets window.__headlo_service_{slug}_{version} in the browser.
-- ============================================================
-- One row per versioned service implementation.
-- Headlo authors the client_js and pushes it (analogous to component /sync).
-- Breaking changes create a new version row — old browser consumers keep
-- reading their pinned global forever.
--
-- Note: no FK to prop_service.def — that table lives on Headlo's DB.
--       def_id is stored for reference only; integrity is enforced by Headlo.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS prop_service;

CREATE TABLE IF NOT EXISTS prop_service.app (
  app_id     TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  def_id     TEXT NOT NULL,   -- ref → prop_service.def on Headlo (no local FK)
  owner_id   TEXT NOT NULL,
  slug       TEXT NOT NULL,   -- e.g. 'headlo-auth', 'clerk-auth', 'billing-mau'
  name       TEXT NOT NULL,
  version    TEXT NOT NULL DEFAULT 'v1',
  client_js  TEXT,            -- browser stub served at /v1/prop/service/:slug/:version/bundle
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (slug, version)
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_component_app_slug  ON prop_component.app(slug);
CREATE INDEX IF NOT EXISTS idx_component_app_def   ON prop_component.app(def_id);
CREATE INDEX IF NOT EXISTS idx_component_app_owner ON prop_component.app(owner_id);
CREATE INDEX IF NOT EXISTS idx_service_app_slug    ON prop_service.app(slug, version);
