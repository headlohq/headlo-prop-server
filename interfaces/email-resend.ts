import type { PropServiceDef } from './types.js'

// email-resend — Service PROP implementation
//
// Resend implementation of the email service contract.
// Simple REST API, great DX, React Email compatible.
// $0/mo up to 3K emails/month. $90/mo for 100K (Pro). $290/mo for 1M.
//
// Runs in a Cloudflare Worker via fetch — no SDK needed.

export const emailResendDef = {
  slug:      'email-resend',
  prop_type: 'service',
  name:      'Email — Resend',
  stage:     'draft',
  contract: {
    config_fields: [
      { name: 'from_address', type: 'string', label: 'Default from address (must match verified domain)' },
      { name: 'from_name',    type: 'string', label: 'Default from name' },
      { name: 'key_secret',   type: 'string', label: 'Env var holding Resend API key (e.g. RESEND_API_KEY)' },
    ],
    actions: [
      {
        name:    'send',
        args:    {
          to:       'string',
          subject:  'string',
          html:     'string',
          text:     'string?',
          from:     'string?',
          reply_to: 'string?',
        },
        returns: { message_id: 'string', ok: 'boolean' },
      },
    ],
  },
  handlers: {
    send: { updates_state: [] },
  },
} satisfies PropServiceDef

// Worker implementation notes:
//
//   POST https://api.resend.com/emails
//   Authorization: Bearer {RESEND_API_KEY}
//   Content-Type: application/json
//
//   Request body:
//   {
//     "from": "from_name <from_address>",
//     "to": [to],
//     "subject": subject,
//     "html": html,
//     "text": text,              // optional
//     "reply_to": reply_to       // optional
//   }
//
//   Response → { id: "re_..." } → return { message_id: id, ok: true }
