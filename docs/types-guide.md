# Types Guide

Every type in `interfaces/types.ts` mapped to a real example.
Two PROPs are used throughout: `realtime-session` (service) and `ask-widget` (component).

---

## Intent types

These generic mapped types show the **intended shape** of a JSONB column for a specific def.
They don't enforce at compile time — TypeScript can't validate runtime data — but they document
what keys are expected and make the shape visible on hover in the editor.

Requires `satisfies` on the def to preserve literal field names (see [realtime-session.ts](../interfaces/realtime-session.ts)).

| Type | Maps to | Source field |
|---|---|---|
| `PropComponentAppConfigIntent<T>` | `prop_component.app.config` | `contract.config_fields` |
| `PropComponentStateFieldsIntent<T>` | `prop_component.state.fields` | `contract.state_fields` |
| `PropServiceApi<T>` | runtime `api.[name]` in component | `contract.actions` |

### Examples

All examples use real defs from `interfaces/`. Each shows the type resolution and where it's used in real worker/handler code.

---

#### `PropComponentAppConfigIntent<T>` — worker reading ask-widget config

```ts
// interfaces/ask-widget.ts — config_fields: display_name, tagline, accent_color, knowledge_scope, behavior
type AskWidgetConfig = PropComponentAppConfigIntent<typeof askWidgetDef>
// → { display_name: any; tagline: any; accent_color: any; knowledge_scope: any; behavior: any }

// Real use: worker serving the component reads config to inject into the page
function serveAskWidget(config: PropComponentAppConfigIntent<typeof askWidgetDef>) {
  const { display_name, accent_color, behavior } = config
  // display_name, accent_color, behavior autocomplete — no guessing key names
  return renderHtml({ title: display_name, color: accent_color, mode: behavior })
}

// Real row in prop_component.app.config:
// { display_name: 'Store Help', accent_color: '#5dcaa5', behavior: 'modal', ... }
```

---

#### `PropComponentStateFieldsIntent<T>` — action handler reading ask-widget state

```ts
// interfaces/ask-widget.ts — state_fields: messages
type AskWidgetStateFields = PropComponentStateFieldsIntent<typeof askWidgetDef>
// → { messages: any }

// Real use: onSubmit handler reads current messages, appends new ones, writes back
function handleOnSubmit(
  state: PropComponentStateFieldsIntent<typeof askWidgetDef>,
  args: { question: string }
) {
  const { messages } = state   // messages autocompletes — key is known from contract
  const updated = [...messages, { role: 'user', text: args.question }]
  return { messages: updated } // write back to prop_component.state.fields
}

// Real row in prop_component.state.fields:
// { messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi!' }] }
```

---

#### `PropServiceApi<T>` — Monaco IntelliSense for component builders

```ts
// interfaces/llm-chat.ts — actions: chat({ messages, systemPrompt }) → { answer }
type LlmApi = PropServiceApi<typeof llmChatDef>
// → { chat: (args: { messages: any; systemPrompt: any }) => Promise<any> }

// Real use: contractToTypeSrc injects this as the type of api['llm-chat-openai'] in PropComponentProps
// Builder in Monaco writes:
async function handleSubmit({ api, state }) {
  const result = await api['llm-chat-openai'].chat({
    messages:     state.messages,   // ← messages autocompletes
    systemPrompt: config.knowledge_scope,
  })
  // api['llm-chat-openai'].chat autocompletes — wrong arg names are Monaco type errors
}

// interfaces/realtime-session.ts — actions: join({ roomId }), leave({ roomId })
type RealtimeApi = PropServiceApi<typeof realtimeSessionDef>
// → { join: (args: { roomId: any }) => Promise<any>; leave: (args: { roomId: any }) => Promise<any> }

// Builder in Monaco:
const session = await api['realtime-session-cf'].join({ roomId: raceId })
// api['realtime-session-cf'].join autocompletes — roomId is the only valid arg
```

### How they work

```ts
// Config/state — walk fields[n].name as string literals:
export type PropComponentAppConfigIntent<T extends PropComponentDef> = {
  [K in NonNullable<T['contract']['config_fields']>[number]['name']]: any
}
// NonNullable<...>   — strips undefined from optional config_fields
// [number]           — indexes into the array to get one PropField element
// ['name']           — reads the name property → string literal if satisfies was used

// PropServiceApi — walk actions[n].name as method keys,
// then walk that action's args object keys as parameter keys:
export type PropServiceApi<T extends PropServiceDef> = {
  [A in NonNullable<T['contract']['actions']>[number]['name']]:
    (args: {
      [K in keyof Extract<
        NonNullable<T['contract']['actions']>[number],
        { name: A }
      >['args']]: any
    }) => Promise<any>
}
// Extract<..., { name: A }> — narrows the actions array to the one action matching name A
// ['args']                  — gets that action's PropArgMap ({ messages: 'string', ... })
// keyof                     — turns arg names into string literal keys
```

