import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import WeeklyMovers from '../components/WeeklyMovers'

const toNumber = (value) => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function getMarketValue(card) {
  const directValue = toNumber(card.market_value ?? card.total_market_value)
  if (directValue != null) return directValue
  const price = toNumber(card.tcgplayer_market ?? card.ebay_sold_avg)
  const quantity = toNumber(card.quantity_owned) ?? 0
  return price != null ? price * quantity : null
}

function getUnrealizedPnl(card) {
  const directPnl = toNumber(card.unrealized_pnl ?? card.unrealized_pnl_total)
  if (directPnl != null) return directPnl
  const perCardPnl = toNumber(card.unrealized_pnl_per_card)
  const quantity = toNumber(card.quantity_owned) ?? 0
  return perCardPnl != null ? perCardPnl * quantity : null
}

const pnlClass  = (v) => v == null ? 'text-muted' : v >= 0 ? 'text-success' : 'text-danger'
const formatPnl = (v) => v != null ? `${v >= 0 ? '+' : ''}${usd(v)}` : '—'
const usd       = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—'
const pct       = (n) => n != null ? `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%` : '—'

function PriceChange({ value }) {
  if (value == null) return <span className="text-muted">—</span>
  const cls   = value > 0 ? 'price-up' : value < 0 ? 'price-down' : 'price-flat'
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→'
  return <span className={cls}>{arrow} {pct(value)}</span>
}

export default function Dashboard() {
  const [inventory, setInventory] = useState([])
  const [alerts, setAlerts]       = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [invRes, alertRes] = await Promise.all([
        supabase.from('v_inventory_dashboard').select('*'),
        supabase.from('v_active_alerts').select('*').limit(5),
      ])
      const inventoryRows = invRes.data ?? []
      setInventory([...inventoryRows].sort((a, b) => (getMarketValue(b) ?? 0) - (getMarketValue(a) ?? 0)))
      setAlerts(alertRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const totalMarketValue   = inventory.reduce((s, c) => s + (getMarketValue(c) ?? 0), 0)
  const totalUnrealizedPnl = inventory.reduce((s, c) => s + (getUnrealizedPnl(c) ?? 0), 0)
  const totalCards         = inventory.reduce((s, c) => s + (Number(c.quantity_owned) || 0), 0)
  const topMovers          = [...inventory]
    .filter(c => c.tcgplayer_market)
    .sort((a, b) => Math.abs(getUnrealizedPnl(b) ?? 0) - Math.abs(getUnrealizedPnl(a) ?? 0))
    .slice(0, 6)

  if (loading) return <div className="loading">Loading dashboard…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Your Sorcery TCG collection at a glance</p>
      </div>

      {/* Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Portfolio Value</div>
          <div className="metric-value gold">{usd(totalMarketValue)}</div>
          <div className="metric-sub">at current market prices</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Unrealized P&L</div>
          <div className="metric-value" style={{ color: totalUnrealizedPnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {totalUnrealizedPnl >= 0 ? '+' : ''}{usd(totalUnrealizedPnl)}
          </div>
          <div className="metric-sub">vs cost basis</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Cards Owned</div>
          <div className="metric-value">{totalCards}</div>
          <div className="metric-sub">across {inventory.length} unique cards</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Active Alerts</div>
          <div className="metric-value" style={{ color: alerts.length > 0 ? 'var(--gold)' : undefined }}>{alerts.length}</div>
          <div className="metric-sub">
            {alerts.length > 0
              ? <Link to="/alerts" style={{ color: 'var(--gold-dim)', textDecoration: 'none' }}>Review now →</Link>
              : 'all clear'}
          </div>
        </div>
      </div>

      {/* Weekly movers widget */}
      <WeeklyMovers />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Top holdings */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Top Holdings</span>
            <Link to="/inventory" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          {topMovers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🃏</div>
              No cards yet — add some in Inventory
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Card</th>
                  <th className="text-right">Market</th>
                  <th className="text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {topMovers.map(card => {
                  const pnl = getUnrealizedPnl(card)
                  return (
                    <tr key={card.card_id ?? card.id}>
                      <td>
                        <div className="name-cell">{card.name}</div>
                        <div className="set-cell">{card.set_name} · ×{card.quantity_owned}</div>
                      </td>
                      <td className="text-right">{usd(card.tcgplayer_market)}</td>
                      <td className="text-right">
                        <span className={pnlClass(pnl)}>{formatPnl(pnl)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Active alerts */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Price Alerts</span>
            <Link to="/alerts" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          <div className="panel-body" style={{ padding: '12px' }}>
            {alerts.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">✓</div>
                No alerts — prices look stable
              </div>
            ) : alerts.map(alert => {
              const isSpike = alert.alert_type === 'price_spike'
              const cls     = isSpike ? 'success' : 'warning'
              const icon    = isSpike ? '📈' : '📉'
              return (
                <div key={alert.id} className={`alert-item ${cls}`}>
                  <span className="alert-icon">{icon}</span>
                  <div className="alert-content">
                    <div className="alert-title">{alert.card_name}</div>
                    <div className="alert-desc">{alert.message}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Inventory overview */}
      {inventory.length > 0 && (
        <div className="panel mt-16">
          <div className="panel-header">
            <span className="panel-title">Inventory Overview</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Set</th>
                <th>Rarity</th>
                <th className="text-right">Qty</th>
                <th className="text-right">TCGPlayer</th>
                <th className="text-right">eBay Avg</th>
                <th className="text-right">Market Value</th>
              </tr>
            </thead>
            <tbody>
              {inventory.slice(0, 10).map(card => (
                <tr key={card.card_id ?? card.id}>
                  <td className="name-cell">{card.name}</td>
                  <td className="text-muted">{card.set_name}</td>
                  <td><span className={`badge badge-${card.rarity}`}>{card.rarity}</span></td>
                  <td className="text-right">{card.quantity_owned}</td>
                  <td className="text-right">{usd(card.tcgplayer_market)}</td>
                  <td className="text-right">{usd(card.ebay_sold_avg)}</td>
                  <td className="text-right text-gold">{usd(getMarketValue(card))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}