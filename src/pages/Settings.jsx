import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const [schedule, setSchedule] = useState(null)
  const [form, setForm]         = useState({})
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [loading, setLoading]   = useState(true)

  // Listing sync state
  const [syncRunning,  setSyncRunning]  = useState(false)
  const [syncDiff,     setSyncDiff]     = useState(null)  // array of {id, name, stored, actual} or []
  const [syncApplying, setSyncApplying] = useState(false)
  const [syncDone,     setSyncDone]     = useState(false)

  async function runSync() {
    setSyncRunning(true)
    setSyncDiff(null)
    setSyncDone(false)

    // 1. All cards with stored counts
    const { data: cards } = await supabase
      .from('cards')
      .select('id, name, rarity, foil, quantity_owned, quantity_listed')

    // 2. Active single-card listings
    const { data: singleListings } = await supabase
      .from('ebay_listings')
      .select('card_id')
      .eq('status', 'active')
      .not('card_id', 'is', null)

    // 3. Active lot listing cards (via junction table)
    const { data: lotCards } = await supabase
      .from('ebay_listing_cards')
      .select('card_id, quantity, ebay_listings!listing_id(status)')

    // Build actual listed count map
    const actualMap = {}
    for (const l of (singleListings ?? [])) {
      actualMap[l.card_id] = (actualMap[l.card_id] ?? 0) + 1
    }
    for (const lc of (lotCards ?? [])) {
      if (lc.ebay_listings?.status === 'active' && lc.card_id) {
        actualMap[lc.card_id] = (actualMap[lc.card_id] ?? 0) + (lc.quantity ?? 1)
      }
    }

    // Find discrepancies in either quantity_listed or quantity_owned
    const diff = (cards ?? [])
      .map(c => {
        const storedListed = c.quantity_listed ?? 0
        const storedOwned  = c.quantity_owned  ?? 0
        const actualListed = actualMap[c.id]   ?? 0
        // If more are listed than owned, owned must also be bumped up
        const actualOwned  = Math.max(storedOwned, actualListed)
        return {
          id:           c.id,
          name:         c.name,
          rarity:       c.rarity,
          foil:         c.foil,
          storedListed,
          storedOwned,
          actualListed,
          actualOwned,
          listedFix:    storedListed !== actualListed,
          ownedFix:     storedOwned  !== actualOwned,
        }
      })
      .filter(c => c.listedFix || c.ownedFix)

    setSyncDiff(diff)
    setSyncRunning(false)
  }

  async function applySync() {
    if (!syncDiff?.length) return
    setSyncApplying(true)
    for (const c of syncDiff) {
      const updates = {}
      if (c.listedFix) updates.quantity_listed = c.actualListed
      if (c.ownedFix)  updates.quantity_owned  = c.actualOwned
      await supabase.from('cards').update(updates).eq('id', c.id)
    }
    setSyncApplying(false)
    setSyncDone(true)
    setSyncDiff([])
  }

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

      {/* ── Data maintenance ──────────────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Data maintenance</span>
        </div>
        <div className="panel-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.6 }}>
            Recalculates <code style={{ background: 'var(--bg-void)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>quantity_listed</code> on every card
            by counting actual active eBay listings. Run this if the Listing Suggestions page is showing cards that already have listings, or vice versa.
          </p>

          <button
            className="btn btn-ghost"
            onClick={runSync}
            disabled={syncRunning || syncApplying}
            style={{ marginBottom: syncDiff !== null ? 16 : 0 }}
          >
            {syncRunning ? 'Scanning listings…' : '⟳ Scan for discrepancies'}
          </button>

          {/* Results */}
          {syncDiff !== null && !syncRunning && (
            syncDiff.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--success)' }}>
                <span>✓</span>
                {syncDone ? 'All counts updated successfully.' : 'Everything is in sync — no changes needed.'}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {syncDiff.length} card{syncDiff.length !== 1 ? 's' : ''} out of sync:
                </div>
                <table className="data-table" style={{ marginBottom: 14 }}>
                  <thead>
                    <tr>
                      <th>Card</th>
                      <th className="text-right">qty_owned</th>
                      <th className="text-right">qty_listed</th>
                      <th>Fixes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncDiff.map(c => (
                      <tr key={c.id}>
                        <td>
                          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                            {c.name}{c.foil ? ' ✦' : ''}
                          </span>
                          {' '}
                          <span className={`badge badge-${c.rarity}`} style={{ fontSize: 10 }}>{c.rarity}</span>
                        </td>
                        <td className="text-right" style={{ fontSize: 12 }}>
                          {c.ownedFix
                            ? <><span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{c.storedOwned}</span>{' → '}<span style={{ color: 'var(--success)', fontWeight: 600 }}>{c.actualOwned}</span></>
                            : <span style={{ color: 'var(--text-muted)' }}>{c.storedOwned}</span>
                          }
                        </td>
                        <td className="text-right" style={{ fontSize: 12 }}>
                          {c.listedFix
                            ? <><span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{c.storedListed}</span>{' → '}<span style={{ color: 'var(--gold-light)', fontWeight: 600 }}>{c.actualListed}</span></>
                            : <span style={{ color: 'var(--text-muted)' }}>{c.storedListed}</span>
                          }
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {[c.ownedFix && 'owned', c.listedFix && 'listed'].filter(Boolean).join(' + ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn btn-primary"
                  onClick={applySync}
                  disabled={syncApplying}
                >
                  {syncApplying ? 'Applying…' : `Apply ${syncDiff.length} fix${syncDiff.length !== 1 ? 'es' : ''}`}
                </button>
              </div>
            )
          )}
        </div>
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