Without `satisfies`, `['name']` widens to `string` and the type collapses to `Record<string, any>`.
With `satisfies PropComponentDef`, literal names are preserved and the shape is visible.

### Why `PropComponentDefContract` has no intent type

`PropComponentDefContract` is the type for `prop_component.def.contract`. Its keys are
**statically known** — `config_fields`, `state_fields`, `actions`, `routes` — always the same
regardless of which def you're looking at. So the interface itself is the full type. No generic
needed, no `Intent` suffix needed.

```ts
// No intent type needed — keys are static, not derived from T
interface PropComponentDefContract {
  config_fields?: PropField[]
  state_fields?:  PropField[]
  actions?:       PropAction[]
  routes?:        PropRoute[]
}
```

Intent types only exist where keys are **dynamic** — derived from whatever field names a specific
def declares:

```ts
// Keys are dynamic — depend on what T declares in state_fields
type PropComponentStateFieldsIntent<T> = {
  [K in NonNullable<T['contract']['state_fields']>[number]['name']]: any
}
// ask-widget → { messages: any }
// race game  → { score: any; laps: any }
```

| Type | Keys | Why |
|---|---|---|
| `PropComponentDefContract` | Static — always `config_fields`, `state_fields`, etc. | Concrete interface, no generic |
| `PropComponentAppConfigIntent<T>` | Dynamic — whatever names T declares in `config_fields` | Generic mapped type needed |
| `PropComponentStateFieldsIntent<T>` | Dynamic — whatever names T declares in `state_fields` | Generic mapped type needed |

### Full JSONB column → TypeScript type map

Every JSONB column in `sql/tables.sql` and its corresponding type in `interfaces/types.ts`:

| Column | TypeScript type | Form |
|---|---|---|
| `prop_component.def.contract` | `PropComponentDefContract` | Concrete interface — config_fields, state_fields, actions, routes only |
| `prop_component.def.requires` | `PropRequires` | Concrete interface — top-level, not versioned by contract_version |
| `prop_component.app.config` | `PropComponentAppConfigIntent<T>` | Generic intent type |
| `prop_component.state.fields` | `PropComponentStateFieldsIntent<T>` | Generic intent type |
| `prop_component.event.action_args` | `PropComponentEventActionArgs` | `Record<string, any>` — runtime values, not type refs |
| `prop_component.event.action_result` | `PropComponentEventActionResult` | `Record<string, any>` — runtime values |
| `prop_component.session.metadata` | `PropComponentSessionMetadata` | `Record<string, any>` — free-form per app |
| `prop_service.def.contract` | `PropServiceDefContract` | Concrete interface |
| `prop_service.def.handlers` | `PropServiceDefHandlers` | `Record<string, { updates_state?: string[] }>` |

`session.metadata` has no intent type — its shape is free-form and defined per app, not by the contract.

---

## Primitive types

### `PropTypeRef = string`
A TypeScript type written as a string. Used anywhere a type needs to be stored as data.

```ts
// In a contract action:
args: { roomId: 'string' }        // PropTypeRef = 'string'
returns: 'SessionHandle'          // PropTypeRef = 'SessionHandle' (named type ref)

// In a state field:
{ name: 'messages', type: 'Array<{ role: string; text: string }>' }
//                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ PropTypeRef
```

### `PropArgMap = Record<string, PropTypeRef>`
A named set of arguments, each mapped to a `PropTypeRef`.

```ts
// In an action definition:
args: { roomId: 'string' }
//     ^^^^^^^^^^^^^^^^^^^ PropArgMap

// In a service_types method:
methods: {
  send: { args: { msg: 'Record<string, any>' }, returns: 'void' }
  //            ^^^^^^^^^^^^^^^^^^^^^^^^^^^ PropArgMap
}
```

---

## Config types

### `PropConfigValues = Record<string, any>`
The runtime JSON stored in `prop_component.app.config`.
Keys are the `config_fields[n].name` values from the contract.

```ts
// prop_component.app row for a deployed ask-widget:
config: {
  display_name:    'Store Help',
  accent_color:    '#5dcaa5',
  behavior:        'modal',
}
```

