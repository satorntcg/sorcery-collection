// ── WeeklyMovers widget ──────────────────────────────────────
// Add this component to Dashboard.jsx and include it in the dashboard layout.
// Import: import WeeklyMovers from '../components/WeeklyMovers'  (or inline below)
// Usage:  <WeeklyMovers />

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

const usd    = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPct = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` }

export default function WeeklyMovers() {
  const [gainers, setGainers] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.from('v_price_gainers_losers').select('*').then(({ data }) => {
      setGainers(data ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) return null

  const top5Gainers = gainers.filter(g => g.pct_change > 0).slice(0, 5)
  const top5Losers  = gainers.filter(g => g.pct_change < 0).slice(0, 5)

  if (!top5Gainers.length && !top5Losers.length) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
      {[
        { label: 'Top gainers this week', items: top5Gainers, positive: true },
        { label: 'Top losers this week',  items: top5Losers,  positive: false },
      ].map(({ label, items, positive }) => (
        <div key={label} className="panel">
          <div className="panel-header">
            <span className="panel-title">{label}</span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              onClick={() => navigate('/alerts')}
            >
              View all →
            </button>
          </div>
          {items.length === 0 ? (
            <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-muted)' }}>No data yet</div>
          ) : (
            <table className="data-table">
              <tbody>
                {items.map(g => (
                  <tr key={g.card_id}>
                    <td>
                      <div className="name-cell" style={{ fontSize: 13 }}>{g.name}{g.foil ? ' ✦' : ''}</div>
                      <div className="set-cell">{g.rarity}</div>
                    </td>
                    <td className="text-right text-muted" style={{ fontSize: 12 }}>{usd(g.price_7d_ago)}</td>
                    <td className="text-right" style={{ fontSize: 13 }}>{usd(g.current_price)}</td>
                    <td className="text-right" style={{
                      fontWeight: 500, fontSize: 13,
                      color: positive ? 'var(--success)' : 'var(--danger)',
                    }}>
                      {fmtPct(g.pct_change)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}