import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const usd = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—'

const TYPE_META = {
  price_spike:   { label: 'Price spike',   icon: '📈', cls: 'success' },
  price_drop:    { label: 'Price drop',    icon: '📉', cls: 'warning' },
  listing_stale: { label: 'Stale listing', icon: '⏰', cls: 'warning' },
  overpriced:    { label: 'Overpriced',    icon: '⚠️', cls: 'warning' },
  underpriced:   { label: 'Underpriced',   icon: '💡', cls: 'success' },
}

export default function Alerts({ onDismiss }) {
  const [alerts, setAlerts]   = useState([])
  const [loading, setLoading] = useState(true)
  const [showDismissed, setShowDismissed] = useState(false)

  async function load() {
    setLoading(true)
    let q = supabase.from('v_active_alerts').select('*').order('created_at', { ascending: false })
    if (!showDismissed) q = supabase
      .from('price_alerts')
      .select(`*, cards(name, set_name, rarity, image_url)`)
      .eq('dismissed', false)
      .order('created_at', { ascending: false })
    const { data } = await q
    setAlerts(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [showDismissed])

  async function dismiss(id) {
    await supabase.from('price_alerts').update({ dismissed: true }).eq('id', id)
    setAlerts(prev => prev.filter(a => a.id !== id))
    onDismiss?.()
  }

  async function dismissAll() {
    const ids = alerts.map(a => a.id)
    await supabase.from('price_alerts').update({ dismissed: true }).in('id', ids)
    setAlerts([])
  }

  return (
    <div className="page">
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Price Alerts</h1>
          <p className="page-subtitle">{alerts.length} active alert{alerts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-8">
          {alerts.length > 1 && (
            <button className="btn" onClick={dismissAll}>Dismiss all</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading alerts…</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">✓</div>
          No active alerts — your prices look healthy.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {alerts.map(alert => {
            const meta = TYPE_META[alert.alert_type] ?? { label: alert.alert_type, icon: '🔔', cls: 'warning' }
            const cardName = alert.card_name ?? alert.cards?.name
            const setName  = alert.set_name  ?? alert.cards?.set_name
            const pctChange = alert.pct_change

            return (
              <div key={alert.id} className="panel" style={{ display: 'flex', alignItems: 'stretch' }}>
                {/* Color bar */}
                <div style={{
                  width: 4, flexShrink: 0,
                  background: meta.cls === 'success' ? 'var(--success)' : 'var(--warning)',
                  borderRadius: 'var(--radius-lg) 0 0 var(--radius-lg)',
                }} />

                <div style={{ flex: 1, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  {/* Icon */}
                  <span style={{ fontSize: 24, flexShrink: 0 }}>{meta.icon}</span>

                  {/* Content */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: 14 }}>{cardName}</span>
                      <span className={`badge badge-${meta.cls === 'success' ? 'ok' : 'alert'}`}>{meta.label}</span>
                      {setName && <span className="text-muted" style={{ fontSize: 12 }}>{setName}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{alert.message}</div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 20, fontSize: 12, color: 'var(--text-muted)' }}>
                      {alert.old_price && <span>Was: {usd(alert.old_price)}</span>}
                      {alert.new_price && <span>Now: {usd(alert.new_price)}</span>}
                      {alert.your_list_price && <span>Your listing: {usd(alert.your_list_price)}</span>}
                      {pctChange != null && (
                        <span className={pctChange > 0 ? 'text-success' : 'text-danger'}>
                          {pctChange > 0 ? '↑' : '↓'} {Math.abs(pctChange).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => dismiss(alert.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