### `PropComponentAppConfigIntent<T>`
Shows the *intended* shape of config for a specific def. Keys are the `config_fields` names.
Requires `satisfies` on the def to preserve literal types.

```ts
type MyConfig = PropComponentAppConfigIntent<typeof askWidgetDef>
// resolves to: { display_name: any; tagline: any; accent_color: any; knowledge_scope: any; behavior: any }
```

---

## Field definitions

### Where do `state_fields` (and `config_fields`) actually live?

They are **not** top-level columns. They are keys inside the `contract` JSONB column on `prop_component.def`:

```
prop_component.def.contract  →  { state_fields: [...], config_fields: [...], actions: [...], ... }
```

The mapped type path makes this explicit:

```ts
T['contract']['state_fields']
// T            = PropComponentDef
// ['contract'] = PropComponentDefContract  (the JSONB column)
// ['state_fields'] = PropField[]           (a key inside that JSON object)
```

The **runtime values** that match those field names are a separate thing — stored in `prop_component.state.fields`.

| What | Where |
|---|---|
| Field definitions (`state_fields`) | `prop_component.def.contract` (JSONB key) |
| Runtime values | `prop_component.state.fields` (separate table) |

---

### `PropField`
One entry in `config_fields` or `state_fields`.

#### `state_fields` lifecycle

```ts
// 1. Definition — PropField[] in PropComponentDefContract:
state_fields: [
  { name: 'messages', type: 'Array<{ role: string; text: string }>', default: [] }
  //  ^PropField.name     ^PropField.type (PropTypeRef string)
]

// 2. Runtime values — PropComponentStateFields in prop_component.state.fields:
{ messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi!' }] }
//  ^key from PropField.name    ^value matches PropField.type — validated at write time

// 3. Component receives — injected by the PROP runtime, documented in comment header:
// messages: Array<{ role: 'user' | 'assistant', text: string }>
function Component({ state }) {
  const { messages } = state  // builder just knows from the comment — no static type
}
```

| Layer | Type | Enforced by |
|---|---|---|
| `state_fields` definition | `PropField[]` | TypeScript at contract authoring time |
| Runtime values shape | `PropComponentStateFields` = `Record<string, any>` | App layer validation at write time |
| Component receives | `state: Record<string, any>` | Comment header generated from `state_fields` |

```ts
// config_fields — static config set once when deploying an app:
{ name: 'provider',   type: 'string', label: 'Provider (cf-do | ably | soketi)' }

// state_fields — global live state written by action handlers:
{ name: 'messages', type: 'Array<{ role: string; text: string }>', default: [] }
```

---

## Service type definitions

### `PropTypeMethod`
One method inside a `PropTypeDef` interface — args and return type, both as `PropTypeRef` strings.

```ts
// Inside service_types.SessionHandle.methods:
send:  { args: { msg: 'Record<string, any>' }, returns: 'void' }
on:    { args: { type: 'string', handler: '(payload: Record<string, any>) => void' }, returns: 'void' }
leave: { args: {}, returns: 'void' }
```

### `PropTypeDef`
A full named type in JSON form. Stored in `contract.service_types`. Code-gen'd into a `.d.ts` for callers.

```ts
// prop_service.def.contract.service_types.SessionHandle:
{
  kind: 'interface',
  methods: {
    send:  { args: { msg: 'Record<string, any>' }, returns: 'void' },
    on:    { args: { type: 'string', handler: '...' }, returns: 'void' },
    leave: { args: {}, returns: 'void' },
  },
  properties: { id: 'string' },
}

// The worker code-gens this into:
// interface SessionHandle {
//   send(msg: Record<string, any>): void
//   on(type: string, handler: (payload: Record<string, any>) => void): void
//   leave(): void
//   readonly id: string
// }
// ...and injects it into Monaco for callers of realtime-session.
```

---

## Action definitions

### `PropAction`
One action a component can fire. Lives in `contract.actions`.

```ts
// Service PROP action — returns a named type ref:
{ name: 'join', args: { roomId: 'string' }, returns: 'SessionHandle' }
//                     ^^^^^^^^^^^^^^^^^ PropArgMap     ^^^^^^^^^^^^^ PropTypeRef

// Service PROP action — returns a field map:
{ name: 'leave', args: { roomId: 'string' }, returns: { ok: 'boolean' } }
//                                                    ^^^^^^^^^^^^^^^^^ PropArgMap

// Component PROP action — declares which state fields it writes:
{ name: 'onSubmit', args: { question: 'string' }, returns: {}, updates_state: ['messages'] }
//                                                              ^^^^^^^^^^^^^^^^^^^^^^ state routing
```

