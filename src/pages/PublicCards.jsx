import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const usd      = n => n == null ? '—' : `$${Number(n).toFixed(2)}`
const slugify  = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export default function PublicCards() {
  const [cards, setCards]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [rarityFilter,  setRarity]      = useState('all')
  const [setFilter,     setSetFilter]   = useState('all')
  const [ebayOnly,      setEbayOnly]    = useState(false)
  const [foilFilter,    setFoilFilter]  = useState('all')

  const [ebayMap,    setEbayMap]    = useState(new Map())
  const [changeMap,  setChangeMap]  = useState(new Map())
  const [changeRaw,  setChangeRaw]  = useState([])
  const [moversOpen, setMoversOpen] = useState(true)
  const [sortKey, setSortKey] = useState('tcgplayer_market')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    document.title = 'Card Prices — SatornTCG'

    async function fetchAll() {
      setLoading(true)
      const [{ data: cardData }, { data: singleData }, { data: lotData }, { data: changeData }] = await Promise.all([
        supabase
          .from('v_inventory_dashboard')
          .select('id, name, set_name, rarity, foil, condition, tcgplayer_market, quantity_owned, image_url, tcgplayer_id')
          .order('name'),
        // single-card listings
        supabase
          .from('ebay_listings')
          .select('card_id, ebay_url, listed_price')
          .eq('status', 'active')
          .not('card_id', 'is', null),
        // cards inside multi-card lots
        supabase
          .from('ebay_listing_cards')
          .select('card_id, ebay_listings!listing_id(ebay_url, listed_price, status, card_id)'),
        // 7-day price changes
        supabase.from('v_price_gainers_losers').select('card_id, name, rarity, foil, current_price, price_7d_ago, pct_change'),
      ])
      setCards(cardData ?? [])
      setChangeRaw(changeData ?? [])

      const cm = new Map()
      for (const r of (changeData ?? [])) {
        const change = Number(r.current_price) - Number(r.price_7d_ago)
        if (Math.abs(change) >= 0.05) cm.set(r.card_id, change)
      }
      setChangeMap(cm)

      const map = new Map()
      function addToMap(cardId, listing) {
        const existing = map.get(cardId)
        if (!existing || listing.listed_price < existing.listed_price) map.set(cardId, listing)
      }

      for (const l of (singleData ?? [])) addToMap(l.card_id, l)
      for (const lc of (lotData ?? [])) {
        const l = lc.ebay_listings
        if (!l || l.status !== 'active' || l.card_id !== null) continue
        addToMap(lc.card_id, { ebay_url: l.ebay_url, listed_price: l.listed_price })
      }

      setEbayMap(map)
      setLoading(false)
    }

    fetchAll()
  }, [])

  const sets = useMemo(() => {
    const unique = [...new Set(cards.map(c => c.set_name).filter(Boolean))]
    return unique.sort()
  }, [cards])

  const filtered = useMemo(() => {
    const list = cards.filter(c => {
      if (search && !c.name?.toLowerCase().includes(search.toLowerCase())) return false
      if (rarityFilter !== 'all' && c.rarity !== rarityFilter) return false
      if (setFilter !== 'all' && c.set_name !== setFilter) return false
      if (ebayOnly && !ebayMap.has(c.id)) return false
      if (foilFilter === 'foil' && !c.foil) return false
      if (foilFilter === 'non-foil' && c.foil) return false
      return true
    })
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      const bv = b[sortKey] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [cards, search, rarityFilter, setFilter, ebayOnly, foilFilter, ebayMap, sortKey, sortDir])

  const topMovers = useMemo(() => {
    const dollarImpact = r => Math.abs(Number(r.current_price) * Number(r.pct_change))
    const gainers = [...changeRaw].filter(r => r.pct_change > 0).sort((a, b) => dollarImpact(b) - dollarImpact(a)).slice(0, 3)
    const losers  = [...changeRaw].filter(r => r.pct_change < 0).sort((a, b) => dollarImpact(b) - dollarImpact(a)).slice(0, 3)
    return { gainers, losers }
  }, [changeRaw])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  const arrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>

      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Card Prices</h1>
        <p className="page-subtitle">
          Live TCGPlayer market prices · {loading ? '…' : `${cards.length} cards`}
        </p>
      </div>

      {/* Movers banner */}
      {!loading && (topMovers.gainers.length > 0 || topMovers.losers.length > 0) && (
        <div className="panel" style={{ marginTop: 20, overflow: 'hidden' }}>
          <div
            onClick={() => setMoversOpen(o => !o)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', cursor: 'pointer', borderBottom: moversOpen ? '1px solid var(--border)' : 'none' }}
          >
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--gold-light)', letterSpacing: '0.04em' }}>This Week's Movers</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{moversOpen ? '▲ collapse' : '▼ expand'}</span>
          </div>
          {moversOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, padding: '12px 16px' }}>
              <div style={{ paddingRight: 16, borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>▲ Gainers</div>
                {topMovers.gainers.map(c => (
                  <Link key={c.card_id} to={`/cards/${slugify(c.name)}/${c.card_id}`} style={{ textDecoration: 'none', display: 'block' }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer', borderRadius: 3 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-raised)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}{c.foil ? ' ✦' : ''}
                      </span>
                      <div style={{ flexShrink: 0, marginLeft: 8, textAlign: 'right' }}>
                        <span style={{ fontSize: 12, color: 'var(--gold)' }}>{usd(c.current_price)}</span>
                        <span style={{ fontSize: 10, color: 'var(--success)', marginLeft: 5 }}>+{Number(c.pct_change).toFixed(1)}%</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
              <div style={{ paddingLeft: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>▼ Losers</div>
                {topMovers.losers.map(c => (
                  <Link key={c.card_id} to={`/cards/${slugify(c.name)}/${c.card_id}`} style={{ textDecoration: 'none', display: 'block' }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer', borderRadius: 3 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-raised)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}{c.foil ? ' ✦' : ''}
                      </span>
                      <div style={{ flexShrink: 0, marginLeft: 8, textAlign: 'right' }}>
                        <span style={{ fontSize: 12, color: 'var(--gold)' }}>{usd(c.current_price)}</span>
                        <span style={{ fontSize: 10, color: 'var(--danger)', marginLeft: 5 }}>{Number(c.pct_change).toFixed(1)}%</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter row */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '20px' }}>
        <input
          className="form-input"
          placeholder="Search cards…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: '240px', minWidth: '140px' }}
        />
        <select
          className="form-select"
          value={rarityFilter}
          onChange={e => setRarity(e.target.value)}
          style={{ flex: '1 1 120px', maxWidth: '150px' }}
        >
          <option value="all">All Rarities</option>
          <option value="ordinary">Ordinary</option>
          <option value="exceptional">Exceptional</option>
          <option value="elite">Elite</option>
          <option value="unique">Unique</option>
        </select>
        <select
          className="form-select"
          value={setFilter}
          onChange={e => setSetFilter(e.target.value)}
          style={{ flex: '1 1 140px', maxWidth: '180px' }}
        >
          <option value="all">All Sets</option>
          {sets.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {/* Foil toggle */}
        <div style={{ display: 'flex', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 3, gap: 2 }}>
          {['all', 'non-foil', 'foil'].map(v => (
            <button
              key={v}
              onClick={() => setFoilFilter(v)}
              style={{
                padding: '4px 10px', fontSize: 12, border: 'none', borderRadius: 'calc(var(--radius-sm) - 2px)', cursor: 'pointer',
                background: foilFilter === v ? 'var(--gold)' : 'transparent',
                color: foilFilter === v ? 'var(--bg-void)' : 'var(--text-secondary)',
                fontWeight: foilFilter === v ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {v === 'all' ? 'All' : v === 'foil' ? '✦ Foil' : 'Non-Foil'}
            </button>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={ebayOnly}
            onChange={e => setEbayOnly(e.target.checked)}
            style={{ accentColor: 'var(--gold)', width: 15, height: 15, cursor: 'pointer' }}
          />
          eBay listings only
        </label>
      </div>

      {/* Results count */}
      {!loading && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
          {filtered.length} results
        </p>
      )}

      {/* Table */}
      {loading ? (
        <div className="loading" style={{ marginTop: '40px' }}>Loading cards…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '40px' }}>No cards match your filters.</div>
      ) : (
        <div className="panel" style={{ marginTop: '12px', overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('name')}>Card{arrow('name')}</th>
                <th>Set</th>
                <th>Rarity</th>
                <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('tcgplayer_market')}>TCG Price{arrow('tcgplayer_market')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('quantity_owned')}>In Stock{arrow('quantity_owned')}</th>
                <th style={{ textAlign: 'right' }}>eBay Listing</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>
                    <Link
                      to={`/cards/${slugify(c.name)}/${c.id}`}
                      style={{ textDecoration: 'none', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      {(c.image_url || c.tcgplayer_id)
                        ? <div style={{ width: 32, height: 44, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                            <img src={c.image_url || `https://product-images.tcgplayer.com/fit-in/400x558/${c.tcgplayer_id}.jpg`} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.08)', display: 'block' }} />
                          </div>
                        : <div style={{ width: 32, height: 44, background: 'var(--bg-raised)', borderRadius: 3, flexShrink: 0 }} />
                      }
                      <span>{c.name}{c.foil ? ' ✦' : ''}</span>
                    </Link>
                  </td>
                  <td className="set-cell">{c.set_name}</td>
                  <td>
                    {c.rarity && (
                      <span className={`badge badge-${c.rarity}`}>{c.rarity}</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {c.tcgplayer_market != null ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--gold)' }}>{usd(c.tcgplayer_market)}</span>
                        {changeMap.has(c.id) && (() => {
                          const ch = changeMap.get(c.id)
                          return (
                            <span style={{ fontSize: 10, color: ch > 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                              {ch > 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}
                            </span>
                          )
                        })()}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {(c.quantity_owned ?? 0) > 0 ? (
                      <span className="text-success">{c.quantity_owned}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {(() => {
                      const l = ebayMap.get(c.id)
                      if (!l?.ebay_url) return <span className="text-muted">—</span>
                      return (
                        <a href={l.ebay_url} target="_blank" rel="noreferrer" className="btn btn-primary"
                          style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                          Buy Now {usd(l.listed_price)}
                        </a>
                      )
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
