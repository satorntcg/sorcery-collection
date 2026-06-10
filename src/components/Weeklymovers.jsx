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

export default function WeeklyMovers({ publicLinks = false, onSelect }) {
  const [movers, setMovers]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [foilFilter, setFoil]   = useState('nonfoil')
  const [setFilter, setSetFilter] = useState('Gothic')
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

  const sets = [...new Set(movers.map(m => m.set_name).filter(Boolean))].sort()

  const filtered = movers
    .filter(m => foilFilter === 'foil' ? m.foil : !m.foil)
    .filter(m => setFilter ? m.set_name === setFilter : true)

  const gainers = filtered.filter(g => g.pct_change > 0).slice(0, 10)
  const losers  = filtered.filter(g => g.pct_change < 0).slice(0, 10)

  if (!gainers.length && !losers.length && !movers.length) return null

  const moverIcon = (g) => {
    const pct = Math.abs(Number(g.pct_change))
    const chg = Math.abs(Number(g.current_price) - Number(g.price_7d_ago))
    if (g.pct_change > 0) {
      if (pct > 20 || chg > 5)  return '🔥'
      if (pct >= 10)             return '📈'
    } else {
      if (pct > 15 || chg > 10) return '💀'
      if (pct >= 10)             return '📉'
    }
    return null
  }

  const MoverRow = ({ g, positive, hideOwned }) => {
    const change = (Number(g.current_price) - Number(g.price_7d_ago))
    const icon = moverIcon(g)
    return (
      <div
        onClick={() => onSelect ? onSelect(g.card_id, g.name, g) : navigate(`/cards/${slugify(g.name)}/${g.card_id}`)}
        style={{
          display: 'grid', gridTemplateColumns: '1fr auto auto',
          alignItems: 'center', gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          cursor: 'pointer',
          transition: 'background var(--transition)',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
            <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)' }}>
              {g.name}{g.foil ? ' ✦' : ''}
            </span>
            {!hideOwned && g.quantity_owned > 0 && (
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
        <span className={`badge badge-${g.rarity}`} style={{ fontSize: 10, justifySelf: 'center' }}>{g.rarity}</span>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="panel-title">Weekly Price Movers</span>
          <span
            title="Market Price reflects the rolling average of recent completed sales on TCGplayer, not current listing prices. Low-volume cards may lag behind actual sale activity."
            style={{ cursor: 'help', opacity: 0.5, fontSize: 11 }}
          >ⓘ</span>
          <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-muted)' }}>{weekRange()}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            className="form-select"
            value={setFilter}
            onChange={e => setSetFilter(e.target.value)}
            style={{ fontSize: 11, padding: '3px 8px', height: 26 }}
          >
            <option value="">All Sets</option>
            {sets.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 6, padding: 2, gap: 2, flexShrink: 0 }}>
            {[['nonfoil', 'Non-Foil'], ['foil', '✦ Foil']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFoil(val)}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '3px 12px', borderRadius: 4, border: 'none',
                  cursor: 'pointer', letterSpacing: '0.03em', whiteSpace: 'nowrap',
                  background: foilFilter === val ? 'var(--bg-card)' : 'transparent',
                  color: foilFilter === val ? 'var(--gold)' : 'var(--text-muted)',
                  boxShadow: foilFilter === val ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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
            : gainers.map(g => <MoverRow key={g.card_id} g={g} positive={true} hideOwned={publicLinks} />)
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
            : losers.map(g => <MoverRow key={g.card_id} g={g} positive={false} hideOwned={publicLinks} />)
          }
        </div>
      </div>

      {/* Watermark footer for screenshots */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7,
        padding: '7px 14px', borderTop: '1px solid var(--border)',
        opacity: 0.55,
      }}>
        <img src="/favicon.png" alt="" width={16} height={16} style={{ borderRadius: 3, display: 'block' }} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-muted)', fontFamily: 'var(--font-display, Cinzel, serif)' }}>
          SatornTCG
        </span>
      </div>
    </div>
  )
}
