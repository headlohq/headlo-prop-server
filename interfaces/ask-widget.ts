import type { PropComponentDef, PropComponentApp } from './types.js'

// ask-widget — Component PROP
//
// A conversational chat widget. The builder writes a React component;
// the PROP worker stores message history and calls the LLM via the
// llm-chat service dependency.
//
// This is a component PROP — it has prop_component.app code.
// The LLM interaction is delegated to the llm-chat Service PROP,
// swappable by changing one field in the contract.

export const askWidgetDef = {
  slug:  'ask-widget',
  prop_type: 'component',
  name:  'Ask Widget',
  stage: 'stable',
  contract: {
    config_fields: [
      { name: 'display_name',    type: 'string', label: 'Widget name shown to visitors' },
      { name: 'tagline',         type: 'string', label: 'Subtitle text' },
      { name: 'accent_color',    type: 'string', label: 'Hex color for the send button' },
      { name: 'knowledge_scope', type: 'string', label: 'System prompt — what the assistant knows about' },
      { name: 'behavior',        type: 'string', label: 'full_page | modal' },
    ],
    state_fields: [
      { name: 'messages', type: 'Array<{ role: string; text: string }>', default: [] },
    ],
    actions: [
      {
        name:    'onSubmit',
        args:    { question: 'string' },
        returns: {},
        updates_state: ['messages'],
      },
    ],
  requires: {
    props: [
      { prop_type: 'service', def_slug: 'llm-chat-openai' },
    ],
    auto: true,
  },
  },
} satisfies PropComponentDef

// Each deployed widget is one prop_component.app row
export const askWidgetAppExample: PropComponentApp = {
  slug:   'my-store-help',
  config: {
    display_name:    'Store Help',
    tagline:         'Ask anything about our products',
    accent_color:    '#5dcaa5',
    knowledge_scope: 'You are a helpful assistant for an online store. Answer questions about products, shipping, and returns.',
    behavior:        'modal',
  },
}

// Component Contract — what the builder's React component receives:
//
//   function AskWidget({ widgetConfig, onSubmit, loading, messages }) { ... }
//
//   widgetConfig → prop_component.app.config
//   onSubmit     → fires POST /v1/component/ask-widget/:slug/onSubmit
//   loading      → true while the action is in-flight
//   messages     → prop_component.state.global_state.messages (server-persisted history)
