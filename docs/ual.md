# UAL — Universal Abstraction Layer

PROP's claim is that you can build any interactive web application by writing a contract and a component. That claim is only as strong as the abstraction layer underneath it.

The Universal Abstraction Layer is a community catalogue of Service PROP interfaces. Each interface is a `prop.def` with `kind = 'service'` — a published contract, provider-agnostic, with at least one working implementation. Anyone can define a new interface. Anyone can add an implementation. No interface is canonical.

**Headlo's implementations are reference examples, not standards.**

---

## What the UAL Is Not

The UAL is not Headlo's product. It is not a list of approved abstractions. It is not a set of problems Headlo has solved and packaged.

Headlo provides the primitives: `prop.def`, `prop.app`, `prop.state`, `prop.event`, `contract`, `handlers`. Everything above that — how auth works, how LLM calls are structured, how realtime sessions are managed — is defined by whoever publishes the `prop.def`. That could be Headlo. It could be you. Both are equally valid.

`llm-chat` is how Headlo currently structures LLM interaction. Someone could define a completely different `llm-interface` with different action signatures, a different return shape, a different philosophy about streaming — and if the community adopts it, that becomes the better abstraction. The UAL is shaped by use, not by Headlo's decisions.

---

## Why This Matters

Every time a developer writes a fetch call against OpenAI, Stripe, or Twilio directly inside a component, three things happen:

1. They wire auth (API key handling, headers)
2. They handle errors and retries
3. They couple their component to a specific provider

A well-designed Service PROP solves all three once, at the contract level. Every component using the same interface gets swappable providers, keys in the worker, and a typed interface — without writing any of that themselves.

The UAL's value is collective: the more interfaces exist, the fewer problems each developer has to solve from scratch. But the quality of those interfaces depends on design discipline. See [service-design.md](service-design.md).

---

## Interface Stages

Every interface carries a stage label. The stages are descriptive, not gatekeeping.

### Draft

One working implementation. The contract may change. Do not build production apps on a Draft interface — the shape hasn't been validated against a second real provider yet.

### Stable

At least 2 working implementations from different providers, at least 1 real app using it in production, no open design questions. Safe to build on. Changes require a deprecation notice.

### Locked

Community consensus. The contract will not change. New implementations can always be added.

---

## Current Registry

Interfaces that exist today. This is not a complete or authoritative list — it is what has been implemented.

| slug | kind | stage | implementations | notes |
|---|---|---|---|---|
| `llm-chat` | service | Stable | `openai-gpt4o-mini`, `anthropic-haiku` | Headlo reference |
| `realtime-session` | service | Draft | `cf-durable-object`, `ably-prod`, `soketi-self` | `join/send/on/leave` shape — needs second real implementation for Stable |
| `auth` | service | Draft | `clerk-prod`, `supabase-auth`, `custom-jwt` | Headlo reference |
| `external-api` | service | Draft | `http-bearer`, `http-apikey`, `http-basic` | Headlo reference |

Any of these can be reimplemented differently. If you think `llm-chat`'s contract is wrong, define a better one. If it gets adopted, it wins.

---

## Categories Worth Exploring

These are common application needs that don't have a defined Service PROP interface yet. They are not Headlo's responsibility to solve — they are opportunities for anyone to define.

| Category | What an interface would provide |
|---|---|
| Auth / identity | Token validation, role resolution, session management |
| Storage | File upload/download, blobs, signed URLs |
| Email | Transactional send |
| Payments | Charge, refund, subscription lifecycle |
| Search | Full-text + semantic query |
| Notifications | Push, in-app, SMS |
| Background jobs | Scheduled tasks, queues, retries |
| External APIs | Generic REST proxy with typed response |

Each of these has multiple competing providers with meaningfully different APIs. That's what makes them interesting design problems. The right abstraction for "payments" isn't obvious — Stripe and Square have different models. Finding the contract shape that works for both without leaking either is the design work.

No one needs Headlo's permission to define any of these. The process is in [contributing.md](contributing.md).

---

## Discovering Interfaces

```bash
# All service interfaces registered in this server
GET /v1/data/def?kind=service

# All implementations of a specific interface
GET /v1/data/app?def=llm-chat

# Full contract for an interface
GET /v1/data/def/llm-chat
```

The `contract.actions` array is the interface spec. Any handler that implements every action with the right argument and return shape is a valid implementation.

---

## Related

- [service-design.md](service-design.md) — the methodology for designing an interface that holds across providers
- [contributing.md](contributing.md) — how to add an implementation, propose a new interface, or challenge an existing one
- [../sql/tables.sql](../sql/tables.sql) — the only fixed layer: `prop.def` schema with `kind` column
