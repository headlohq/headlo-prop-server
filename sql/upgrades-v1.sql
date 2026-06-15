-- ============================================================
-- PROP Schema Upgrades — run manually, idempotent
-- ============================================================

-- Add stage column (draft | stable | locked) to both def tables
ALTER TABLE prop_component.def ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE prop_service.def   ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'draft';

-- Add prop_type column (mirrors prop_{prop_type} schema prefix, for routing and type narrowing)
ALTER TABLE prop_component.def ADD COLUMN IF NOT EXISTS prop_type TEXT NOT NULL DEFAULT 'component';
ALTER TABLE prop_service.def   ADD COLUMN IF NOT EXISTS prop_type TEXT NOT NULL DEFAULT 'service';

-- Drop prop_service.app — service def slug encodes the implementation; no separate app layer needed
DROP TABLE IF EXISTS prop_service.app;

-- Rename context_deps → requires on prop_component.def
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'prop_component' AND table_name = 'def' AND column_name = 'context_deps'
  ) THEN
    ALTER TABLE prop_component.def RENAME COLUMN context_deps TO requires;
  END IF;
END $$;

-- Rename author_id → owner_id on prop_component.impl (consistent with all other tables)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'prop_component' AND table_name = 'impl' AND column_name = 'author_id'
  ) THEN
    ALTER TABLE prop_component.impl RENAME COLUMN author_id TO owner_id;
  END IF;
END $$;

-- react_version: major React version the component was compiled against (2026-06-14)
-- /prop/embed/react/:version serves the matching KV-cached React+ReactDOM bundle.
-- window.__headlo_React_${version} is set so multiple versions can coexist on a page.
ALTER TABLE prop_component.def ADD COLUMN IF NOT EXISTS react_version TEXT NOT NULL DEFAULT '19';

-- prop_server.api_key: publishable keys for browser clients (2026-06-15)
-- Identifies the customer for billing and service routing.
-- allowed_origins enforces domain allowlisting — rejects service calls from unlisted origins.
CREATE SCHEMA IF NOT EXISTS prop_server;
CREATE TABLE IF NOT EXISTS prop_server.api_key (
  key_id          TEXT PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  publishable_key TEXT NOT NULL UNIQUE,
  name            TEXT,
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_key_pk ON prop_server.api_key(publishable_key);
