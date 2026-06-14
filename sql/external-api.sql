-- ============================================================
-- external-api — Service PROP
-- ============================================================
-- Interface for calling any external REST API through the PROP
-- worker. API keys never reach the browser — they live in
-- wrangler secret and are injected by the worker at request time.
--
-- One prop.def defines the interface.
-- Multiple prop.app rows are interchangeable auth strategies.
-- Swap the app slug to change how the worker authenticates.
--
-- Interface:
--   fetch({ path, method?, body?, headers? }) → { status, data }
--
-- Provider matrix (all implement fetch without leaking auth):
--
--   http-bearer  → Authorization: Bearer $KEY
--   http-apikey  → $auth_header: $KEY  (e.g. X-Api-Key: ...)
--   http-basic   → Authorization: Basic base64($user:$pass)
--
-- Each implementation reads base_url + auth config from prop.app.config.
-- The env var name for the key is stored in config.key_secret —
-- the worker resolves process.env[config.key_secret] at runtime.
--
-- Usage in another PROP's contract:
--   "api": {
--     "props": [
--       { "name": "stocks", "def": "external-api", "app": "polygon-bearer" }
--     ]
--   }
--
-- In component code:
--   const { data } = await api.stocks.fetch({ path: '/v2/aggs/ticker/NVDA/prev' })
-- ============================================================

DO $$
DECLARE
  v_def_id TEXT;
BEGIN

-- ── prop.def ─────────────────────────────────────────────────
INSERT INTO prop.def (slug, owner_id, name, kind, contract, handlers, public_path, is_public)
VALUES (
  'external-api',
  'headlo',
  'External API',
  'service',
  '{
    "config_fields": [
      { "name": "base_url",    "type": "string", "label": "Base URL (e.g. https://api.polygon.io)" },
      { "name": "auth_type",   "type": "string", "label": "bearer | apikey | basic" },
      { "name": "auth_header", "type": "string", "label": "Header name for apikey auth (e.g. X-Api-Key)" },
      { "name": "key_secret",  "type": "string", "label": "Env var name holding the key (e.g. POLYGON_API_KEY)" }
    ],
    "actions": [
      {
        "name": "fetch",
        "args": {
          "path":     "string",
          "method":   "string?",
          "body":     "object?",
          "headers":  "object?"
        },
        "returns": {
          "status": "number",
          "data":   "object"
        }
      }
    ]
  }'::jsonb,
  '{
    "fetch": { "updates_state": [] }
  }'::jsonb,
  '/prop/external-api',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  kind     = EXCLUDED.kind,
  contract = EXCLUDED.contract,
  handlers = EXCLUDED.handlers
RETURNING def_id INTO v_def_id;

IF v_def_id IS NULL THEN
  SELECT def_id INTO v_def_id FROM prop.def WHERE slug = 'external-api';
END IF;

-- ── prop.app — http-bearer ───────────────────────────────────
-- Authorization: Bearer $KEY
-- Used by: OpenAI, Anthropic, most modern APIs
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (
  v_def_id, 'headlo', 'http-bearer',
  '{ "auth_type": "bearer" }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ── prop.app — http-apikey ───────────────────────────────────
-- $auth_header: $KEY
-- Used by: Polygon.io (X-Api-Key), Mailgun (api-key header), etc.
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (
  v_def_id, 'headlo', 'http-apikey',
  '{ "auth_type": "apikey" }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ── prop.app — http-basic ────────────────────────────────────
-- Authorization: Basic base64($user:$pass)
-- Used by: Twilio, some legacy APIs
-- key_secret points to env var holding "user:pass"
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (
  v_def_id, 'headlo', 'http-basic',
  '{ "auth_type": "basic" }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

END $$;

-- ── Verify ──────────────────────────────────────────────────
SELECT
  d.slug  AS def_slug,
  d.kind,
  a.slug  AS app_slug,
  a.config->>'auth_type' AS auth_type
FROM prop.app a
JOIN prop.def d ON d.def_id = a.def_id
WHERE d.slug = 'external-api'
ORDER BY a.slug;
