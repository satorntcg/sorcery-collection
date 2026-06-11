import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
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
  const [searchParams] = useSearchParams()
  const [cards, setCards]             = useState([])
  const [selected, setSelected]       = useState(null)
  const [history, setHistory]         = useState([])
  const [running, setRunning]         = useState(false)
  const [runResult, setRunResult]     = useState(null)
  const [loading, setLoading]         = useState(true)
  const [lastChecked, setLastChecked] = useState(null)
  const [search, setSearch]           = useState('')
  const [myListings, setMyListings]   = useState([])

  useEffect(() => {
    async function load() {
      let allCards = [], cardPage = 0
      while (true) {
        const { data } = await supabase
          .from('cards')
          .select('id, name, set_name, rarity, foil, tcgplayer_id')
          .order('name', { ascending: true })
          .range(cardPage * 1000, (cardPage + 1) * 1000 - 1)
        allCards = [...allCards, ...(data ?? [])]
        if (!data || data.length < 1000) break
        cardPage++
      }

      let allPrices = [], pricePage = 0
      while (true) {
        const { data } = await supabase
          .from('v_latest_prices')
          .select('card_id, tcgplayer_market, tcgplayer_low, ebay_sold_avg, ebay_sold_low, ebay_sold_high, ebay_sold_count, checked_at')
          .range(pricePage * 1000, (pricePage + 1) * 1000 - 1)
        allPrices = [...allPrices, ...(data ?? [])]
        if (!data || data.length < 1000) break
        pricePage++
      }

      const priceMap = new Map(allPrices.map(p => [p.card_id, p]))
      const merged = allCards.map(c => ({
        card_id: c.id,
        name: c.name,
        set_name: c.set_name,
        rarity: c.rarity,
        foil: c.foil,
        tcgplayer_id: c.tcgplayer_id,
        ...(priceMap.get(c.id) ?? {}),
      }))
      setCards(merged)
      const latest = allPrices.reduce((max, c) => {
        if (!c.checked_at) return max
        return !max || new Date(c.checked_at) > new Date(max) ? c.checked_at : max
      }, null)
      setLastChecked(latest)
      setLoading(false)
    }
    load()
  }, [runResult])

  useEffect(() => {
    if (!selected) { setMyListings([]); return }
    async function loadHistory() {
      const [{ data: snapData }, { data: myListingsData }, { data: lotData }] = await Promise.all([
        supabase
          .from('price_snapshots')
          .select('tcgplayer_market, tcgplayer_low, ebay_sold_avg, ebay_sold_low, ebay_sold_high, checked_at')
          .eq('card_id', selected)
          .order('checked_at', { ascending: true })
          .limit(60),
        // all single-card listings (active + sold)
        supabase
          .from('ebay_listings')
          .select('id, title, listed_price, sold_price, sold_at, listed_at, status, ebay_url')
          .eq('card_id', selected)
          .in('status', ['active', 'sold'])
          .order('listed_at', { ascending: true }),
        // all lot cards (active + sold) — use per-card price from junction
        supabase
          .from('ebay_listing_cards')
          .select('price, ebay_listings!listing_id(id, title, listed_price, listed_at, sold_at, status, created_at, ebay_url)')
          .eq('card_id', selected),
      ])

      const today = new Date().toISOString().slice(0, 10)

      // flatten all own listings into { price, date }
      const myPoints = [
        ...(myListingsData ?? []).map(l => ({
          price: l.status === 'sold' && l.sold_price != null ? Number(l.sold_price) : Number(l.listed_price),
          date:  (l.status === 'sold' && l.sold_at ? l.sold_at : l.listed_at)?.slice(0, 10) ?? today,
        })),
        ...(lotData ?? [])
          .filter(lc => lc.price != null && lc.ebay_listings != null && ['active', 'sold'].includes(lc.ebay_listings.status))
          .map(lc => {
            const el = lc.ebay_listings
            const rawDate = el.status === 'sold' && el.sold_at
              ? el.sold_at
              : (el.listed_at ?? el.created_at ?? today)
            return { price: Number(lc.price), date: rawDate.slice(0, 10) }
          }),
      ].filter(p => p.date && !isNaN(p.price))

      // Build combined listings list for display
      const listingsDisplay = [
        ...(myListingsData ?? []).map(l => ({
          id:       l.id,
          title:    l.title,
          status:   l.status,
          price:    l.status === 'sold' && l.sold_price != null ? Number(l.sold_price) : Number(l.listed_price),
          ebay_url: l.ebay_url,
          type:     'single',
          date:     (l.status === 'sold' && l.sold_at ? l.sold_at : l.listed_at)?.slice(0, 10) ?? today,
        })),
      ]
      // Deduplicate lot listings by listing id
      const seenLotIds = new Set()
      for (const lc of (lotData ?? [])) {
        const el = lc.ebay_listings
        if (!el || !['active', 'sold'].includes(el.status) || seenLotIds.has(el.id)) continue
        seenLotIds.add(el.id)
        const rawDate = el.status === 'sold' && el.sold_at
          ? el.sold_at : (el.listed_at ?? el.created_at ?? today)
        listingsDisplay.push({
          id:       el.id,
          title:    el.title,
          status:   el.status,
          price:    Number(el.listed_price ?? lc.price),
          ebay_url: el.ebay_url,
          type:     'lot',
          date:     rawDate.slice(0, 10),
        })
      }
      listingsDisplay.sort((a, b) => b.date.localeCompare(a.date))
      setMyListings(listingsDisplay)

      const entries = new Map()
      for (const s of (snapData ?? [])) {
        const key = s.checked_at.slice(0, 10)
        entries.set(key, {
          rawDate:  key,
          date:     dateShort(s.checked_at),
          TCGPlayer: s.tcgplayer_market != null ? Number(s.tcgplayer_market) : null,
          eBay:      s.ebay_sold_avg    != null ? Number(s.ebay_sold_avg)    : null,
          'My eBay': null,
        })
      }
      for (const p of myPoints) {
        const existing = entries.get(p.date) ?? { rawDate: p.date, date: dateShort(p.date), TCGPlayer: null, eBay: null }
        entries.set(p.date, { ...existing, 'My eBay': p.price })
      }

      setHistory(
        [...entries.values()]
          .sort((a, b) => a.rawDate.localeCompare(b.rawDate))
          .map(({ rawDate, ...rest }) => rest)
      )
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

  useEffect(() => {
    const cardId = searchParams.get('card')
    if (cardId && cards.length > 0) {
      setSelected(cardId)
      const card = cards.find(c => c.card_id === cardId)
      if (card) setSearch(card.name)
    }
  }, [cards, searchParams])

  const selectedCard = cards.find(c => c.card_id === selected)
  const displayCard  = selectedCard

  const filteredCards = search.trim()
    ? cards.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()))
    : cards

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
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <input
              className="form-input"
              style={{ fontSize: 12, padding: '6px 10px' }}
              placeholder="Search cards…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {loading ? (
            <div className="loading" style={{ padding: 24 }}>Loading…</div>
          ) : filteredCards.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>{search ? 'No cards match.' : 'No price data yet'}</div>
          ) : filteredCards.map(c => (
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
                  <span className="panel-title">{displayCard?.name}{displayCard?.foil ? ' ✦' : ''}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{displayCard?.set_name} · {displayCard?.rarity}</span>
                    {displayCard?.checked_at && (
                      <span
                        style={{ fontSize: 11, color: 'var(--gold-dim)', background: 'rgba(201,168,76,0.08)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' }}
                        title={`Last checked: ${dateFull(displayCard.checked_at)}`}
                      >
                        Updated {timeAgo(displayCard.checked_at)}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, borderTop: '1px solid var(--border)' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>TCGPlayer market</span>
                      {displayCard?.tcgplayer_id && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <a href={`https://www.tcgplayer.com/product/${displayCard.tcgplayer_id}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}>
                            Listings ↗
                          </a>
                          <a href={`https://www.tcgplayer.com/search/sorcery-contested-realm/product?productLineName=sorcery-contested-realm&q=${encodeURIComponent(displayCard?.name)}&view=grid`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}>
                            Price history ↗
                          </a>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--gold-light)' }}>{usd(displayCard?.tcgplayer_market)}</div>
                  </div>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>TCGPlayer low</div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--gold-light)' }}>{usd(displayCard?.tcgplayer_low)}</div>
                  </div>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>eBay sold avg</span>
                      <a
                        href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${displayCard?.name}${displayCard?.foil ? ' foil' : ' non-foil'} Sorcery TCG`)}&_sop=13&LH_Sold=1&LH_Complete=1`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 10, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}
                      >
                        eBay sold ↗
                      </a>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--gold-light)' }}>{usd(displayCard?.ebay_sold_avg)}</div>
                  </div>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>eBay sold range</span>
                      <a
                        href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${displayCard?.name}${displayCard?.foil ? ' foil' : ' non-foil'} Sorcery TCG`)}&_sop=15&LH_Sold=1&LH_Complete=1`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 10, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}
                      >
                        eBay active ↗
                      </a>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: 'var(--gold-light)' }}>
                      {displayCard?.ebay_sold_low ? `${usd(displayCard.ebay_sold_low)} – ${usd(displayCard.ebay_sold_high)}` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {myListings.length > 0 && (
                <div className="panel mb-16">
                  <div className="panel-header">
                    <span className="panel-title">My eBay Listings</span>
                    <Link to="/listings" style={{ fontSize: 11, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}>
                      View all ↗
                    </Link>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th className="text-right">Price</th>
                        <th>Date</th>
                        <th>Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myListings.map(l => (
                        <tr key={l.id}>
                          <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                            {l.title || '—'}
                          </td>
                          <td>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-void)', padding: '2px 6px', borderRadius: 4 }}>
                              {l.type}
                            </span>
                          </td>
                          <td>
                            <span className={`badge badge-${l.status === 'active' ? 'ok' : l.status === 'sold' ? 'alert' : ''}`} style={{ fontSize: 10 }}>
                              {l.status}
                            </span>
                          </td>
                          <td className="text-right" style={{ fontSize: 13, color: 'var(--gold-light)' }}>{usd(l.price)}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dateShort(l.date)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <Link
                                to="/listings"
                                style={{ fontSize: 11, color: 'var(--text-secondary)', textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}
                              >
                                App ↗
                              </Link>
                              {l.ebay_url && (
                                <a
                                  href={l.ebay_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ fontSize: 11, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}
                                >
                                  eBay ↗
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Price history</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last {history.length} data points</span>
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
                        <Line type="monotone" dataKey="eBay"      stroke="#4C84C9" strokeWidth={2} dot={false} connectNulls />
                        <Line type="monotone" dataKey="My eBay"   stroke="#4CAF6E" strokeWidth={0} connectNulls
                          dot={(props) => {
                            const { cx, cy, value } = props
                            if (value == null) return null
                            return <circle key={`me-${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="#4CAF6E" stroke="var(--bg-raised)" strokeWidth={2} />
                          }}
                        />
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