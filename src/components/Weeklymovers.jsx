import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

const usd    = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPct = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` }
const fmtChg = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}` }

function weekRange() {
  const end   = new Date()
  const start = new Date(end); start.setDate(end.getDate() - 7)
  const fmt   = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

export default function WeeklyMovers() {
  const [movers, setMovers]   = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const cardRef  = useRef(null)

  useEffect(() => {
    supabase.from('v_price_gainers_losers').select('*').then(({ data }) => {
      setMovers(data ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) return null

  const gainers = movers.filter(g => g.pct_change > 0).slice(0, 10)
  const losers  = movers.filter(g => g.pct_change < 0).slice(0, 10)

  if (!gainers.length && !losers.length) return null

  const MoverRow = ({ g, positive }) => {
    const change = (Number(g.current_price) - Number(g.price_7d_ago))
    return (
      <div
        onClick={() => navigate(`/market?card=${g.card_id}`)}
        style={{
          display: 'grid', gridTemplateColumns: '1fr auto',
          alignItems: 'center', gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          cursor: 'pointer',
          transition: 'background var(--transition)',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)' }}>
              {g.name}{g.foil ? ' ✦' : ''}
            </span>
            <span className={`badge badge-${g.rarity}`} style={{ fontSize: 10 }}>{g.rarity}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {usd(g.price_7d_ago)} → {usd(g.current_price)}
            <span style={{ marginLeft: 6, color: positive ? 'var(--success)' : 'var(--danger)' }}>
              ({fmtChg(change)})
            </span>
          </div>
        </div>
        <div style={{
          fontSize: 16, fontWeight: 600, minWidth: 64, textAlign: 'right',
          color: positive ? 'var(--success)' : 'var(--danger)',
        }}>
          {fmtPct(g.pct_change)}
        </div>
      </div>
    )
  }

  return (
    <div ref={cardRef} className="panel" style={{ marginBottom: 24 }}>
      <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <span className="panel-title">Weekly Price Movers</span>
          <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-muted)' }}>{weekRange()}</span>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => navigate('/market')}>
          Market →
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {/* Gainers */}
        <div style={{ borderRight: '1px solid var(--border)' }}>
          <div style={{
            padding: '8px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--success)',
            borderBottom: '1px solid var(--border)', background: 'rgba(76,175,110,0.04)',
          }}>
            ▲ Top Gainers
          </div>
          {gainers.length === 0
            ? <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)' }}>No gainers this week</div>
            : gainers.map(g => <MoverRow key={g.card_id} g={g} positive={true} />)
          }
        </div>

        {/* Losers */}
        <div>
          <div style={{
            padding: '8px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--danger)',
            borderBottom: '1px solid var(--border)', background: 'rgba(211,77,77,0.04)',
          }}>
            ▼ Top Losers
          </div>
          {losers.length === 0
            ? <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)' }}>No losers this week</div>
            : losers.map(g => <MoverRow key={g.card_id} g={g} positive={false} />)
          }
        </div>
      </div>
    </div>
  )
}
