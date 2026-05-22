import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const [schedule, setSchedule] = useState(null)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('check_schedule').select('*').single()
      setSchedule(data)
      setForm(data ?? {})
      setLoading(false)
    }
    load()
  }, [])

  const f = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked
      : e.target.type === 'number' ? Number(e.target.value)
      : e.target.value
    setForm(prev => ({ ...prev, [field]: val }))
  }

  async function save() {
    setSaving(true)
    await supabase.from('check_schedule').update(form).eq('id', schedule.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <div className="loading">Loading settings…</div>

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Price check schedule and alert thresholds</p>
      </div>

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Price check schedule</span>
        </div>
        <div className="panel-body">
          <div className="form-group">
            <label className="form-label">Frequency</label>
            <select className="form-select" value={form.frequency ?? 'daily'} onChange={f('frequency')}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Mondays)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Run at hour (UTC, 0–23)</label>
            <input className="form-input" type="number" min={0} max={23}
              value={form.run_at_hour ?? 6} onChange={f('run_at_hour')} style={{ maxWidth: 100 }} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              UTC hour — e.g. 6 = 6 AM UTC = 2 AM Eastern
            </p>
          </div>
        </div>
      </div>

      <div className="panel mt-16">
        <div className="panel-header">
          <span className="panel-title">Alert thresholds</span>
        </div>
        <div className="panel-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Alert if price rises more than (%)</label>
              <input className="form-input" type="number" step="1" min="1" max="100"
                value={form.alert_pct_up ?? 15} onChange={f('alert_pct_up')} />
            </div>
            <div className="form-group">
              <label className="form-label">Alert if price drops more than (%)</label>
              <input className="form-input" type="number" step="1" min="1" max="100"
                value={form.alert_pct_down ?? 15} onChange={f('alert_pct_down')} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Flag listing as stale after (days)</label>
            <input className="form-input" type="number" step="1" min="1"
              value={form.stale_days ?? 14} onChange={f('stale_days')} style={{ maxWidth: 120 }} />
          </div>
        </div>
      </div>

      <div className="panel mt-16">
        <div className="panel-header">
          <span className="panel-title">Email alerts</span>
        </div>
        <div className="panel-body">
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.email_alerts ?? true} onChange={f('email_alerts')} />
              <span className="form-label" style={{ margin: 0 }}>Enable email alerts</span>
            </label>
          </div>
          {form.email_alerts && (
            <div className="form-group">
              <label className="form-label">Alert email address</label>
              <input className="form-input" type="email"
                value={form.email_address ?? ''} onChange={f('email_address')}
                placeholder="satorntcg@gmail.com" style={{ maxWidth: 320 }} />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Must match your Resend account email if using the free tier.
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Saved</span>}
      </div>

      <div className="divider" />

      <div className="panel">
        <div className="panel-header"><span className="panel-title">Connection info</span></div>
        <div className="panel-body">
          {[
            ['Supabase URL', import.meta.env.VITE_SUPABASE_URL],
            ['Project ref', import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0] ?? '—'],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
