import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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

async function fetchChunks(embedding, filterSource, count) {
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
      match_count:     count,
      filter_source:   filterSource,
    }),
  })
  return res.json()
}

async function findChunks(question, mode) {
  const embedding = await getEmbedding(question)
  if (mode === 'compare') {
    const [sorcery, mtg] = await Promise.all([
      fetchChunks(embedding, 'rulebook',  3),
      fetchChunks(embedding, 'mtg_guide', 3),
    ])
    return { sorcery: sorcery ?? [], mtg: mtg ?? [] }
  }
  const source = mode === 'mtg' ? 'mtg_guide' : 'rulebook'
  const chunks  = await fetchChunks(embedding, source, 5)
  return { single: chunks ?? [] }
}

function buildSystemPrompt(mode, chunks) {
  if (mode === 'compare') {
    const sCtx = chunks.sorcery.length
      ? chunks.sorcery.map(c => c.content).join('\n\n---\n\n')
      : 'No relevant Sorcery rulebook excerpts found.'
    const mCtx = chunks.mtg.length
      ? chunks.mtg.map(c => c.content).join('\n\n---\n\n')
      : 'No relevant MTG comparison guide excerpts found.'
    return `You are an expert on both Magic: The Gathering and Sorcery: Contested Realm. Using ONLY the excerpts below, compare how this rule or mechanic works in Sorcery versus MTG. First explain the Sorcery rule, then how it compares to MTG. Be clear and concise. Use plain text only — no markdown headers or bullet symbols.

Sorcery rulebook excerpts:
${sCtx}

---

MTG comparison guide excerpts:
${mCtx}`
  }

  const context = chunks.single.map(c => c.content).join('\n\n---\n\n')

  if (mode === 'mtg') {
    return `You are an expert helping Magic: The Gathering players understand Sorcery: Contested Realm. Answer the player's question using ONLY the guide excerpts below. Highlight how mechanics relate to or differ from MTG where relevant. Be clear and concise. Use plain text only — no markdown headers or bullet symbols. If the answer isn't in the excerpts, say so honestly.

MTG-to-Sorcery guide excerpts:
${context}`
  }

  return `You are a Sorcery: Contested Realm rules expert. Answer the player's question using ONLY the rulebook excerpts below. Be clear and concise. Use plain text only — no markdown headers or bullet symbols. If the answer isn't in the excerpts, say so honestly and suggest they check the full rulebook.

Rulebook excerpts:
${context}`
}

async function askClaude(question, chunks, mode) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':                                 ANTHROPIC_KEY,
      'anthropic-version':                         '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type':                              'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     buildSystemPrompt(mode, chunks),
      messages:   [{ role: 'user', content: question }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.content[0].text
}

const SUGGESTED = {
  sorcery: [
    'How does intercept work?',
    "What happens at death's door?",
    'How does elemental threshold work?',
    'Can I carry multiple artifacts?',
    'What is the Move and Attack ability?',
    'How do sites work?',
  ],
  mtg: [
    'What is the MTG equivalent of a site?',
    'How does the avatar compare to a commander?',
    'How does mana work compared to MTG?',
    'What replaces tapping in Sorcery?',
    'How does combat differ from MTG?',
    'How do spells work differently?',
  ],
  compare: [
    'How does combat compare to MTG?',
    "How does death's door compare to life loss in MTG?",
    'How does the avatar compare to a planeswalker?',
    'How do sites compare to lands in MTG?',
    'How does the mana system compare?',
    'How does card advantage compare?',
  ],
}

const MODE_META = {
  sorcery: { label: 'Sorcery',   icon: '⚔️', subtitle: 'Ask about abilities, card types, game zones, turn structure — anything.' },
  mtg:     { label: 'MTG Guide', icon: '🃏', subtitle: 'Answers from the MTG-to-Sorcery guide for players coming from Magic.' },
  compare: { label: 'Compare',   icon: '⚖️', subtitle: 'Compare how rules and mechanics work in Sorcery versus Magic: The Gathering.' },
}

async function loadFaq(mode) {
  const { data } = await supabase
    .from('rules_questions')
    .select('question, count')
    .eq('source', mode)
    .order('count', { ascending: false })
    .limit(10)
  return data ?? []
}

async function checkCache(question, mode) {
  const { data } = await supabase
    .from('rules_questions')
    .select('cached_answer')
    .eq('question', question)
    .eq('source', mode)
    .not('cached_answer', 'is', null)
    .maybeSingle()
  return data?.cached_answer ?? null
}

function logQuestion(question, mode, answer = null) {
  supabase.rpc('log_rules_question', { q: question, src: mode, answer }).then(() => {})
}

