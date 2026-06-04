import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const usd = n => n == null ? '—' : `$${Number(n).toFixed(2)}`

export default function PublicCards() {
  const [cards, setCards]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [rarityFilter,  setRarity]      = useState('all')
  const [setFilter,     setSetFilter]   = useState('all')
  const [ebayOnly,      setEbayOnly]    = useState(false)

  const [ebayMap, setEbayMap] = useState(new Map())

  useEffect(() => {
    document.title = 'Card Database — SatornTCG'

    async function fetchAll() {
      setLoading(true)
      const [{ data: cardData }, { data: singleData }, { data: lotData }] = await Promise.all([
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
      ])
      setCards(cardData ?? [])

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
    return cards.filter(c => {
      if (search && !c.name?.toLowerCase().includes(search.toLowerCase())) return false
      if (rarityFilter !== 'all' && c.rarity !== rarityFilter) return false
      if (setFilter !== 'all' && c.set_name !== setFilter) return false
      if (ebayOnly && !ebayMap.has(c.id)) return false
      return true
    })
  }, [cards, search, rarityFilter, setFilter, ebayOnly, ebayMap])

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>

      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Card Database</h1>
        <p className="page-subtitle">
          Live TCGPlayer market prices · {loading ? '…' : `${cards.length} cards`}
        </p>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '20px' }}>
        <input
          className="form-input"
          placeholder="Search cards…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '240px' }}
        />
        <select
          className="form-select"
          value={rarityFilter}
          onChange={e => setRarity(e.target.value)}
          style={{ width: '150px' }}
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
          style={{ width: '180px' }}
        >
          <option value="all">All Sets</option>
          {sets.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
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
        <div className="panel" style={{ marginTop: '12px' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Set</th>
                <th>Rarity</th>
                <th style={{ textAlign: 'right' }}>TCG Price</th>
                <th style={{ textAlign: 'right' }}>In Stock</th>
                <th style={{ textAlign: 'right' }}>eBay Listing</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>
                    <Link
                      to={`/cards/${c.id}`}
                      style={{ textDecoration: 'none', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      {(c.image_url || c.tcgplayer_id)
                        ? <img src={c.image_url || `https://product-images.tcgplayer.com/fit-in/400x558/${c.tcgplayer_id}.jpg`} alt={c.name} style={{ width: 32, height: 44, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
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
                      <span style={{ color: 'var(--gold)' }}>{usd(c.tcgplayer_market)}</span>
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
