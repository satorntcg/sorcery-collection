import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const usd       = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—'
const dateShort = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const dateFull  = (d) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

function timeAgo(d) {
  if (!d) return 'never'
  const mins = Math.floor((Date.now() - new Date(d)) / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export default function Market() {
  const [cards, setCards]             = useState([])
  const [selected, setSelected]       = useState(null)
  const [history, setHistory]         = useState([])
  const [running, setRunning]         = useState(false)
  const [runResult, setRunResult]     = useState(null)
  const [loading, setLoading]         = useState(true)
  const [lastChecked, setLastChecked] = useState(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('v_latest_prices')
        .select('card_id, name, set_name, rarity, foil, tcgplayer_market, tcgplayer_low, ebay_sold_avg, ebay_sold_low, ebay_sold_high, ebay_sold_count, checked_at, tcgplayer_id')
        .order('name', { ascending: true })
      setCards(data ?? [])
      // Most recent checked_at across all cards = last global refresh
      const latest = (data ?? []).reduce((max, c) => {
        if (!c.checked_at) return max
        return !max || new Date(c.checked_at) > new Date(max) ? c.checked_at : max
      }, null)
      setLastChecked(latest)
      setLoading(false)
    }
    load()
  }, [runResult])

  useEffect(() => {
    if (!selected) return
    async function loadHistory() {
      const { data } = await supabase
        .from('price_snapshots')
        .select('tcgplayer_market, ebay_sold_avg, checked_at')
        .eq('card_id', selected)
        .order('checked_at', { ascending: true })
        .limit(60)
      setHistory(data?.map(d => ({
        date:      dateShort(d.checked_at),
        TCGPlayer: d.tcgplayer_market ? Number(d.tcgplayer_market) : null,
        eBay:      d.ebay_sold_avg    ? Number(d.ebay_sold_avg)    : null,
      })) ?? [])
    }
    loadHistory()
  }, [selected])

  async function runPriceCheck() {
    setRunning(true)
    setRunResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/daily_price_check`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      const json = await res.json()
      setRunResult(json)
    } catch (err) {
      setRunResult({ error: String(err) })
    }
    setRunning(false)
  }

  const selectedCard = cards.find(c => c.card_id === selected)

  return (
    <div className="page">
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Market Check</h1>
          <p className="page-subtitle">
            Price history and manual price check trigger
            {lastChecked && (
              <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>
                · Prices last updated <span style={{ color: 'var(--gold-dim)' }} title={dateFull(lastChecked)}>{timeAgo(lastChecked)}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>({dateFull(lastChecked)})</span>
              </span>
            )}
          </p>
        </div>
        <button className="btn btn-primary" onClick={runPriceCheck} disabled={running}>
          {running ? '⟳ Running…' : '⟳ Run price check now'}
        </button>
      </div>

      {/* Run result */}
      {runResult && (
        <div className={`alert-item ${runResult.error ? 'danger' : 'success'} mb-16`}>
          <span className="alert-icon">{runResult.error ? '✗' : '✓'}</span>
          <div className="alert-content">
            <div className="alert-title">
              {runResult.error ? 'Price check failed' : 'Price check complete'}
            </div>
            <div className="alert-desc">
              {runResult.error
                ? runResult.error
                : `${runResult.success ?? 0} cards updated · ${runResult.failed ?? 0} failed · ${runResult.alerts ?? 0} alerts created`}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        {/* Card list */}
        <div className="panel" style={{ height: 'fit-content', maxHeight: '70vh', overflowY: 'auto' }}>
          <div className="panel-header">
            <span className="panel-title">Cards</span>
            {lastChecked && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }} title={dateFull(lastChecked)}>
                Updated {timeAgo(lastChecked)}
              </span>
            )}
          </div>
          {loading ? (
            <div className="loading" style={{ padding: 24 }}>Loading…</div>
          ) : cards.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>No price data yet</div>
          ) : cards.map(c => (
            <div
              key={c.card_id}
              onClick={() => setSelected(c.card_id)}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                background: selected === c.card_id ? 'var(--bg-hover)' : 'transparent',
                borderLeft: selected === c.card_id ? '2px solid var(--gold)' : '2px solid transparent',
                transition: 'all var(--transition)',
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)' }}>
                {c.name}{c.foil ? ' ✦' : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {c.rarity} · TCG {usd(c.tcgplayer_market)} · eBay {usd(c.ebay_sold_avg)}
              </div>
            </div>
          ))}
        </div>

        {/* Price chart */}
        <div>
          {!selected ? (
            <div className="panel">
              <div className="empty-state" style={{ padding: 64 }}>
                <div className="empty-state-icon">📈</div>
                Select a card to view price history
              </div>
            </div>
          ) : (
            <>
              <div className="panel mb-16">
                <div className="panel-header">
                  <span className="panel-title">{selectedCard?.name}{selectedCard?.foil ? ' ✦' : ''}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedCard?.set_name} · {selectedCard?.rarity}</span>
                    {selectedCard?.checked_at && (
                      <span
                        style={{ fontSize: 11, color: 'var(--gold-dim)', background: 'rgba(201,168,76,0.08)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' }}
                        title={`Last checked: ${dateFull(selectedCard.checked_at)}`}
                      >
                        Updated {timeAgo(selectedCard.checked_at)}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, borderTop: '1px solid var(--border)' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>TCGPlayer market</span>
                      {selectedCard?.tcgplayer_id && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <a href={`https://www.tcgplayer.com/product/${selectedCard.tcgplayer_id}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}>
                            Listings ↗
                          </a>
                          <a href={`https://www.tcgplayer.com/search/sorcery-contested-realm/product?productLineName=sorcery-contested-realm&q=${encodeURIComponent(selectedCard?.name)}&view=grid`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}>
                            Price history ↗
                          </a>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--gold-light)' }}>{usd(selectedCard?.tcgplayer_market)}</div>
                  </div>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>TCGPlayer low</div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--gold-light)' }}>{usd(selectedCard?.tcgplayer_low)}</div>
                  </div>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>eBay sold avg</span>
                      <a
                        href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${selectedCard?.name}${selectedCard?.foil ? ' foil' : ' non-foil'} Sorcery TCG`)}&_sop=13&LH_Sold=1&LH_Complete=1`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 10, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}
                      >
                        eBay sold ↗
                      </a>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--gold-light)' }}>{usd(selectedCard?.ebay_sold_avg)}</div>
                  </div>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>eBay sold range</span>
                      <a
                        href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${selectedCard?.name}${selectedCard?.foil ? ' foil' : ' non-foil'} Sorcery TCG`)}&_sop=15&LH_Sold=1&LH_Complete=1`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 10, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}
                      >
                        eBay active ↗
                      </a>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--gold-light)' }}>
                      {selectedCard?.ebay_sold_low ? `${usd(selectedCard.ebay_sold_low)} – ${usd(selectedCard.ebay_sold_high)}` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Price history</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last {history.length} checks</span>
                </div>
                <div style={{ padding: '20px', height: 280 }}>
                  {history.length < 2 ? (
                    <div className="empty-state">Not enough data yet — run a few price checks to see history.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <XAxis dataKey="date" tick={{ fill: '#5A5448', fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: '#5A5448', fontSize: 11 }} tickLine={false} axisLine={false}
                          tickFormatter={v => `$${v}`} width={50} />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: 'var(--text-muted)' }}
                          itemStyle={{ color: 'var(--text-primary)' }}
                          formatter={v => usd(v)}
                        />
                        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} />
                        <Line type="monotone" dataKey="TCGPlayer" stroke="#C9A84C" strokeWidth={2} dot={false} connectNulls />
                        <Line type="monotone" dataKey="eBay" stroke="#4C84C9" strokeWidth={2} dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}