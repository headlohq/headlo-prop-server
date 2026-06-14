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
