import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useGame } from '../context/GameContext'
import { gameConfig } from '../lib/games'

const usd     = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—'
const fmtPnl  = (v) => v != null ? `${Number(v) >= 0 ? '+' : ''}${usd(v)}` : '—'
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// Channel colors — dark-surface-validated pair (see dataviz palette check), echoing the
// gold=TCGPlayer-price / blue=TCGPlayer-badge associations already used elsewhere in the app.
const EBAY_COLOR = '#B08A3A'
const TCG_COLOR  = '#4C8FD9'

function startOfWeek(date) {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function bucketKey(dateStr, period) {
  const d = new Date(dateStr)
  if (period === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const w = startOfWeek(d)
  return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`
}

function bucketLabel(key, period) {
  if (period === 'month') {
    const [y, m] = key.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  const [y, m, d] = key.split('-')
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const METRICS = [
  { id: 'count',   label: 'Cards Sold' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'profit',  label: 'Net Profit' },
]

export default function Sales() {
  const { activeGame } = useGame()
  const config = gameConfig(activeGame.slug)
  const [sales, setSales]     = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState('week')
  const [metric, setMetric]   = useState('count')
  const [channelFilter, setChannelFilter] = useState('all')
  const [search, setSearch]   = useState('')
  const [sortBy, setSortBy]   = useState('sold_at')
  const [sortDir, setSortDir] = useState('desc')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [ebayRes, tcgRes] = await Promise.all([
      supabase.from('v_ebay_sold').select('*').eq('game_id', activeGame.id),
      supabase.from('v_tcgplayer_sold').select('*').eq('game_id', activeGame.id),
    ])
    const ebay = (ebayRes.data ?? []).map(l => ({ ...l, channel: 'ebay', fee: l.sold_ebay_fee, url: l.ebay_url }))
    const tcg  = (tcgRes.data ?? []).map(l => ({ ...l, channel: 'tcgplayer', fee: l.sold_fee, url: l.tcgplayer_url }))
    setSales([...ebay, ...tcg])
    setLoading(false)
  }, [activeGame.id])

  useEffect(() => { fetchAll() }, [fetchAll])

  const totalCardsSold = sales.reduce((s, l) => s + (Number(l.total_quantity) || 1), 0)
  const totalRevenue   = sales.reduce((s, l) => s + (Number(l.sold_price) || 0), 0)
  const totalNetProfit = sales.reduce((s, l) => s + (Number(l.net_profit) || 0), 0)
  const avgSalePrice   = sales.length > 0 ? totalRevenue / sales.length : null

  const buckets = useMemo(() => {
    const map = new Map()
    for (const l of sales) {
      if (!l.sold_at) continue
      const key = bucketKey(l.sold_at, period)
      if (!map.has(key)) map.set(key, { key, ebayCount: 0, tcgCount: 0, ebayRevenue: 0, tcgRevenue: 0, netProfit: 0 })
      const b = map.get(key)
      const qty = Number(l.total_quantity) || 1
      if (l.channel === 'ebay') { b.ebayCount += qty; b.ebayRevenue += Number(l.sold_price) || 0 }
      else                      { b.tcgCount  += qty; b.tcgRevenue  += Number(l.sold_price) || 0 }
      b.netProfit += Number(l.net_profit) || 0
    }
    return [...map.values()]
      .sort((a, b) => a.key < b.key ? -1 : 1)
      .slice(-12)
      .map(b => ({ ...b, label: bucketLabel(b.key, period) }))
  }, [sales, period])

  const filtered = sales.filter(l => {
    if (channelFilter !== 'all' && l.channel !== channelFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      l.card_name?.toLowerCase().includes(q) ||
      l.title?.toLowerCase().includes(q) ||
      l.all_card_names?.toLowerCase().includes(q) ||
      l.set_name?.toLowerCase().includes(q)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortBy], bv = b[sortBy]
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase() }
    if (av == null) return 1; if (bv == null) return -1
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  })

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }
  const SortIcon = ({ col }) => <span style={{ opacity: sortBy === col ? 1 : 0.25, fontSize: 10, marginLeft: 3 }}>{sortBy === col ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>

  if (loading) return <div className="loading">Loading sales…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Sales</h1>
        <p className="page-subtitle">{config.displayName} — every sold card across eBay and TCGPlayer</p>
      </div>

      {/* Summary metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Cards Sold</div>
          <div className="metric-value gold">{totalCardsSold}</div>
          <div className="metric-sub">{sales.length} sale{sales.length === 1 ? '' : 's'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Revenue</div>
          <div className="metric-value success">{usd(totalRevenue)}</div>
          <div className="metric-sub">eBay + TCGPlayer</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Net Profit</div>
          <div className="metric-value" style={{ color: totalNetProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtPnl(totalNetProfit)}</div>
          <div className="metric-sub">after fees, shipping &amp; cost basis</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg Sale Price</div>
          <div className="metric-value">{usd(avgSalePrice)}</div>
          <div className="metric-sub">per listing</div>
        </div>
      </div>

      {/* Breakdown chart */}
      <div className="panel mb-16">
        <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="panel-title">Sales Breakdown</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 6, padding: 2, gap: 2 }}>
              {METRICS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMetric(m.id)}
                  style={{
                    fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 4, border: 'none',
                    cursor: 'pointer', letterSpacing: '0.03em', whiteSpace: 'nowrap',
                    background: metric === m.id ? 'var(--bg-card)' : 'transparent',
                    color: metric === m.id ? 'var(--gold)' : 'var(--text-muted)',
                    boxShadow: metric === m.id ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 6, padding: 2, gap: 2 }}>
              {[['week', 'Weekly'], ['month', 'Monthly']].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setPeriod(id)}
                  style={{
                    fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 4, border: 'none',
                    cursor: 'pointer', letterSpacing: '0.03em', whiteSpace: 'nowrap',
                    background: period === id ? 'var(--bg-card)' : 'transparent',
                    color: period === id ? 'var(--gold)' : 'var(--text-muted)',
                    boxShadow: period === id ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: '20px', height: 300 }}>
          {buckets.length === 0 ? (
            <div className="empty-state" style={{ height: '100%' }}>
              <div className="empty-state-icon">📈</div>
              No sales yet — mark a listing sold to see it here.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={metric === 'count' ? 32 : 55}
                  tickFormatter={v => metric === 'count' ? v : `$${v}`}
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Tooltip
                  cursor={{ fill: 'rgba(201,168,76,0.06)' }}
                  contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-muted)' }}
                  formatter={(value, name) => [metric === 'count' ? value : usd(value), name]}
                />
                {metric === 'count' && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} />}
                {metric === 'revenue' && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} />}
                {metric === 'count' && (
                  <>
                    <Bar dataKey="ebayCount" name="eBay" stackId="s" fill={EBAY_COLOR} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="tcgCount" name="TCGPlayer" stackId="s" fill={TCG_COLOR} radius={[4, 4, 0, 0]} />
                  </>
                )}
                {metric === 'revenue' && (
                  <>
                    <Bar dataKey="ebayRevenue" name="eBay" stackId="s" fill={EBAY_COLOR} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="tcgRevenue" name="TCGPlayer" stackId="s" fill={TCG_COLOR} radius={[4, 4, 0, 0]} />
                  </>
                )}
                {metric === 'profit' && (
                  <Bar dataKey="netProfit" name="Net Profit" radius={[4, 4, 4, 4]}>
                    {buckets.map((b, i) => (
                      <Cell key={i} fill={b.netProfit >= 0 ? 'var(--success)' : 'var(--danger)'} />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        {metric === 'profit' && buckets.length > 0 && (
          <div style={{ padding: '0 20px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
            Green = profitable {period === 'week' ? 'week' : 'month'} · Red = net loss
          </div>
        )}
      </div>

      {/* Sold cards table */}
      <div className="panel">
        <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="panel-title">Sold Cards</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['all', 'All'], ['ebay', 'eBay'], ['tcgplayer', 'TCGPlayer']].map(([id, label]) => (
              <button key={id} className={`btn btn-sm ${channelFilter === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setChannelFilter(id)}>{label}</button>
            ))}
          </div>
          <input
            className="form-input"
            style={{ maxWidth: 220, fontSize: 13 }}
            placeholder="Search sold cards…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {sorted.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🗂️</div>
            No sold cards yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr>
                <th onClick={() => toggleSort('card_name')} style={{ cursor: 'pointer' }}>Card <SortIcon col="card_name" /></th>
                <th>Cards in lot</th>
                <th>Channel</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th onClick={() => toggleSort('sold_price')} style={{ cursor: 'pointer', textAlign: 'right' }}>Sold for <SortIcon col="sold_price" /></th>
                <th style={{ textAlign: 'right' }}>Fee</th>
                <th style={{ textAlign: 'right' }}>Cost basis</th>
                <th onClick={() => toggleSort('net_profit')} style={{ cursor: 'pointer', textAlign: 'right' }}>Net profit <SortIcon col="net_profit" /></th>
                <th onClick={() => toggleSort('sold_at')} style={{ cursor: 'pointer' }}>Sold <SortIcon col="sold_at" /></th>
              </tr></thead>
              <tbody>{sorted.map(l => (
                <tr key={`${l.channel}-${l.id}`}>
                  <td>
                    <div className="name-cell">{l.card_name || l.title}</div>
                    {l.card_name && <div className="set-cell">{l.rarity}{l.foil ? ' · Foil' : ''}{l.set_name ? ` · ${l.set_name}` : ''}</div>}
                    {l.url && (
                      <a href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}>
                        ↗ {l.channel === 'ebay' ? 'eBay' : 'TCGPlayer'}
                      </a>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 160 }}>
                    {l.all_card_names && l.card_count > 1
                      ? l.all_card_names.split(', ').map((name, i) => <div key={i}>{name}</div>)
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.04em',
                      color: l.channel === 'ebay' ? EBAY_COLOR : TCG_COLOR,
                      border: `1px solid ${l.channel === 'ebay' ? EBAY_COLOR : TCG_COLOR}55`,
                      background: `${l.channel === 'ebay' ? EBAY_COLOR : TCG_COLOR}18`,
                    }}>
                      {l.channel === 'ebay' ? 'EBAY' : 'TCG'}
                    </span>
                  </td>
                  <td className="text-right text-muted" style={{ fontSize: 13 }}>{l.total_quantity ?? 1}</td>
                  <td className="text-right text-gold">{usd(l.sold_price)}</td>
                  <td className="text-right text-muted">{usd(l.fee)}</td>
                  <td className="text-right text-muted">{usd(l.cost_basis)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500, color: Number(l.net_profit) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtPnl(l.net_profit)}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{fmtDate(l.sold_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
