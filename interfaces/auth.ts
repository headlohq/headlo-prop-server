import type { PropServiceDef } from './types.js'

// auth — Service PROP
//
// Interface for token validation and user identity resolution.
// Validates a JWT or session token and returns a normalized identity.
// The auth provider (Clerk, Supabase, custom JWT) is invisible to the component.

export const authDef = {
  slug:  'auth',
  prop_type: 'service',
  name:  'Auth',
  stage: 'draft',
  contract: {
    config_fields: [
      { name: 'provider',   type: 'string', label: 'Provider (clerk | supabase | jwt)' },
      { name: 'jwt_secret', type: 'string', label: 'JWT secret — store in wrangler secret, not here' },
    ],
    actions: [
      {
        name:    'validate',
        args:    { token: 'string' },
        returns: { userId: 'string', role: 'string', claims: 'object' },
      },
      {
        name:    'getUser',
        args:    { userId: 'string' },
        returns: { userId: 'string', email: 'string', name: 'string', role: 'string' },
      },
    ],
  },
  handlers: {
    validate: { updates_state: [] },
    getUser:  { updates_state: [] },
  },
} satisfies PropServiceDef

// Implementations are separate defs: auth-clerk, auth-supabase, auth-jwt

// Provider matrix — each implements both actions without leaking:
//
//   validate({ token }):
//     clerk         → Clerk verifyToken(token)                     → { userId, role, claims }
//     supabase      → supabase.auth.getUser(token)                 → { userId, role, claims }
//     jwt           → jwt.verify(token, JWT_SECRET)                → { userId, role, claims }
//
//   getUser({ userId }):
//     clerk         → Clerk users.getUser(userId)                  → { userId, email, name, role }
//     supabase      → supabase.from('users').select().eq('id', id) → { userId, email, name, role }
//     jwt           → SELECT from your users table                 → { userId, email, name, role }
