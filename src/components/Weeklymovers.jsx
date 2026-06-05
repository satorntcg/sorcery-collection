import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

const usd     = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPct  = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` }
const fmtChg  = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}` }
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function weekRange() {
  const end   = new Date()
  const start = new Date(end); start.setDate(end.getDate() - 7)
  const fmt   = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

export default function WeeklyMovers({ publicLinks = false }) {
  const [movers, setMovers]   = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const cardRef  = useRef(null)

  useEffect(() => {
    supabase.from('v_price_gainers_losers').select('*').then(async ({ data }) => {
      const rows = data ?? []
      if (rows.length > 0) {
        const ids = rows.map(r => r.card_id)
        const { data: owned } = await supabase.from('cards').select('id, quantity_owned').in('id', ids)
        const ownedMap = Object.fromEntries((owned ?? []).map(c => [c.id, c.quantity_owned]))
        setMovers(rows.map(r => ({ ...r, quantity_owned: ownedMap[r.card_id] ?? 0 })))
      } else {
        setMovers([])
      }
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
        onClick={() => navigate(publicLinks ? `/cards/${slugify(g.name)}/${g.card_id}` : `/market?card=${g.card_id}`)}
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
            {g.quantity_owned > 0 && (
              <span title={`You own ${g.quantity_owned}`} style={{
                fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: positive ? 'rgba(201,168,76,0.15)' : 'rgba(201,76,76,0.1)',
                color: positive ? 'var(--gold)' : 'var(--danger)',
                border: `1px solid ${positive ? 'rgba(201,168,76,0.35)' : 'rgba(201,76,76,0.3)'}`,
              }}>
                ×{g.quantity_owned}
              </span>
            )}
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
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => navigate(publicLinks ? '/cards' : '/market')}>
          {publicLinks ? 'All cards →' : 'Market →'}
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
