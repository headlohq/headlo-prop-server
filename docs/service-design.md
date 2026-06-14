# Designing a Service PROP Interface

How to think about the contract for a Service PROP — the methodology behind every interface in the UAL.

---

## The Trap: Designing from the Implementation

When we first designed `realtime-session`, we wrote:

```ts
createSession({ sessionId }) → { wsUrl, token }
```

That felt right. A WebSocket client needs a URL. `wsUrl` is minimal. Done.

The problem: **`{ wsUrl }` is the wrong abstraction for Ably.**

Ably's model isn't "connect to this URL directly." It's "use our SDK + a signed token." Forcing Ably into a `wsUrl` shape means either:
- The component has to know it's talking to Ably and call `new Ably.Realtime()` — the abstraction leaks
- Or `wsUrl` means "whatever the provider wants to give you" — which isn't an interface, it's just passing the problem along

The shape was designed from the Cloudflare DO implementation, not from what the interface actually needs to be. That's the failure mode.

---

## The Right Method: Design From the Consumer

Don't ask "what does the provider return?" Ask "what does the component author need to do their job?"

For `realtime-session`, the component author needs to:
1. Join a named room and exchange messages with other clients
2. Do this without knowing anything about the underlying transport

That suggests the contract shouldn't expose a `wsUrl` at all. The adopted shape:

```ts
// Component code
const session = await api.session.join({ roomId })
session.send({ type: 'pos', x, y })
session.on('pos', handler)
session.leave()
```

The provider handles connection internally. The component never sees a URL, a token, or an SDK. Whether the underlying provider is Cloudflare DO, Ably, or Soketi is invisible. That's a good abstraction — and it's what `realtime-session` now uses.

---

## Validate Against Every Provider

Once you have a proposed contract, check it against every provider you intend to support:

| Contract action | cf-durable-object | ably | soketi |
|---|---|---|---|
| `join({ roomId })` | connect to WS path | create Ably channel | subscribe to Pusher channel |
| `send({ ... })` | `ws.send(JSON.stringify(msg))` | `channel.publish(msg)` | `pusher.trigger(...)` |
| `on(type, handler)` | `ws.onmessage` filter | `channel.subscribe(type, handler)` | `pusher.bind(type, handler)` |
| `leave()` | `ws.close()` | `channel.detach()` | `pusher.unsubscribe(roomId)` |

Every provider can implement every action without leaking its internals. The abstraction holds.

If one provider requires exposing something the others don't — the abstraction is wrong. Redesign the contract, not the provider.

---

## The Validation Rule

> If all providers can implement the contract without the component knowing which one it is, the abstraction is correct.

This test is concrete and falsifiable. It's not about elegance or familiarity. It's about whether the seam holds.

---

## When Not to Generalize

Adding three `prop.app` rows before implementing two of them doesn't validate the contract — it just adds rows.

The right sequence:

1. **Ship the first implementation.** One real `prop.app` + handler.
2. **Let the contract be driven by what the component actually needs.** No speculative fields.
3. **Generalize when the second real provider is needed.** That's when you discover if the first contract was right.

Designing for a provider you haven't implemented yet means you're guessing. You'll be wrong. You'll find out when you try to implement provider 2 and the shape doesn't fit.

---

## Why llm-chat Got It Right

```ts
chat({ messages, systemPrompt }) → { answer }
```

Every LLM API — OpenAI, Anthropic, Groq, Mistral — takes a message array and returns a string. The contract maps exactly to the universal shape of the problem. No provider leaks.

This worked because the underlying domain (chat completion) has a clear consensus shape. Not all domains do. When the domain doesn't have a clear shape, the consumer-first / provider-matrix process is how you find it.

---

## The Process

1. Write the component code you want to call. Not the contract — the call site.
2. Derive the contract from that code.
3. Build the provider matrix. Two columns minimum.
4. If every provider implements every action without leaks: write the `prop.def`.
5. If any provider breaks: redesign the contract. Repeat from step 1.
6. Ship one implementation. Generalize when the second real one is needed.

---

## Related

- [ual.md](ual.md) — the catalogue of defined interfaces and their current stage
- [contributing.md](contributing.md) — how to propose a new interface
- [../sql/llm-chat.sql](../sql/llm-chat.sql) — reference Stable interface
- [../sql/realtime-session.sql](../sql/realtime-session.sql) — reference Draft interface (`join/send/on/leave` shape adopted)
