-- ============================================================
-- llm-chat PROP — Swappable LLM service
-- ============================================================
-- One contract (prop.def), two implementations (prop.app).
-- Ask Widget (or any PROP) references one app slug.
-- Swap the app slug to change the LLM provider — zero other changes.
--
-- Run after: sql/tables.sql
-- ============================================================

-- ── prop.def — the interface ──────────────────────────────────
INSERT INTO prop.def (slug, owner_id, name, kind, contract, handlers, public_path)
VALUES (
  'llm-chat',
  'headlo',
  'LLM Chat',
  'service',
  '{
    "config_fields": [
      { "name": "provider",    "type": "string", "label": "Provider (openai|anthropic)" },
      { "name": "model",       "type": "string", "label": "Model ID" },
      { "name": "temperature", "type": "number", "label": "Temperature", "default": 0.7 }
    ],
    "actions": [
      {
        "name": "chat",
        "args": {
          "messages":    "Array<{ role: string; content: string }>",
          "systemPrompt": "string"
        },
        "returns": { "answer": "string" }
      }
    ],
    "state_fields": []
  }',
  '{ "chat": { "updates_state": [] } }',
  '/llm-chat'
)
ON CONFLICT (slug) DO UPDATE SET
  kind       = EXCLUDED.kind,
  contract   = EXCLUDED.contract,
  handlers   = EXCLUDED.handlers
;

-- ── Implementation 1 — OpenAI gpt-4o-mini ────────────────────
INSERT INTO prop.app (def_id, owner_id, slug, config)
SELECT def_id, 'headlo', 'openai-gpt4o-mini',
  '{ "provider": "openai", "model": "gpt-4o-mini", "temperature": 0.7 }'
FROM prop.def WHERE slug = 'llm-chat'
ON CONFLICT (slug) DO UPDATE SET config = EXCLUDED.config;

INSERT INTO prop.state (app_id, state)
SELECT app_id, '{}' FROM prop.app WHERE slug = 'openai-gpt4o-mini'
ON CONFLICT (app_id) DO NOTHING;

-- ── Implementation 2 — Anthropic claude-haiku ────────────────
INSERT INTO prop.app (def_id, owner_id, slug, config)
SELECT def_id, 'headlo', 'anthropic-haiku',
  '{ "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "temperature": 0.7 }'
FROM prop.def WHERE slug = 'llm-chat'
ON CONFLICT (slug) DO UPDATE SET config = EXCLUDED.config;

INSERT INTO prop.state (app_id, state)
SELECT app_id, '{}' FROM prop.app WHERE slug = 'anthropic-haiku'
ON CONFLICT (app_id) DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────
-- Both apps share one def. Same contract. Different config.provider.
SELECT
  d.slug   AS def_slug,
  a.slug   AS app_slug,
  a.config->>'provider' AS provider,
  a.config->>'model'    AS model
FROM prop.app a
JOIN prop.def d ON d.def_id = a.def_id
WHERE d.slug = 'llm-chat';
