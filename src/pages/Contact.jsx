import { useState } from 'react'

const FORMSPREE_ID = import.meta.env.VITE_FORMSPREE_ID

export default function Contact() {
  const [fields,    setFields]    = useState({ name: '', email: '', subject: 'general', message: '' })
  const [status,    setStatus]    = useState('idle') // idle | sending | success | error
  const [errorMsg,  setErrorMsg]  = useState('')

  function set(key) {
    return e => setFields(prev => ({ ...prev, [key]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!FORMSPREE_ID) {
      setErrorMsg('Contact form is not configured yet. Please email contact@satorntcg.com directly.')
      setStatus('error')
      return
    }

    setStatus('sending')
    setErrorMsg('')

    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(fields),
      })
      if (res.ok) {
        setStatus('success')
        setFields({ name: '', email: '', subject: 'general', message: '' })
      } else {
        const data = await res.json()
        setErrorMsg(data?.errors?.[0]?.message ?? 'Submission failed. Please try again.')
        setStatus('error')
      }
    } catch {
      setErrorMsg('Network error. Please try again or email contact@satorntcg.com directly.')
      setStatus('error')
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '48px 24px' }}>

      <div style={{ marginBottom: 32 }}>
        <p style={{ textTransform: 'uppercase', color: 'var(--gold)', fontSize: 12, letterSpacing: '0.12em', marginBottom: 12 }}>
          Get in touch
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(24px, 4vw, 36px)', color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: 12 }}>
          Contact Us
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7 }}>
          Questions about cards, listings, or the site? We'd love to hear from you.
        </p>
      </div>

      {status === 'success' ? (
        <div className="panel" style={{ padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--gold-light)', marginBottom: 8 }}>
            Message Sent
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
            Thanks for reaching out! We'll get back to you at {fields.email || 'your email'} as soon as possible.
          </p>
          <button className="btn btn-ghost btn-sm" onClick={() => setStatus('idle')}>
            Send another message
          </button>
        </div>
      ) : (
        <div className="panel" style={{ padding: '28px 24px' }}>
          <form onSubmit={handleSubmit}>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  type="text"
                  value={fields.name}
                  onChange={set('name')}
                  placeholder="Your name"
                  required
                />
              </div>
              <div>
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={fields.email}
                  onChange={set('email')}
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Subject</label>
              <select className="form-select" value={fields.subject} onChange={set('subject')} style={{ width: '100%' }}>
                <option value="general">General enquiry</option>
                <option value="buying">Buying a card</option>
                <option value="rules">Rules question</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label className="form-label">Message</label>
              <textarea
                className="form-textarea"
                value={fields.message}
                onChange={set('message')}
                placeholder="What's on your mind?"
                rows={5}
                required
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>

            {status === 'error' && (
              <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 14 }}>
                {errorMsg}
              </div>
            )}

            <button
              className="btn btn-primary"
              type="submit"
              disabled={status === 'sending' || !fields.name || !fields.email || !fields.message}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {status === 'sending' ? 'Sending…' : 'Send Message'}
            </button>

          </form>
        </div>
      )}

      <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
        Or email us directly at{' '}
        <a href="mailto:contact@satorntcg.com" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
          contact@satorntcg.com
        </a>
      </p>

    </div>
  )
}
