import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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
}

const MODE_META = {
  sorcery: { label: 'Sorcery',   icon: '📖' },
  mtg:     { label: 'MTG Guide', icon: '📖' },
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

      const { data: { session } } = await supabase.auth.getSession()
      const fnRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rules-ai`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question, mode }),
      })
      const data = await fnRes.json()
      if (data?.error) throw new Error(data.error)
      if (!data?.answer && !data?.noMatch) throw new Error(`Unexpected response: ${JSON.stringify(data)}`)
      if (data.noMatch) {
        setMessages(prev => [...prev, {
          role:    'assistant',
          content: "I couldn't find relevant sections for that question. Try rephrasing, or check the official Sorcery rulebook directly.",
          error:   true,
        }])
        return
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, mode }])
      logQuestion(question, mode, data.answer)
      loadFaq(mode).then(setFaqQuestions)
    } catch (e) {
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: `Error: ${e?.message ?? 'Unknown error'}`,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36,
            background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))',
            borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>📖</div>
          <div>
            <div className="page-title">Rules Assistant</div>
            <div className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {mode === 'mtg' ? 'Answers tailored for MTG players' : 'Ask any question about Sorcery: Contested Realm rules'}
              <button
                onClick={() => switchMode(mode === 'mtg' ? 'sorcery' : 'mtg')}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--gold)', textDecoration: 'underline' }}
              >
                {mode === 'mtg' ? '← Back to Sorcery rules' : 'Coming from MTG?'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Chat window */}
      <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* Empty state */}
          {isEmpty && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {faqQuestions.length > 0 ? 'Most Asked' : 'Try asking'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 580 }}>
                {(faqQuestions.length > 0 ? faqQuestions.map(r => r.question) : SUGGESTED[mode]).map(q => (
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
              mode === 'mtg' ? 'Ask how a Sorcery mechanic relates to MTG… (Enter to send)'
                             : 'Ask a rules question… (Enter to send)'
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
        {mode === 'mtg'
          ? 'Sourced from the MTG-to-Sorcery guide · Always verify with official sources'
          : 'Sourced from the official Sorcery rulebook · Always verify with your playgroup'}
      </div>
    </div>
  )
}
