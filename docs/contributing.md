# Contributing to headlo-prop-server

Three ways to contribute. They require different levels of effort and different kinds of judgment.

---

## Path 1 — Implement an Existing Interface

The lowest-friction contribution. Pick a Stable interface from the [UAL catalogue](ual.md) and add a new provider implementation.

You need:
- A `prop.app` row pointing at the existing `prop.def`
- A handler case in the existing handler file

**Example: adding Groq as an `llm-chat` provider**

```sql
-- Run against your Postgres
INSERT INTO prop.app (def_id, owner_id, slug, config)
SELECT def_id, 'your-org', 'groq-llama',
  '{ "provider": "groq", "model": "llama-3.1-8b-instant", "temperature": 0.7 }'
FROM prop.def WHERE slug = 'llm-chat';
```

```js
// handlers/llm-chat.mjs — add one branch
if (provider === 'groq') {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature,
    }),
  })
  const d = await res.json()
  return { answer: d.choices[0].message.content }
}
```

No changes to the interface. No approval needed. The contract already defines what `chat()` returns — you just need to produce that shape.

**To submit:** open a PR with the handler code. Include a brief test showing the provider works. The SQL is optional (it's seed data, not schema).

---

## Path 2 — Propose a New Interface

Adding a new category to the UAL. Higher effort. Requires design work before any code.

The design process is documented in [service-design.md](service-design.md). The short version:

1. **Write the component call site first.** What does the developer write in their component? Start there, not from what the providers return.
2. **Derive the contract from that.** The actions and return shapes come from what the component needs.
3. **Build the provider matrix.** Table with 2–3 real providers as columns, each action as a row. Can every provider implement every action without the component knowing which one it is?
4. **If yes:** write the `prop.def` SQL and one working implementation.
5. **If any provider leaks:** redesign the contract. Repeat.

**What a complete proposal looks like:**

A PR with three files:

```
sql/<def-slug>.sql          ← prop.def insert + one prop.app
handlers/<def-slug>.mjs     ← working handler for that one app
docs/<def-slug>-design.md   ← consumer code + provider matrix + any open questions
```

The design doc is required. It shows your reasoning and makes the proposal reviewable. A contract without a provider matrix is a guess — it may look right but fail as soon as a second provider is implemented.

**Draft vs Stable:** your proposal ships as Draft. It becomes Stable after a second real implementation exists and at least one app uses it in production.

---

## Path 3 — Challenge an Existing Interface

If a provider you need cannot implement an existing Stable contract without leaking its internals — that's a valid challenge and one of the most important contributions you can make.

The UAL's quality depends on being falsifiable. Implementations that expose failures in the contract are how abstractions improve.

**To challenge:**

Open an issue with:
- Which interface and which provider
- What the provider needs to expose that the current contract doesn't allow
- A proposed alternative shape that works for all existing providers AND the new one
- A provider matrix for the proposed shape

Contract changes to Stable interfaces break existing consumers. The bar is high — the proposed alternative has to be strictly better (works for all providers with no new leaks), not just different. But if the case is clear, the interface will be updated.

---

## What Not to Submit

- Wrapper code for a provider that doesn't match an existing contract — if it doesn't fit the interface, it's a new interface proposal, not an implementation
- Contracts designed from one provider's API response — see [service-design.md](service-design.md) on why this fails
- SQL inserts without a handler, or a handler without corresponding SQL

---

## Local Development

```bash
git clone https://github.com/headlohq/headlo-prop-server
cd headlo-prop-server
npm install
cp .env.example .env
# Set DATABASE_URL in .env

psql $DATABASE_URL -f sql/tables.sql
npm start
```

Test your handler directly:

```bash
curl -X POST http://localhost:3001/v1/prop/llm-chat/groq-llama/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "hello"}], "systemPrompt": "You are helpful."}'
```

---

## Questions

Open an issue. If you're unsure whether a proposed abstraction is right, posting the provider matrix and asking for feedback before writing code is encouraged.
