// Ask Widget action handler
// Implements the onSubmit action defined in prop.def.handlers.
// Calls OpenAI with the full message history and returns the updated messages array.

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

export async function onSubmit({ args, state }) {
  const { question } = args
  const history = state.messages || []
  const model = 'gpt-4o-mini'

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const openaiMessages = [
    ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: question },
  ]

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, messages: openaiMessages }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI error: ${err}`)
  }

  const data = await res.json()
  const answer = data.choices?.[0]?.message?.content?.trim() || ''

  const messages = [
    ...history,
    { role: 'user',      text: question },
    { role: 'assistant', text: answer   },
  ]

  // Return the fields listed in prop.def.handlers.onSubmit.updates_state
  return { messages }
}
