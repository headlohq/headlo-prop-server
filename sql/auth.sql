-- ============================================================
-- auth — Service PROP
-- ============================================================
-- Interface for token validation and user identity resolution.
--
-- One prop.def defines the interface.
-- Multiple prop.app rows are interchangeable implementations.
-- Swap the app slug — component code changes nothing.
--
-- Interface:
--   validate({ token })    → { userId, role, claims }
--   getUser({ userId })    → { userId, email, name, role }
--
-- Provider matrix (all implement both actions without leaking):
--
--   validate({ token }):
--     clerk         → Clerk Backend SDK verifyToken(token)
--     supabase-auth → supabase.auth.getUser(token)
--     custom-jwt    → jwt.verify(token, secret) + extract claims
--
--   getUser({ userId }):
--     clerk         → Clerk Backend SDK users.getUser(userId)
--     supabase-auth → supabase.from('users').select().eq('id', userId)
--     custom-jwt    → SELECT from your own users table
--
-- Usage in another PROP's contract:
--   "api": {
--     "props": [
--       { "name": "auth", "def": "auth", "app": "clerk-prod" }
--     ]
--   }
--
-- In component code:
--   const { userId, role } = await api.auth.validate({ token })
-- ============================================================

DO $$
DECLARE
  v_def_id TEXT;
BEGIN

-- ── prop.def ─────────────────────────────────────────────────
INSERT INTO prop.def (slug, owner_id, name, kind, contract, handlers, public_path, is_public)
VALUES (
  'auth',
  'headlo',
  'Auth',
  'service',
  '{
    "config_fields": [
      { "name": "provider",   "type": "string", "label": "Provider (clerk | supabase | jwt)" },
      { "name": "jwt_secret", "type": "string", "label": "JWT secret (provider: jwt) — store in wrangler secret" }
    ],
    "actions": [
      {
        "name": "validate",
        "args":    { "token": "string" },
        "returns": {
          "userId": "string",
          "role":   "string",
          "claims": "object"
        }
      },
      {
        "name": "getUser",
        "args":    { "userId": "string" },
        "returns": {
          "userId": "string",
          "email":  "string",
          "name":   "string",
          "role":   "string"
        }
      }
    ]
  }'::jsonb,
  '{
    "validate": { "updates_state": [] },
    "getUser":  { "updates_state": [] }
  }'::jsonb,
  '/prop/auth',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  kind     = EXCLUDED.kind,
  contract = EXCLUDED.contract,
  handlers = EXCLUDED.handlers
RETURNING def_id INTO v_def_id;

IF v_def_id IS NULL THEN
  SELECT def_id INTO v_def_id FROM prop.def WHERE slug = 'auth';
END IF;

-- ── prop.app — clerk-prod ────────────────────────────────────
-- Clerk JWT verification via Clerk Backend SDK.
-- Requires CLERK_SECRET_KEY in wrangler secret.
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (
  v_def_id, 'headlo', 'clerk-prod',
  '{ "provider": "clerk" }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ── prop.app — supabase-auth ─────────────────────────────────
-- Supabase auth.getUser(token).
-- Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in wrangler secret.
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (
  v_def_id, 'headlo', 'supabase-auth',
  '{ "provider": "supabase" }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ── prop.app — custom-jwt ────────────────────────────────────
-- Standard JWT verify with a shared secret.
-- jwt_secret lives in wrangler secret JWT_SECRET — not in config.
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (
  v_def_id, 'headlo', 'custom-jwt',
  '{ "provider": "jwt" }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

END $$;

-- ── Verify ──────────────────────────────────────────────────
SELECT
  d.slug  AS def_slug,
  d.kind,
  a.slug  AS app_slug,
  a.config->>'provider' AS provider
FROM prop.app a
JOIN prop.def d ON d.def_id = a.def_id
WHERE d.slug = 'auth'
ORDER BY a.slug;
