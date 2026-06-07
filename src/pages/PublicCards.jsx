import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const usd      = n => n == null ? '—' : `$${Number(n).toFixed(2)}`
const slugify  = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const FORMSPREE_ID = import.meta.env.VITE_FORMSPREE_ID

export default function PublicCards() {
  const [cards, setCards]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [rarityFilter,  setRarity]      = useState('all')
  const [setFilter,     setSetFilter]   = useState('all')
  const [ebayOnly,      setEbayOnly]    = useState(true)
  const [foilFilter,    setFoilFilter]  = useState('all')

  const [ebayMap,    setEbayMap]    = useState(new Map())
  const [changeMap,  setChangeMap]  = useState(new Map())
  const [changeRaw,  setChangeRaw]  = useState([])
  const [moversOpen, setMoversOpen] = useState(true)
  const [sortKey, setSortKey] = useState('tcgplayer_market')
  const [sortDir, setSortDir] = useState('desc')

  // Want list state
  const [wantList,       setWantList]       = useState(new Map())
  const [showWantModal,  setShowWantModal]  = useState(false)
  const [wantForm,       setWantForm]       = useState({ name: '', email: '', notes: '' })
  const [wantStatus,     setWantStatus]     = useState('idle')
  const [wantError,      setWantError]      = useState('')

  useEffect(() => {
    document.title = 'Card Prices — SatornTCG'

    async function fetchAll() {
      setLoading(true)
      const [{ data: cardData }, { data: singleData }, { data: lotData }, { data: changeData }] = await Promise.all([
        supabase
          .from('v_inventory_dashboard')
          .select('id, name, set_name, rarity, foil, condition, tcgplayer_market, quantity_owned, quantity_available, image_url, tcgplayer_id')
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
      if (ebayOnly && (c.quantity_owned ?? 0) === 0) return false
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

  function toggleWant(id) {
    setWantList(prev => {
      const next = new Map(prev)
      next.has(id) ? next.delete(id) : next.set(id, 1)
      return next
    })
  }

  function setWantQty(id, qty) {
    setWantList(prev => {
      const next = new Map(prev)
      qty < 1 ? next.delete(id) : next.set(id, qty)
      return next
    })
  }

  function closeWantModal() {
    setShowWantModal(false)
    setWantStatus('idle')
    setWantError('')
  }

  async function submitWantList() {
    if (!FORMSPREE_ID) {
      setWantError('Contact form is not configured. Please email contact@satorntcg.com directly.')
      setWantStatus('error')
      return
    }
    setWantStatus('sending')
    setWantError('')

    const selectedCards = cards.filter(c => wantList.has(c.id))
    const cardLines = selectedCards.map(c => {
      const foilSuffix = c.foil && !c.name.toLowerCase().includes('foil') ? ' (Foil)' : ''
      const qty = wantList.get(c.id) ?? 1
      return `• ${qty > 1 ? `${qty}× ` : ''}${c.name}${foilSuffix} · ${c.rarity} · ${c.set_name} · TCG ${usd(c.tcgplayer_market)}`
    }).join('\n')
    const message = `I'm interested in the following cards:\n\n${cardLines}${wantForm.notes ? `\n\nAdditional notes:\n${wantForm.notes}` : ''}`

    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify({ name: wantForm.name, email: wantForm.email, subject: 'Card Want List', message }),
      })
      if (res.ok) {
        setWantStatus('success')
        setWantList(new Map())
        setWantForm({ name: '', email: '', notes: '' })
      } else {
        const data = await res.json()
        setWantError(data?.errors?.[0]?.message ?? 'Submission failed. Please try again.')
        setWantStatus('error')
      }
    } catch {
      setWantError('Network error. Please try again or email contact@satorntcg.com directly.')
      setWantStatus('error')
    }
  }

  const wantCards = cards.filter(c => wantList.has(c.id))

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px', paddingBottom: wantList.size > 0 ? 96 : 32 }}>

      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Card Prices</h1>
        <p className="page-subtitle">
          Live TCGPlayer market prices · {loading ? '…' : `${cards.length} cards`} · Tick cards you're interested in to send a purchase request
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
          In Stock
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
                <th style={{ width: 32 }}></th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('name')}>Card{arrow('name')}</th>
                <th>Set</th>
                <th>Rarity</th>
                <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('tcgplayer_market')}>TCG Price{arrow('tcgplayer_market')}</th>
                <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('quantity_owned')}>In Stock{arrow('quantity_owned')}</th>
                <th style={{ textAlign: 'right' }}>eBay Listing</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const isWanted = wantList.has(c.id)
                return (
                  <tr key={c.id} style={isWanted ? { background: 'rgba(201,168,76,0.06)' } : undefined}>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      {(c.quantity_owned ?? 0) > 0 && (
                        <input
                          type="checkbox"
                          checked={isWanted}
                          onChange={() => toggleWant(c.id)}
                          style={{ accentColor: 'var(--gold)', width: 14, height: 14, cursor: 'pointer' }}
                        />
                      )}
                    </td>
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
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Floating want list bar */}
      {wantList.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--bg-void)', borderTop: '2px solid var(--gold)',
          padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          zIndex: 100, boxShadow: '0 -8px 32px rgba(0,0,0,0.8)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: 14 }}>
              {[...wantList.values()].reduce((s, q) => s + q, 0)} card{[...wantList.values()].reduce((s, q) => s + q, 0) !== 1 ? 's' : ''} selected
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {wantCards.map(c => c.name + (c.foil ? ' ✦' : '')).slice(0, 3).join(', ')}
              {wantList.size > 3 ? ` +${wantList.size - 3} more` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setWantList(new Map())}>Clear</button>
            <button className="btn btn-primary" onClick={() => setShowWantModal(true)}>Send Request</button>
          </div>
        </div>
      )}

      {/* Want list modal */}
      {showWantModal && (
        <div className="modal-overlay" onClick={closeWantModal}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Request Cards</span>
              <button className="btn btn-ghost btn-sm" onClick={closeWantModal}>✕</button>
            </div>

            {wantStatus === 'success' ? (
              <div className="modal-body" style={{ textAlign: 'center', padding: '32px 24px' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--gold-light)', marginBottom: 8 }}>Request Sent</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
                  We'll get back to you at {wantForm.email || 'your email'} as soon as possible.
                </p>
              </div>
            ) : (
              <>
                <div className="modal-body">
                  {/* Selected cards */}
                  <div style={{ marginBottom: 16 }}>
                    <div className="form-label" style={{ marginBottom: 8 }}>Selected cards ({wantCards.length})</div>
                    <div style={{ background: 'var(--bg-void)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', maxHeight: 160, overflowY: 'auto' }}>
                      {wantCards.map(c => {
                        const qty = wantList.get(c.id) ?? 1
                        return (
                          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <span style={{ color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
                              {c.name}{c.foil && !c.name.toLowerCase().includes('foil') ? ' ✦' : ''}
                              <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>{c.set_name}</span>
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                              {c.rarity && <span className={`badge badge-${c.rarity}`} style={{ fontSize: 10 }}>{c.rarity}</span>}
                              <span style={{ color: 'var(--gold)', fontSize: 12 }}>{usd(c.tcgplayer_market)}</span>
                              {/* Quantity stepper */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <button onClick={() => setWantQty(c.id, qty - 1)} style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 3, width: 22, height: 22, cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                <span style={{ minWidth: 18, textAlign: 'center', fontSize: 13 }}>{qty}</span>
                                <button onClick={() => setWantQty(c.id, qty + 1)} style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 3, width: 22, height: 22, cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                              </div>
                              <button
                                onClick={() => toggleWant(c.id)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                              >✕</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Contact fields */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label className="form-label">Name *</label>
                      <input
                        className="form-input"
                        type="text"
                        value={wantForm.name}
                        onChange={e => setWantForm(p => ({ ...p, name: e.target.value }))}
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="form-label">Email *</label>
                      <input
                        className="form-input"
                        type="email"
                        value={wantForm.email}
                        onChange={e => setWantForm(p => ({ ...p, email: e.target.value }))}
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Additional notes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <textarea
                      className="form-textarea"
                      value={wantForm.notes}
                      onChange={e => setWantForm(p => ({ ...p, notes: e.target.value }))}
                      placeholder="Condition preferences, budget, questions…"
                      rows={3}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </div>

                  {wantStatus === 'error' && (
                    <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{wantError}</div>
                  )}
                </div>

                <div className="modal-footer">
                  <button className="btn" onClick={closeWantModal}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={submitWantList}
                    disabled={wantStatus === 'sending' || !wantForm.name.trim() || !wantForm.email.trim()}
                  >
                    {wantStatus === 'sending' ? 'Sending…' : 'Send Request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
