import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const usd = n => n == null ? '—' : `$${Number(n).toFixed(2)}`

export default function PublicCards() {
  const [cards, setCards]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [rarityFilter, setRarity] = useState('all')
  const [setFilter, setSetFilter] = useState('all')

  useEffect(() => {
    document.title = 'Card Database — SatornTCG'

    async function fetchCards() {
      setLoading(true)
      const { data } = await supabase
        .from('v_inventory_dashboard')
        .select('id, name, set_name, rarity, foil, condition, tcgplayer_market, quantity_available, image_url')
        .order('name')
      setCards(data ?? [])
      setLoading(false)
    }

    fetchCards()
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
      return true
    })
  }, [cards, search, rarityFilter, setFilter])

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
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>In Stock</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>
                    <Link
                      to={`/cards/${c.id}`}
                      className="name-cell"
                      style={{ textDecoration: 'none', color: 'var(--text-primary)' }}
                    >
                      {c.name}{c.foil ? ' ✦' : ''}
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
                    {(c.quantity_available ?? 0) > 0 ? (
                      <span className="text-success">{c.quantity_available}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
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
