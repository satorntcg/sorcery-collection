import { useState, useRef, useEffect } from 'react'

const OPENAI_KEY    = import.meta.env.VITE_OPENAI_KEY
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

async function getEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-ada-002', input: text }),
  })
  const data = await res.json()
  if (!data.data) throw new Error('Embedding failed')
  return data.data[0].embedding
}

async function findChunks(question) {
  const embedding = await getEmbedding(question)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_documents`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON}`,
      'apikey':        SUPABASE_ANON,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      query_embedding: embedding,
      match_threshold: 0.65,
      match_count:     4,
      filter_source:   'rulebook',
    }),
  })
  return res.json()
}

async function askClaude(question, chunks) {
  const context = chunks.map(c => c.content).join('\n\n---\n\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':                            ANTHROPIC_KEY,
      'anthropic-version':                    '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type':                         'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are a Sorcery: Contested Realm rules expert. Answer the player's question using ONLY the rulebook excerpts below. Be clear and concise. Use plain text only — no markdown headers or bullet symbols. If the answer isn't in the excerpts, say so honestly and suggest they check the full rulebook.

Rulebook excerpts:
${context}`,
      messages: [{ role: 'user', content: question }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.content[0].text
}

const SUGGESTED = [
  'How does intercept work?',
  "What happens at death's door?",
  'How does elemental threshold work?',
  'Can I carry multiple artifacts?',
  'What is the Move and Attack ability?',
  'How do sites work?',
]

export default function RulesChat() {
  const [messages, setMessages] = useState([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(text) {
    const question = (text || input).trim()
    if (!question || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setLoading(true)

    try {
      const chunks = await findChunks(question)
      if (!chunks || chunks.length === 0) {
        setMessages(prev => [...prev, {
          role:    'assistant',
          content: "I couldn't find relevant rulebook sections for that question. Try rephrasing, or check the official Sorcery rulebook directly.",
          error:   true,
        }])
        return
      }
      const answer = await askClaude(question, chunks)
      setMessages(prev => [...prev, { role: 'assistant', content: answer }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: 'Something went wrong. Please try again.',
        error:   true,
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="page" style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36,
            background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))',
            borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>📖</div>
          <div>
            <div className="page-title">Rules Oracle</div>
            <div className="page-subtitle">Ask any question about Sorcery: Contested Realm rules</div>
          </div>
        </div>
      </div>

      {/* Chat window */}
      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Empty state */}
          {isEmpty && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.6 }}>⚔️</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--gold-light)', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Ask the Oracle
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 360, lineHeight: 1.6 }}>
                  Powered by the official Sorcery rulebook. Ask about abilities, card types, game zones, turn structure — anything.
                </div>
              </div>

              {/* Suggested questions */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 560 }}>
                {SUGGESTED.map(q => (
                  <button
                    key={q}
                    className="btn btn-ghost btn-sm"
                    onClick={() => sendMessage(q)}
                    style={{ fontSize: 12, borderColor: 'var(--border-mid)' }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display:       'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                gap:           10,
                marginBottom:  16,
                alignItems:    'flex-start',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13,
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, var(--gold-dim), var(--gold))'
                  : 'var(--bg-raised)',
                border: msg.role === 'assistant' ? '1px solid var(--border-mid)' : 'none',
                color: msg.role === 'user' ? 'var(--bg-void)' : 'var(--gold)',
              }}>
                {msg.role === 'user' ? '👤' : '📖'}
              </div>

              {/* Bubble */}
              <div style={{
                maxWidth:     '75%',
                padding:      '10px 14px',
                borderRadius: msg.role === 'user'
                  ? 'var(--radius-md) var(--radius-sm) var(--radius-md) var(--radius-md)'
                  : 'var(--radius-sm) var(--radius-md) var(--radius-md) var(--radius-md)',
                background: msg.role === 'user'
                  ? 'rgba(201,168,76,0.12)'
                  : 'var(--bg-raised)',
                border: `1px solid ${msg.role === 'user' ? 'var(--border-mid)' : 'var(--border)'}`,
                fontSize:   13,
                lineHeight: 1.65,
                color: msg.error ? 'var(--text-muted)' : 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, background: 'var(--bg-raised)',
                border: '1px solid var(--border-mid)', color: 'var(--gold)',
              }}>📖</div>
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--radius-sm) var(--radius-md) var(--radius-md) var(--radius-md)',
                background: 'var(--bg-raised)', border: '1px solid var(--border)',
                display: 'flex', gap: 5, alignItems: 'center',
              }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--gold-dim)',
                    animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          padding:    '14px 20px',
          borderTop:  '1px solid var(--border)',
          display:    'flex',
          gap:        10,
          alignItems: 'flex-end',
          background: 'var(--bg-deep)',
        }}>
          <textarea
            ref={inputRef}
            className="form-textarea"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask a rules question… (Enter to send)"
            rows={1}
            style={{
              flex:      1,
              minHeight: 40,
              maxHeight: 120,
              resize:    'none',
              padding:   '9px 12px',
              lineHeight: 1.5,
            }}
          />
          <button
            className="btn btn-primary"
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            style={{ height: 40, paddingLeft: 18, paddingRight: 18, flexShrink: 0 }}
          >
            {loading ? '…' : 'Ask'}
          </button>
        </div>
      </div>

      {/* Footer note */}
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        Answers sourced from the official Sorcery: Contested Realm rulebook · Always verify with your playgroup
      </div>
    </div>
  )
}