`updates_state` tells the worker which keys from the action's return value to merge into `prop_component.state.fields`. If empty (`[]`), the action runs but writes nothing to state — correct for stateless service PROPs like `email.send`.

---

## Requires (component PROPs only)

Declared at the top level of `PropComponentDef` — not inside `contract`. Changing a `PropRef`
never bumps `contract_version`.

### `PropRef`
A reference to another PROP. `prop_type` maps to the `prop_{prop_type}` schema prefix.
`def_slug` maps to `prop_{prop_type}.def.slug` — it is the canonical name and the api key in the component.

```ts
{ prop_type: 'service',   def_slug: 'llm-chat-openai' }
{ prop_type: 'service',   def_slug: 'realtime-session-cf' }
{ prop_type: 'service',   def_slug: 'auth-headlo' }
{ prop_type: 'component', def_slug: 'date-picker' }
// component accesses as: api['llm-chat-openai'].chat(...), api['realtime-session-cf'].join(...)
// swap provider: change def_slug to 'llm-chat-anthropic' — component code unchanged
```

### `PropHttpRef`
A proxied external REST API. Key lives in wrangler secret, never the browser.

```ts
{ url: 'https://api.polygon.io/v2', env_var: 'POLYGON_API_KEY' }
// component accesses as: api['https://api.polygon.io/v2'].fetch({ path: '/v2/...' })
```

### `PropMcpTool`
An MCP tool wired into this component.

```ts
{ tool: 'search_knowledge' }
// component accesses as: api['search_knowledge']({ query: '...' })
```

### `PropRequires`
All PROP dependencies declared by the component. Flat — `props` already carries `prop_type`,
no extra nesting needed.

```ts
requires: {
  props: [
    { prop_type: 'service',   def_slug: 'llm-chat-openai' },
    { prop_type: 'service',   def_slug: 'auth-headlo' },
    { prop_type: 'component', def_slug: 'date-picker' },
  ],
  external: [{ url: 'https://api.polygon.io/v2', env_var: 'POLYGON_API_KEY' }],
  mcp:      [{ tool: 'search_knowledge' }],
  auto:     true,   // wire own actions as typed methods on api
}
```

---

## Route definitions

### `PropRoute`
One route in a multi-page component PROP. Lives in `contract.routes`.

```ts
routes: [
  { path: '/',                component: 'Lobby' },
  { path: '/race/:sessionId', component: 'Race'  },
]
// The component file exports both Lobby and Race.
// The PROP router renders the right one based on the current path.
```

---

## Contract objects (stored as JSONB in the DB)

### `PropComponentDefContract` → `prop_component.def.contract`
The full contract for a component PROP.

```ts
// ask-widget contract (requires is top-level on PropComponentDef, not inside contract):
{
  config_fields:  [{ name: 'display_name', type: 'string', label: '...' }, ...],
  state_fields:   [{ name: 'messages', type: 'Array<...>', default: [] }],
  actions:        [{ name: 'onSubmit', args: { question: 'string' }, returns: {}, updates_state: ['messages'] }],
}
```

### `PropServiceDefContract` → `prop_service.def.contract`
The full contract for a service PROP.

```ts
// realtime-session contract:
{
  config_fields:  [{ name: 'provider', type: 'string', label: '...' }, ...],
  actions:        [{ name: 'join', args: { roomId: 'string' }, returns: 'SessionHandle' }, ...],
  service_types:  { SessionHandle: { kind: 'interface', methods: { ... }, properties: { id: 'string' } } },
}
```

### `PropServiceDefHandlers` → `prop_service.def.handlers`
Side effects declared per action. Used by the worker for state routing.

```ts
{
  join:  { updates_state: [] },
  leave: { updates_state: [] },
}
```

---

## Runtime value types (stored as JSONB in the DB)

### `PropComponentStateFields` → `prop_component.state.fields`
Current values of `state_fields`. Written by action handlers, read on every render.

```ts
// ask-widget state row:
{ messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi!' }] }
```

### `PropComponentEventActionArgs` → `prop_component.event.action_args`
The args passed when an action was fired. Matches `contract.actions[n].args`.

```ts
// onSubmit fired:
{ question: 'what are your return policies?' }
```

### `PropComponentEventActionResult` → `prop_component.event.action_result`
The result returned by the action handler.

