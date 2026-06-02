import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const usd    = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPnl = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+$' : '-$'}${Math.abs(v).toFixed(2)}` }
const fmtPct = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` }
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const daysAgo  = (d) => {
  if (!d) return ''
  const days = Math.round((Date.now() - new Date(d).getTime()) / 86400000)
  return days === 1 ? '1d ago' : `${days}d ago`
}

const TABS = [
  { id: 'price_alerts', label: 'Price alerts'    },
  { id: 'gainers',      label: 'Top movers'      },
  { id: 'listings',     label: 'Listing alerts'  },
  { id: 'stale',        label: 'Stale listings'  },
]

export default function Alerts({ onDismiss }) {
  const navigate = useNavigate()
  const [tab, setTab]                   = useState('price_alerts')
  const [alerts, setAlerts]             = useState([])
  const [gainers, setGainers]           = useState([])
  const [listingAlerts, setListingAlerts] = useState([])
  const [staleListings, setStaleListings] = useState([])
  const [loading, setLoading]           = useState(true)
  const [counts, setCounts]             = useState({})

  async function loadAll() {
    setLoading(true)
    const [alertRes, gainerRes, listingRes, staleRes, ebayRes] = await Promise.all([
      supabase.from('v_active_alerts').select('*'),
      supabase.from('v_price_gainers_losers').select('*'),
      supabase.from('v_listing_price_alerts').select('*'),
      supabase.from('v_stale_listings').select('*'),
      supabase.from('ebay_listings').select('id, card_id, ebay_url').eq('status', 'active').not('card_id', 'is', null),
    ])

    // Build map of card_id -> { listing_id, ebay_url } for active single-card listings
    const ebayByCard = {}
    for (const l of (ebayRes.data ?? [])) {
      if (!ebayByCard[l.card_id]) ebayByCard[l.card_id] = { listing_id: l.id, ebay_url: l.ebay_url }
    }

    const alertsWithLinks = (alertRes.data ?? [])
      .map(a => ({ ...a, ...(ebayByCard[a.card_id] ?? {}) }))
      .filter(a => (a.new_price ?? 0) >= 1)

    setAlerts(alertsWithLinks)
    setGainers(gainerRes.data ?? [])
    setListingAlerts(listingRes.data ?? [])
    setStaleListings(staleRes.data ?? [])
    setCounts({
      price_alerts: alertsWithLinks.length,
      gainers:      (gainerRes.data ?? []).length,
      listings:     (listingRes.data ?? []).length,
      stale:        (staleRes.data ?? []).length,
    })
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  async function dismiss(id) {
    await supabase.from('price_alerts').update({ dismissed: true }).eq('id', id)
    setAlerts(prev => prev.filter(a => a.id !== id))
    if (onDismiss) onDismiss()
  }

  const tabStyle = (id) => ({
    padding: '8px 14px', fontSize: 13, cursor: 'pointer',
    fontWeight: tab === id ? 500 : 400,
    color: tab === id ? 'var(--text-primary)' : 'var(--text-secondary)',
    background: tab === id ? 'var(--bg-card)' : 'transparent',
    border: '1px solid',
    borderColor: tab === id ? 'var(--border-mid)' : 'transparent',
    borderRadius: 'var(--radius-sm)',
    position: 'relative',
  })

  const Badge = ({ count }) => count > 0 ? (
    <span style={{
      marginLeft: 6, fontSize: 10, fontWeight: 600,
      background: 'var(--danger-bg)', color: 'var(--danger)',
      border: '1px solid rgba(201,76,76,0.3)',
      borderRadius: 10, padding: '1px 6px',
    }}>{count}</span>
  ) : null

  if (loading) return <div className="page"><div className="loading">Loading alerts…</div></div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Alerts</h1>
        <p className="page-subtitle">Price movements, listing health, and sell signals</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t.id} style={tabStyle(t.id)} onClick={() => setTab(t.id)}>
            {t.label}
            <Badge count={counts[t.id]} />
          </button>
        ))}
      </div>

      {/* ── Price alerts tab ── */}
      {tab === 'price_alerts' && (
        alerts.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">✓</div>No active price alerts.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map(a => (
              <div key={a.id} className={`alert-item ${a.alert_type === 'price_spike' ? 'success' : 'danger'}`}>
                <span className="alert-icon">{a.alert_type === 'price_spike' ? '↑' : '↓'}</span>
                <div className="alert-content">
                  <div className="alert-title">{a.card_name}{a.foil ? ' ✦' : ''} — {a.set_name}</div>
                  <div className="alert-desc">{a.message}</div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(a.created_at)}</span>
                    {a.listing_id && (
                      <button onClick={() => navigate(`/listings?highlight=${a.listing_id}`)} style={{ fontSize: 11, color: 'var(--gold)', background: 'none', border: 'none', borderBottom: '1px dashed var(--gold)', padding: 0, cursor: 'pointer' }}>View listing &rarr;</button>
                    )}
                    {a.ebay_url && (
                      <a href={a.ebay_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}>
                        eBay ↗
                      </a>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 16, fontWeight: 500, color: a.alert_type === 'price_spike' ? 'var(--success)' : 'var(--danger)' }}>
                    {fmtPct(a.pct_change)}
                  </span>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {usd(a.old_price)} → {usd(a.new_price)}
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => dismiss(a.id)}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Weekly movers tab ── */}
      {tab === 'gainers' && (
        gainers.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">📊</div>No significant movers yet — cards need 7 days of price history and a 10%+ change to appear here.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Top 10 gainers */}
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Top gainers
              </h3>
              <div className="panel">
                <table className="data-table">
                  <thead><tr>
                    <th>Card</th>
                    <th className="text-right">Prev</th>
                    <th className="text-right">Now</th>
                    <th className="text-right">Change</th>
                  </tr></thead>
                  <tbody>
                    {gainers.filter(g => g.pct_change > 0).slice(0, 10).map(g => (
                      <tr key={g.card_id}>
                        <td>
                          <div className="name-cell">{g.name}{g.foil ? ' ✦' : ''}</div>
                          <div className="set-cell">{g.rarity} · {g.set_name}{g.compared_from ? <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 10 }}>vs {daysAgo(g.compared_from)}</span> : ''}</div>
                        </td>
                        <td className="text-right text-muted">{usd(g.price_7d_ago)}</td>
                        <td className="text-right">{usd(g.current_price)}</td>
                        <td className="text-right" style={{ color: 'var(--success)', fontWeight: 500 }}>{fmtPct(g.pct_change)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Top 10 losers */}
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Top losers
              </h3>
              <div className="panel">
                <table className="data-table">
                  <thead><tr>
                    <th>Card</th>
                    <th className="text-right">Prev</th>
                    <th className="text-right">Now</th>
                    <th className="text-right">Change</th>
                  </tr></thead>
                  <tbody>
                    {gainers.filter(g => g.pct_change < 0).slice(0, 10).map(g => (
                      <tr key={g.card_id}>
                        <td>
                          <div className="name-cell">{g.name}{g.foil ? ' ✦' : ''}</div>
                          <div className="set-cell">{g.rarity} · {g.set_name}{g.compared_from ? <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 10 }}>vs {daysAgo(g.compared_from)}</span> : ''}</div>
                        </td>
                        <td className="text-right text-muted">{usd(g.price_7d_ago)}</td>
                        <td className="text-right">{usd(g.current_price)}</td>
                        <td className="text-right" style={{ color: 'var(--danger)', fontWeight: 500 }}>{fmtPct(g.pct_change)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Listing alerts tab ── */}
      {tab === 'listings' && (
        listingAlerts.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">✓</div>All active listings are priced within 10% of TCGPlayer market.</div>
        ) : (
          <div>
            <div style={{
              fontSize: 12, color: 'var(--text-muted)', marginBottom: 12,
              padding: '8px 12px', background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ opacity: 0.5 }}>ⓘ</span>
              Gap = listed price vs TCGPlayer market. Listings are flagged when listed price is more than 10% above or below market.
            </div>
            <div className="panel">
              <table className="data-table">
                <thead><tr>
                  <th>Listing</th>
                  <th>Type</th>
                  <th className="text-right">Listed</th>
                  <th className="text-right">TCG market</th>
                  <th className="text-right">Gap</th>
                  <th>Action</th>
                </tr></thead>
                <tbody>
                  {[...listingAlerts].sort((a, b) => Math.abs(b.overpriced_pct) - Math.abs(a.overpriced_pct)).map(l => (
                    <tr key={l.listing_id}>
                      <td>
                        <div className="name-cell">{l.card_name || l.title}</div>
                        <div className="set-cell">{l.rarity}{l.foil ? ' · Foil' : ''}{l.set_name ? ` · ${l.set_name}` : ''}</div>
                        {l.card_breakdown && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{l.card_breakdown}</div>}
                        <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                          <button onClick={() => navigate(`/listings?highlight=${l.listing_id}`)} style={{ fontSize: 11, color: 'var(--gold)', background: 'none', border: 'none', borderBottom: '1px dashed var(--gold)', padding: 0, cursor: 'pointer' }}>View listing &rarr;</button>
                          {l.ebay_url && (
                            <a href={l.ebay_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}>
                              eBay ↗
                            </a>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${l.alert_type === 'overpriced' ? 'badge-ok' : 'badge-alert'}`}>
                          {l.alert_type === 'overpriced' ? 'Overpriced' : 'Underpriced'}
                        </span>
                      </td>
                      <td className="text-right">{usd(l.listed_price)}</td>
                      <td className="text-right text-gold">{usd(l.tcgplayer_market)}</td>
                      <td className="text-right" style={{ color: l.alert_type === 'overpriced' ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
                        {fmtPct(l.overpriced_pct)}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {l.alert_type === 'overpriced' ? `Consider lowering to ${usd(l.tcgplayer_market)}` : `Consider raising to ${usd(l.tcgplayer_market)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* ── Stale listings tab ── */}
      {tab === 'stale' && (
        staleListings.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">✓</div>No listings older than 30 days.</div>
        ) : (
          <div className="panel">
            <table className="data-table">
              <thead><tr>
                <th>Listing</th>
                <th className="text-right">Listed price</th>
                <th className="text-right">TCG market</th>
                <th className="text-right">Suggested</th>
                <th className="text-right">Days listed</th>
                <th>Listed on</th>
              </tr></thead>
              <tbody>
                {staleListings.map(l => (
                  <tr key={l.listing_id}>
                    <td>
                      <div className="name-cell">{l.card_name || l.title}</div>
                      <div className="set-cell">{l.rarity}{l.foil ? ' · Foil' : ''}{l.set_name ? ` · ${l.set_name}` : ''}</div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                        <button onClick={() => navigate(`/listings?highlight=${l.listing_id}`)} style={{ fontSize: 11, color: 'var(--gold)', background: 'none', border: 'none', borderBottom: '1px dashed var(--gold)', padding: 0, cursor: 'pointer' }}>View listing &rarr;</button>
                        {l.ebay_url && (
                          <a href={l.ebay_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}>
                            eBay ↗
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="text-right">{usd(l.listed_price)}</td>
                    <td className="text-right text-gold">{usd(l.tcgplayer_market)}</td>
                    <td className="text-right" style={{ color: 'var(--info)' }}>{usd(l.suggested_price)}</td>
                    <td className="text-right" style={{ color: l.days_listed > 60 ? 'var(--danger)' : 'var(--warning)', fontWeight: 500 }}>
                      {l.days_listed}d
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{fmtDate(l.listed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}