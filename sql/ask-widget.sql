-- ============================================================
-- Ask Widget — PROP architecture scaffold
-- ============================================================
-- Seeds the Ask Widget as a reference PROP implementation.
-- Run after sql/tables.sql. Idempotent — safe to re-run.
--
-- Run order:
--   1. sql/tables.sql      (schema + tables)
--   2. sql/ask-widget.sql  (this file)
-- ============================================================


-- ============================================================
-- 1. prop.def — Ask Widget contract definition
-- ============================================================

INSERT INTO prop.def (slug, owner_id, name, contract, handlers, public_path, is_public)
VALUES (
  'ask-widget',
  'headlo',
  'Ask Widget',
  '{
    "config_fields": [
      { "key": "widgetConfig", "type": "object", "label": "Widget config",
        "shape": {
          "name":        { "type": "string", "label": "Widget name"  },
          "tagline":     { "type": "string", "label": "Tagline"      },
          "accentColor": { "type": "string", "label": "Accent color" },
          "model":       { "type": "string", "label": "OpenAI model" }
        }
      }
    ],
    "state_fields": [
      { "key": "messages", "type": "array",   "label": "Messages",
        "item_shape": { "role": "string", "text": "string" }
      },
      { "key": "loading",  "type": "boolean", "label": "Loading" }
    ],
    "actions": [
      {
        "name": "onSubmit",
        "label": "Submit question",
        "args": [
          { "key": "question", "type": "string", "label": "Question" }
        ]
      }
    ]
  }'::jsonb,
  '{
    "onSubmit": {
      "endpoint": "/prop/ask-widget/:appSlug/chat",
      "method":   "POST",
      "updates_state": ["messages"]
    }
  }'::jsonb,
  '/q/:slug',
  false
)
ON CONFLICT (slug) DO UPDATE SET
  contract    = EXCLUDED.contract,
  handlers    = EXCLUDED.handlers,
  public_path = EXCLUDED.public_path,
  name        = EXCLUDED.name;


-- ============================================================
-- 2. prop.app — example Ask Widget instance
-- ============================================================

INSERT INTO prop.app (def_id, owner_id, slug, config)
SELECT
  d.def_id,
  'headlo',
  'example-ask',
  '{
    "widgetConfig": {
      "name":        "Example Ask Widget",
      "tagline":     "Ask me anything",
      "accentColor": "#5DCAA5",
      "model":       "gpt-4o-mini"
    }
  }'::jsonb
FROM prop.def d
WHERE d.slug = 'ask-widget'
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- 3. prop.state — initial state
-- ============================================================

INSERT INTO prop.state (app_id, state, version)
SELECT a.app_id, '{"messages": [], "loading": false}'::jsonb, 0
FROM prop.app a
WHERE a.slug = 'example-ask'
ON CONFLICT (app_id) DO NOTHING;


-- ============================================================
-- 4. prop.code — starter component
-- ============================================================

INSERT INTO prop.code (app_id, src, js)
SELECT
  a.app_id,
$src$// Props: widgetConfig, onSubmit, loading, messages
// messages: Array<{ role: 'user' | 'assistant', text: string }>
// widgetConfig: { name, tagline, accentColor, model }
// Component MUST be named "Component"
function Component({ widgetConfig = {}, onSubmit, loading, messages = [] }) {
  const [input, setInput] = React.useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return
    onSubmit(input.trim())
    setInput('')
  }

  return (
    <div style={{ padding: 16, maxWidth: 480, fontFamily: 'sans-serif' }}>
      <h2 style={{ color: widgetConfig.accentColor, marginBottom: 12 }}>
        {widgetConfig.name}
      </h2>
      <div style={{ marginBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 8, textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <span style={{
              display: 'inline-block',
              padding: '6px 12px',
              borderRadius: 12,
              background: m.role === 'user' ? '#e0e0e0' : widgetConfig.accentColor,
              color: m.role === 'user' ? '#000' : '#fff',
            }}>
              {m.text}
            </span>
          </div>
        ))}
        {loading && <div style={{ color: '#999', fontSize: 14 }}>Thinking…</div>}
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={widgetConfig.tagline || 'Ask a question'}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #ccc' }}
        />
        <button type="submit" disabled={loading} style={{
          padding: '8px 16px',
          background: widgetConfig.accentColor,
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}>
          Send
        </button>
      </form>
    </div>
  )
}
$src$,
  NULL
FROM prop.app a
WHERE a.slug = 'example-ask'
ON CONFLICT (app_id) DO NOTHING;


-- ============================================================
-- Verify
-- ============================================================

SELECT
  d.slug       AS def_slug,
  d.def_id,
  a.slug       AS app_slug,
  a.app_id,
  s.version    AS state_version,
  CASE WHEN c.src IS NOT NULL THEN 'yes' ELSE 'no' END AS has_src
FROM prop.def   d
JOIN prop.app   a ON a.def_id = d.def_id
JOIN prop.state s ON s.app_id = a.app_id
JOIN prop.code  c ON c.app_id = a.app_id
WHERE d.slug = 'ask-widget';
