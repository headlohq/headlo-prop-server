import type { PropServiceDef } from './types.js'

// email-ses — Service PROP implementation
//
// AWS SES implementation of the email service contract.
// ~$0.10 per 1,000 emails. No monthly minimum.
// At 100K emails/month: ~$10. At 1M emails/month: ~$100.
//
// Requires verified SES sending domain in your AWS account.
// Runs in a Cloudflare Worker via AWS Signature V4 (no SDK required — pure fetch).

export const emailSesDef = {
  slug:      'email-ses',
  prop_type: 'service',
  name:      'Email — AWS SES',
  stage:     'draft',
  contract: {
    config_fields: [
      { name: 'from_address',  type: 'string', label: 'Default from address (must be SES-verified)' },
      { name: 'from_name',     type: 'string', label: 'Default from name' },
      { name: 'aws_region',    type: 'string', label: 'AWS region (e.g. us-east-1)' },
      { name: 'key_id_secret', type: 'string', label: 'Env var holding AWS Access Key ID (e.g. AWS_KEY_ID)' },
      { name: 'key_secret',    type: 'string', label: 'Env var holding AWS Secret Access Key (e.g. AWS_SECRET_KEY)' },
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
//   POST https://email.{region}.amazonaws.com/v2/email/outbound-emails
//   Auth: AWS Signature V4 — sign with HMAC-SHA256 using AWS_KEY_ID + AWS_SECRET_KEY
//   No SDK needed — Workers has SubtleCrypto for HMAC
//
//   Request body:
//   {
//     "FromEmailAddress": "from_name <from_address>",
//     "Destination": { "ToAddresses": [to] },
//     "Content": {
//       "Simple": {
//         "Subject": { "Data": subject },
//         "Body": {
//           "Html": { "Data": html },
//           "Text": { "Data": text ?? stripHtml(html) }
//         }
//       }
//     }
//   }
//
//   Response → { MessageId: "..." } → return { message_id: MessageId, ok: true }
