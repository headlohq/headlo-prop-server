import type { PropServiceDef } from './types.js'

// external-api — Service PROP
//
// Interface for calling any external REST API through the PROP worker.
// API keys live in wrangler secret and are injected at request time.
// The component never sees a key, never writes auth headers, never handles CORS.
//
// The three implementations are auth strategies, not specific services.
// Each external API (Polygon, OpenAI, Twilio) gets its own prop_service.app row
// pointing at the right strategy, with base_url and key_secret in config.

export const externalApiDef = {
  slug:  'external-api',
  prop_type: 'service',
  name:  'External API',
  stage: 'draft',
  contract: {
    config_fields: [
      { name: 'base_url',    type: 'string', label: 'Base URL (e.g. https://api.polygon.io)' },
      { name: 'auth_type',   type: 'string', label: 'Auth strategy: bearer | apikey | basic' },
      { name: 'auth_header', type: 'string', label: 'Header name for apikey auth (e.g. X-Api-Key)' },
      { name: 'key_secret',  type: 'string', label: 'Env var name holding the key (e.g. POLYGON_API_KEY)' },
    ],
    actions: [
      {
        name:    'fetch',
        args:    { path: 'string', method: 'string?', body: 'object?', headers: 'object?' },
        returns: { status: 'number', data: 'object' },
      },
    ],
  },
  handlers: {
    fetch: { updates_state: [] },
  },
} satisfies PropServiceDef

// Implementations are separate defs: external-api-bearer, external-api-apikey, external-api-basic

// Example: wiring Polygon.io (uses X-Api-Key header)
//
//   prop_service.app row:
//     slug:   'polygon-stocks'
//     def:    'external-api'
//     config: { base_url: 'https://api.polygon.io', auth_type: 'apikey',
//               auth_header: 'X-Api-Key', key_secret: 'POLYGON_API_KEY' }
//
//   In another PROP's contract:
//     { name: 'stocks', def: 'external-api', app: 'polygon-stocks' }
//
//   In component code:
//     const { data } = await api.stocks.fetch({ path: '/v2/aggs/ticker/NVDA/prev' })
//     // POLYGON_API_KEY was injected by the worker — component never saw it
