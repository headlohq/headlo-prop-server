// llm-chat handler — dispatches to OpenAI or Anthropic based on config.provider.
// The contract is identical for both: chat({ messages, systemPrompt }) → { answer }
// Swap the implementation by changing prop.app.config.provider — nothing else changes.

export async function chat({ args, config }) {
  const { messages, systemPrompt } = args
  const { provider, model, temperature = 0.7 } = config

  if (provider === 'openai')    return chatOpenAI({ messages, systemPrompt, model, temperature })
  if (provider === 'anthropic') return chatAnthropic({ messages, systemPrompt, model, temperature })

  throw new Error(`Unknown provider: ${provider}. Use 'openai' or 'anthropic'.`)
}

// ── OpenAI ────────────────────────────────────────────────────

async function chatOpenAI({ messages, systemPrompt, model, temperature }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    }),
  })

  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`)
  const data = await res.json()
  return { answer: data.choices[0].message.content.trim() }
}

// ── Anthropic ─────────────────────────────────────────────────

async function chatAnthropic({ messages, systemPrompt, model, temperature }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature,
      system: systemPrompt,
      messages,
    }),
  })

  if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`)
  const data = await res.json()
  return { answer: data.content[0].text.trim() }
}
