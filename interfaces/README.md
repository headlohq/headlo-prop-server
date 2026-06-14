# interfaces/

Human-readable specs for every PROP interface in this server.

The SQL files in `../sql/` are the source of truth for the database. These `.js` files are the same information in a format that's easier to read, review, and copy from.

## UAL — Universal Abstraction Layer

| File | Kind | Stage | What it does |
|---|---|---|---|
| [types.ts](types.ts) | — | — | Shared TypeScript types: PropDef, PropApp, PropContract, PropAction, … |
| [llm-chat.ts](llm-chat.ts) | service | Stable | LLM chat — swap OpenAI / Anthropic / Groq |
| [auth.ts](auth.ts) | service | Draft | Token validation — swap Clerk / Supabase / JWT |
| [external-api.ts](external-api.ts) | service | Draft | REST API proxy — keys stay server-side |
| [realtime-session.ts](realtime-session.ts) | service | Draft | WebSocket rooms — swap CF DO / Ably / Soketi |
| [ask-widget.ts](ask-widget.ts) | ui | Stable | Conversational chat widget |

**Draft** = one real implementation, contract may change.  
**Stable** = 2+ implementations, safe to build on.

Want to add a new implementation or propose a new interface? See [docs/contributing.md](../docs/contributing.md).
