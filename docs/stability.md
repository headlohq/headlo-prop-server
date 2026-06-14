# Stability Model

How PROP ensures that deployed components keep running without unexpected breaks from React version
changes, service API updates, or platform upgrades.

---

## The problem in a normal web app

In a standard frontend stack, three things can silently break your components:

1. **React version bump** — hooks API changes, render behavior changes
2. **External API contract change** — a service you depend on renames or removes a method
3. **Your own contract change** — you rename a state field, now the component crashes

PROP has explicit answers for all three.

---

## React version changes — irrelevant by design

Components in PROP are compiled with **sucrase**, which strips TypeScript/JSX syntax and produces
plain JavaScript. There is no bundler, no tree-shaking, no React import. React is a global:

```js
// component_src (what the builder writes):
function Component({ state, config }) {
  const [q, setQ] = React.useState('')
  return <div>{state.messages.length}</div>
}

// component_js (what sucrase produces — runs in the browser):
function Component({ state, config }) {
  const [q, setQ] = React.useState('')
  return React.createElement('div', null, state.messages.length)
}
```

`React.useState`, `React.useEffect`, `React.createElement` — these have been stable since React 16.8.
A React version bump does not change these call signatures. The compiled output runs unchanged.

**What `prop_runtime_version` tracks** is not the React version — it tracks the **injected props
contract**: the shape of `config`, `state`, `userState`, and the action methods passed into the
component. That is the only thing that can break a compiled component.

---

## Service API contract changes — slug is the version

Every service PROP has a def slug: `llm-chat`, `realtime-session`, `auth`. A component pins to a
slug in its `context_deps`:

```ts
context_deps: {
  api: {
    props: [{ prop_type: 'service', def_slug: 'llm-chat-openai' }]
  }
}
```

**The slug is the version.** A `stable` or `locked` def's contract cannot have breaking changes —
the worker rejects them at save time. If a breaking change is needed, a new def slug is created
(`llm-chat-v2`). Old components keep running on `llm-chat` forever. They never see `llm-chat-v2`
until a builder explicitly updates `context_deps`.

### Stage enforcement

| Stage | Contract can change | Breaking change |
|---|---|---|
| `draft` | yes — it's a draft | yes |
| `stable` | additive only | rejected by worker — create a new slug |
| `locked` | no | rejected by worker |

`isBreakingChange(oldContract, newContract)` diffs the contracts at save time:
- Action removed → breaking
- Required arg removed or renamed → breaking
- Return field removed → breaking
- New optional arg added, new action added → additive (allowed)

### Swapping an implementation never breaks anything

Swapping `openai-gpt4o-mini` for `anthropic-haiku` changes `context_deps.app` — not the contract.
`context_deps` is a **top-level column**, separate from `contract`. This means:

- `contract_version` does not change
- No recompile is triggered
- The component keeps running with the same compiled `component_js`
- Only the service handler switches — the component code is untouched

---

## Own contract changes — additive vs breaking

When a builder changes their own component's contract (`state_fields`, `config_fields`, `actions`):

**Additive change** (new field added) — never breaks a running component:
- `reconcileState` fills the new field with its `default` value on every state read
- No DB migration needed — old state rows are reconciled on the fly
- Component keeps running; new field is available immediately

**Deletive change** (field removed) — data preserved, field hidden:
- `reconcileState` filters out the removed field — component no longer receives it
- Old data stays in the JSONB row, silently excluded
- Reversible — add the field back and the data reappears

**Breaking change** (rename, type change) — surfaces as a Monaco type error:
- `contract_version` changes → `prop_runtime_version` mismatch detected
- `contractToTypeSrc` regenerates the `.d.ts` → Monaco shows type errors on the old field name
- The builder sees the error immediately in the editor and fixes `component_src`
- This is expected — the builder made the change and gets immediate feedback

---

## The version tracking model

```
prop_component.def.contract_version     sha256(JSON.stringify(contract))
                                        changes only when contract changes (not context_deps)

prop_component.app.prop_runtime_version contract_version at last compile
                                        mismatch → regenerate types + recompile component_js

prop_service.def.contract_version       sha256(JSON.stringify(contract))
                                        for auditing when a service contract last changed
```

On every component editor load:
```ts
if (app.prop_runtime_version !== def.contract_version) {
  // regenerate contractToTypeSrc() → new .d.ts → Monaco types updated
  // recompile component_src → new component_js written
  // update prop_runtime_version
}

// always re-inject service types (one DB read per dep, always fresh)
for (const dep of def.context_deps?.api?.props ?? []) {
  const serviceDef = await getServiceDef(dep.def)
  injectServiceTypes(serviceTypesToDts(serviceDef.contract.service_types))
}
```

---

## Summary

| Scenario | Outcome |
|---|---|
| React version bump | No effect — React is a global, compiled output is stable |
| Service PROP stable/locked contract change | Rejected — create a new def slug |
| Service PROP draft contract change | Monaco types refreshed on load, type errors signal the change |
| Service implementation swap (app change) | No recompile — context_deps is separate from contract |
| Own contract additive change | No break — reconcileState fills defaults |
| Own contract deletive change | No break — reconcileState filters removed fields |
| Own contract breaking change | Monaco type error — expected, builder made the change |