export default function RulesChat() {
  const [messages,     setMessages]     = useState([])
  const [input,        setInput]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [mode,         setMode]         = useState('sorcery')
  const [faqQuestions, setFaqQuestions] = useState([])
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    loadFaq(mode).then(setFaqQuestions)
  }, [mode])

  async function sendMessage(text) {
    const question = (text || input).trim()
    if (!question || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setLoading(true)

    try {
      const cached = await checkCache(question, mode)
      if (cached) {
        setMessages(prev => [...prev, { role: 'assistant', content: cached, mode }])
        logQuestion(question, mode)
        loadFaq(mode).then(setFaqQuestions)
        return
      }

      const chunks  = await findChunks(question, mode)
      const noMatch = mode === 'compare'
        ? chunks.sorcery.length === 0 && chunks.mtg.length === 0
        : chunks.single.length === 0
      if (noMatch) {
        setMessages(prev => [...prev, {
          role:    'assistant',
          content: "I couldn't find relevant sections for that question. Try rephrasing, or check the official Sorcery rulebook directly.",
          error:   true,
        }])
        return
      }
      const answer = await askClaude(question, chunks, mode)
      setMessages(prev => [...prev, { role: 'assistant', content: answer, mode }])
      logQuestion(question, mode, answer)
      loadFaq(mode).then(setFaqQuestions)
    } catch {
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

  function switchMode(newMode) {
    setMode(newMode)
    setMessages([])
    setInput('')
  }

  const isEmpty = messages.length === 0
  const meta    = MODE_META[mode]

  return (
    <div className="page" style={{ maxWidth: 780, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
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

          {/* Source toggle */}
          <div style={{
            display: 'flex', gap: 2,
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 3,
          }}>
            {(['sorcery', 'mtg', 'compare']).map(m => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                style={{
                  padding:    '5px 14px',
                  fontSize:   12,
                  fontWeight: mode === m ? 600 : 400,
                  color:      mode === m ? 'var(--bg-void)' : 'var(--text-secondary)',
                  background: mode === m ? 'var(--gold)' : 'transparent',
                  border:     'none',
                  borderRadius: 'calc(var(--radius-sm) - 2px)',
                  cursor:     'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {MODE_META[m].label}
              </button>
            ))}
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
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.6 }}>{meta.icon}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--gold-light)', letterSpacing: '0.06em', marginBottom: 6 }}>
                  {mode === 'compare' ? 'Compare Rules' : mode === 'mtg' ? 'MTG Player Guide' : 'Ask the Oracle'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 360, lineHeight: 1.6 }}>
                  {meta.subtitle}
                </div>
              </div>

              {/* FAQ questions */}
              {faqQuestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%', maxWidth: 560 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Most Asked</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {faqQuestions.map(r => (
                      <button
                        key={r.question}
                        className="btn btn-ghost btn-sm"
                        onClick={() => sendMessage(r.question)}
                        style={{ fontSize: 12, borderColor: 'var(--border-mid)', display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {r.question}
                        {r.count > 1 && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-deep)', borderRadius: 8, padding: '1px 5px' }}>
                            {r.count}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested questions */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%', maxWidth: 560 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Suggested</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  {SUGGESTED[mode].map(q => (
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
                {msg.role === 'user' ? '👤' : (MODE_META[msg.mode] ?? MODE_META.sorcery).icon}
              </div>

              {/* Bubble */}
              <div style={{ maxWidth: '75%' }}>
                {msg.role === 'assistant' && msg.mode && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, paddingLeft: 2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {MODE_META[msg.mode].label}
                  </div>
                )}
                <div style={{
                  padding:      '10px 14px',
                  borderRadius: msg.role === 'user'
                    ? 'var(--radius-md) var(--radius-sm) var(--radius-md) var(--radius-md)'
                    : 'var(--radius-sm) var(--radius-md) var(--radius-md) var(--radius-md)',
                  background: msg.role === 'user' ? 'rgba(201,168,76,0.12)' : 'var(--bg-raised)',
                  border: `1px solid ${msg.role === 'user' ? 'var(--border-mid)' : 'var(--border)'}`,
                  fontSize:   13,
                  lineHeight: 1.65,
                  color: msg.error ? 'var(--text-muted)' : 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.content}
                </div>
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
              }}>
                {meta.icon}
              </div>
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--radius-sm) var(--radius-md) var(--radius-md) var(--radius-md)',
                background: 'var(--bg-raised)', border: '1px solid var(--border)',
                display: 'flex', gap: 5, alignItems: 'center',
              }}>
                {[0, 1, 2].map(j => (
                  <div key={j} style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--gold-dim)',
                    animation: `pulse 1.2s ease-in-out ${j * 0.2}s infinite`,
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
            placeholder={
              mode === 'compare' ? 'Ask to compare a rule or mechanic… (Enter to send)'
              : mode === 'mtg'   ? 'Ask how a Sorcery mechanic relates to MTG… (Enter to send)'
              :                    'Ask a rules question… (Enter to send)'
            }
            rows={1}
            style={{
              flex:       1,
              minHeight:  40,
              maxHeight:  120,
              resize:     'none',
              padding:    '9px 12px',
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
        {mode === 'compare'
          ? 'Comparing Sorcery rulebook and MTG guide · Always verify with official sources'
          : mode === 'mtg'
          ? 'Sourced from the MTG-to-Sorcery comparison guide · Always verify with official sources'
          : 'Answers sourced from the official Sorcery: Contested Realm rulebook · Always verify with your playgroup'}
      </div>
    </div>
  )
}
