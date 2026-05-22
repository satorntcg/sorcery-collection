import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-void)',
    }}>
      <div style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48,
            background: 'linear-gradient(135deg, var(--gold-dim), var(--gold))',
            borderRadius: 10, display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 16px',
            fontFamily: 'var(--font-display)', fontSize: 22,
            fontWeight: 700, color: 'var(--bg-void)',
          }}>S</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '0.1em', color: 'var(--gold)' }}>
            SORCERY TCG
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Market Manager</div>
        </div>

        <div className="panel">
          <div className="panel-body">
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              {error && (
                <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
                  {error}
                </div>
              )}
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading || !email || !password}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}