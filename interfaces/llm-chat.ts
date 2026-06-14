import type { PropServiceDef } from './types.js'

// llm-chat — Service PROP
//
// Interface for LLM interaction. One contract, swappable providers.
// Change the app slug in your contract to switch LLM providers.
// Nothing else changes — not the component, not the handler call, not the state.

export const llmChatDef = {
  slug:  'llm-chat',
  prop_type: 'service',
  name:  'LLM Chat',
  stage: 'stable',
  contract: {
    config_fields: [
      { name: 'provider',    type: 'string', label: 'Provider (openai | anthropic | groq)' },
      { name: 'model',       type: 'string', label: 'Model ID' },
      { name: 'temperature', type: 'number', label: 'Temperature', default: 0.7 },
    ],
    actions: [
      {
        name:    'chat',
        args:    { messages: 'Array<{ role: string; content: string }>', systemPrompt: 'string' },
        returns: { answer: 'string' },
      },
    ],
  },
  handlers: {
    chat: { updates_state: [] },
  },
} satisfies PropServiceDef

// Implementations are separate defs: llm-chat-openai, llm-chat-anthropic

// Swap example — Ask Widget switching from OpenAI to Anthropic:
//
//   Before: { name: 'llm', def: 'llm-chat', app: 'openai-gpt4o-mini' }
//   After:  { name: 'llm', def: 'llm-chat', app: 'anthropic-haiku'   }
//
// Zero code changes. Same component, same onSubmit, same state shape.