```ts
// onSubmit result:
{ answer: 'Returns are free within 30 days.' }
```

### `PropComponentSessionMetadata` → `prop_component.session.metadata`
Session context written when a real-time session starts and ends.

```ts
// race session metadata:
{ ticker: 'NVDA', players: ['user_1', 'user_2'], winner: 'user_1', duration_ms: 43200 }
```

---

## Top-level def and app objects

### `PropComponentDef` / `PropServiceDef`
The TypeScript representation of a `prop_component.def` or `prop_service.def` row.
Used in `interfaces/*.ts` with `satisfies` to preserve literal types.

```ts
export const realtimeSessionDef = { ... } satisfies PropServiceDef
export const askWidgetDef        = { ... } satisfies PropComponentDef
```

Both have: `def_id`, `slug`, `prop_type`, `owner_id`, `name`, `stage`, `contract`,
`contract_version`, `public_path`, `is_public`, `created_at`.

`PropComponentDef` additionally has `requires?: PropRequires` (top-level, not inside contract).
`PropServiceDef` additionally has `handlers: PropServiceDefHandlers`.

### `PropComponentApp`
The TypeScript representation of a deployed component app row.

```ts
// Component instance:
{ slug: 'my-store-help', config: { display_name: 'Store Help', ... } }  // PropComponentApp
```

#### Component code columns

| Column | What it holds | Who writes it | Who reads it |
|---|---|---|---|
| `component_src` | TypeScript/JSX — the component function | Builder in Monaco | Dev tooling, code-gen |
| `component_types_src` | TypeScript `.d.ts` — builder-defined types | Builder in Monaco | Worker → injected as virtual file in Monaco |
| `component_js` | Compiled JavaScript output | Build step (esbuild/tsc) | Browser at runtime via `useCompCache` |

`component_src` is what the builder edits. `component_js` is what the browser executes. The build step reads `component_src`, compiles it, and writes the result back to `component_js`. The browser never sees `component_src`.

### `prop_runtime_version` → `prop_component.app`

Records the contract_version when `component_js` was last compiled. If the contract changes
(state_fields, actions, routes), the injected props shape changes and the old `component_js` breaks.

```ts
// on load:
if (row.prop_runtime_version !== CURRENT_PROP_RUNTIME_VERSION) {
  component_js         = sucrase.transform(component_src)  // regenerate comment header + recompile
  prop_runtime_version = CURRENT_PROP_RUNTIME_VERSION
  // write back to DB
}

// find all stale rows after a runtime version bump:
SELECT app_id FROM prop_component.app
WHERE prop_runtime_version != '1.1'
  AND component_src IS NOT NULL
```

Changing `requires` (swapping `def_slug: 'llm-chat-openai'` → `'llm-chat-anthropic'`) does NOT
bump `contract_version` — requires is a separate top-level column, not part of `contract` JSONB.
No recompile triggered.

`component_types_src` is also builder-edited in Monaco (in a separate types tab). The worker serves it as a virtual `.d.ts` file so types defined there are available in `component_src` without any import statement.

---

## How the service PROP types connect

Four concepts that look related but operate at completely different layers:

| Type / field | Layer | Maps to | Concern |
|---|---|---|---|
| `PropServiceApi<T>` | Runtime | `api.[def_slug]` in component props | How to call the service (builder) |
| `def.contract_version` | Compilation | sha256 of component's own contract | Did the component interface change? |
| `app.prop_runtime_version` | Compilation | contract_version at last compile | Is `component_js` stale? |
| `requires` | Wiring | `prop_component.def.requires` top-level | Which PROPs are injected |

### `PropServiceApi<T>` — calling a service from a component

```ts
type LlmApi = PropServiceApi<typeof llmChatDef>
// → { chat: (args: { messages: any; systemPrompt: any }) => Promise<any> }
// maps to: runtime api['llm-chat-openai'] in component props
```

Builder concern. The IntelliSense type injected into Monaco when writing `api['llm-chat-openai'].chat(...)`.
Derived from `contract.actions`.

### `contract_version` / `prop_runtime_version` — compilation staleness

```
prop_component.def.contract_version      sha256 of component's own contract (state_fields, actions, routes)
prop_component.app.prop_runtime_version  contract_version when component_js was last compiled
mismatch → recompile
```

Compilation concern. Tracks whether `component_js` reflects the current injected props shape.
`requires` is a separate top-level column and does NOT affect `contract_version`. Swapping a
service def_slug (e.g. `llm-chat-openai` → `llm-chat-anthropic`) never triggers a recompile.
