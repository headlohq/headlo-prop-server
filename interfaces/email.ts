import type { PropServiceDef } from './types.js'

// email — Service PROP
//
// Interface for transactional email sending.
// One contract, swappable providers (SES, Resend, Postmark).
// Change the def slug in your requires to switch providers — component code never changes.

export const emailDef = {
  slug:  'email',
  prop_type: 'service',
  name:  'Email',
  stage: 'draft',
  contract: {
    config_fields: [
      { name: 'from_address', type: 'string', label: 'Default from address (e.g. noreply@yourdomain.com)' },
      { name: 'from_name',    type: 'string', label: 'Default from name (e.g. Headlo)' },
    ],
    actions: [
      {
        name:    'send',
        args:    {
          to:       'string',
          subject:  'string',
          html:     'string',
          text:     'string?',
          from:     'string?',   // override default from_address
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

// Implementations are separate defs: email-ses, email-resend, email-postmark

// Provider matrix — each implements send without leaking:
//
//   send({ to, subject, html }):
//     email-ses     → SES SendEmail API (AWS SDK v3)    → { message_id, ok }
//     email-resend  → Resend /emails POST                → { message_id, ok }
//     email-postmark → Postmark /email POST             → { message_id, ok }

// Swap example — switching from Resend to SES:
//
//   Before: { prop_type: 'service', def_slug: 'email-resend' }
//   After:  { prop_type: 'service', def_slug: 'email-ses' }
//
// Zero code changes. Same component, same api.email.send() call.

// Cost comparison at 100K emails/month:
//   email-ses     → AWS SES  $0.10/1K → ~$10/mo
//   email-resend  → Resend   $90/mo (Pro plan, includes 100K)
//   email-postmark → Postmark $15/mo  (100K included on base plan)
