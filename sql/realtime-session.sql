-- ============================================================
-- realtime-session — Service PROP
-- ============================================================
-- Interface for real-time WebSocket room management.
--
-- One prop.def defines the interface.
-- Multiple prop.app rows are interchangeable implementations.
-- Swap the app slug — component code changes nothing.
--
-- Interface:
--   join({ roomId })   → SessionHandle  (connect + get send/on/leave)
--   leave({ roomId })  → { ok }
--
-- Component code:
--   const session = await api.session.join({ roomId })
--   session.send({ type: 'pos', x, y })
--   session.on('pos', handler)
--   session.leave()
--
-- Provider matrix (all implement both actions without leaking):
--   join({ roomId }):
--     cf-durable-object → connects WS to PropSession DO, returns session handle
--     ably-prod         → creates Ably channel, returns session handle
--     soketi-self       → subscribes to Pusher channel, returns session handle
--
--   leave({ roomId }):
--     cf-durable-object → ws.close()
--     ably-prod         → channel.detach()
--     soketi-self       → pusher.unsubscribe(roomId)
--
-- Usage in another PROP's contract:
--   "api": {
--     "props": [
--       { "name": "session", "def": "realtime-session", "app": "cf-durable-object" }
--     ]
--   }
-- ============================================================

DO $$
DECLARE
  v_def_id TEXT;
BEGIN

-- ── prop.def ─────────────────────────────────────────────────
INSERT INTO prop.def (slug, owner_id, name, kind, contract, handlers, public_path, is_public)
VALUES (
  'realtime-session',
  'headlo',
  'Realtime Session',
  'service',
  '{
    "config_fields": [
      { "name": "provider",   "type": "string", "label": "Provider (cf-do | ably | soketi)" },
      { "name": "soketi_url", "type": "string", "label": "Soketi endpoint (provider: soketi)" }
    ],
    "actions": [
      {
        "name":    "join",
        "args":    { "roomId": "string" },
        "returns": "SessionHandle"
      },
      {
        "name":    "leave",
        "args":    { "roomId": "string" },
        "returns": { "ok": "boolean" }
      }
    ],
    "service_types": {
      "SessionHandle": {
        "kind": "interface",
        "methods": {
          "send":  { "args": { "msg": "Record<string, any>" },                                           "returns": "void" },
          "on":    { "args": { "type": "string", "handler": "(payload: Record<string, any>) => void" }, "returns": "void" },
          "leave": { "args": {},                                                                             "returns": "void" }
        },
        "properties": {
          "id": "string"
        }
      }
    }
  }'::jsonb,
  '{
    "join":  { "updates_state": [] },
    "leave": { "updates_state": [] }
  }'::jsonb,
  '/prop/realtime-session',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  kind     = EXCLUDED.kind,
  contract = EXCLUDED.contract,
  handlers = EXCLUDED.handlers
RETURNING def_id INTO v_def_id;

IF v_def_id IS NULL THEN
  SELECT def_id INTO v_def_id FROM prop.def WHERE slug = 'realtime-session';
END IF;

-- ── prop.app — cf-durable-object ────────────────────────────
-- PropSession Durable Object runs inside the same Cloudflare Worker.
-- Zero external dependencies. session.send() → ws.send(JSON).
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (v_def_id, 'headlo', 'cf-durable-object', '{ "provider": "cf-do" }'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- ── prop.app — ably-prod ─────────────────────────────────────
-- Ably managed channels. session.send() → channel.publish().
-- Requires ABLY_API_KEY in wrangler secret.
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (v_def_id, 'headlo', 'ably-prod', '{ "provider": "ably" }'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- ── prop.app — soketi-self ───────────────────────────────────
-- Pusher-compatible, self-hosted. session.send() → pusher.trigger().
-- Requires SOKETI_URL in wrangler secret.
INSERT INTO prop.app (def_id, owner_id, slug, config)
VALUES (v_def_id, 'headlo', 'soketi-self', '{ "provider": "soketi" }'::jsonb)
ON CONFLICT (slug) DO NOTHING;

END $$;

-- ── Verify ──────────────────────────────────────────────────
SELECT
  d.slug   AS def_slug,
  d.kind,
  a.slug   AS app_slug,
  a.config->>'provider' AS provider
FROM prop.app a
JOIN prop.def d ON d.def_id = a.def_id
WHERE d.slug = 'realtime-session'
ORDER BY a.slug;
