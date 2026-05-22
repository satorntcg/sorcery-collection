import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const EBAY_FEE_PCT  = 0.129
const EBAY_FEE_FLAT = 0.30
const calcFee = (price) => price * EBAY_FEE_PCT + EBAY_FEE_FLAT
const calcNet = (price, shipping, fee) => price - fee - shipping
const usd    = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPnl = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}` }
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// ── Create modal (2-step: pick cards → set prices) ───────────
function CreateModal({ cards, onClose, onSaved }) {
  const [step, setStep]               = useState(1)
  const [search, setSearch]           = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [prices, setPrices]           = useState({})
  const [title, setTitle]             = useState('')
  const [shipping, setShipping]       = useState('4.00')
  const [condition, setCondition]     = useState('Near Mint')
  const [notes, setNotes]             = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const selectedCards = cards.filter(c => selectedIds.includes(c.card_id))
  const filtered = cards.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name?.toLowerCase().includes(q) || c.set_name?.toLowerCase().includes(q) || c.rarity?.toLowerCase().includes(q)
  })

  function toggleCard(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function goToStep2() {
    if (!selectedIds.length) return
    const initial = {}
    selectedCards.forEach(c => { initial[c.card_id] = c.tcgplayer_market ? Number(c.tcgplayer_market).toFixed(2) : '' })
    setPrices(initial)
    setTitle(selectedIds.length === 1
      ? `${selectedCards[0].name}${selectedCards[0].foil ? ' (Foil)' : ''} — Sorcery TCG${selectedCards[0].set_name ? ` ${selectedCards[0].set_name}` : ''} — ${condition}`
      : `Sorcery TCG Lot — ${selectedIds.length} Cards`)
    setStep(2)
  }

  const totalPrice     = selectedCards.reduce((s, c) => s + (parseFloat(prices[c.card_id]) || 0), 0)
  const s              = parseFloat(shipping) || 0
  const fee            = calcFee(totalPrice)
  const net            = calcNet(totalPrice, s, fee)
  const totalCostBasis = selectedCards.reduce((s, c) => s + (c.cost_basis || 0), 0)
  const estProfit      = totalPrice > 0 ? net - totalCostBasis : null

  async function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return }
    if (totalPrice <= 0) { setError('At least one card needs a price.'); return }
    setSaving(true); setError('')
    try {
      const cardBreakdown = selectedCards.map(c => ({ name: c.name, price: parseFloat(prices[c.card_id]) || 0 }))
      const { error: err } = await supabase.from('ebay_listings').insert({
        card_id:       selectedIds.length === 1 ? selectedIds[0] : null,
        title:         title.trim(),
        listed_price:  parseFloat(totalPrice.toFixed(2)),
        shipping_cost: s,
        condition,
        notes: [notes.trim(), selectedIds.length > 1 ? `Cards: ${cardBreakdown.map(c => `${c.name} ($${c.price.toFixed(2)})`).join(', ')}` : null].filter(Boolean).join('\n') || null,
        cost_basis: totalCostBasis > 0 ? parseFloat(totalCostBasis.toFixed(4)) : null,
        status: 'active',
      })
      if (err) throw err
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: step === 2 ? 620 : 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{step === 1 ? 'Select cards' : 'Price & listing details'}</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {step === 1 && (
          <div className="modal-body">
            <div className="form-group">
              <input className="form-input" type="text" placeholder="Search by name, set, rarity…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
            </div>

            {selectedIds.length > 0 && (
              <div className="alert-item success mb-16" style={{ padding: '8px 14px' }}>
                <span className="alert-content" style={{ fontSize: 12 }}>
                  {selectedIds.length} card{selectedIds.length !== 1 ? 's' : ''} selected
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds([])}>Clear</button>
              </div>
            )}

            <div className="panel" style={{ maxHeight: 380, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px' }}>No cards found</div>
              ) : filtered.map(c => {
                const isSel = selectedIds.includes(c.card_id)
                return (
                  <div key={c.card_id} onClick={() => toggleCard(c.card_id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isSel ? 'rgba(201,168,76,0.06)' : 'transparent', borderLeft: isSel ? '2px solid var(--gold)' : '2px solid transparent' }}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleCard(c.card_id)} onClick={e => e.stopPropagation()} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name-cell" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}{c.foil ? ' ✦' : ''}</div>
                      <div className="set-cell">{c.rarity}{c.set_name ? ` · ${c.set_name}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {c.tcgplayer_market ? <span className="text-gold" style={{ fontSize: 13, fontWeight: 500 }}>{usd(c.tcgplayer_market)}</span> : <span className="text-muted" style={{ fontSize: 12 }}>No price</span>}
                      {c.cost_basis && <div className="set-cell">cost {usd(c.cost_basis)}</div>}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="modal-footer" style={{ padding: '16px 0 0', border: 'none' }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={goToStep2} disabled={!selectedIds.length}>
                Next — set prices →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="modal-body">
            <button onClick={() => setStep(1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }}>← Back</button>

            {/* Per-card price table */}
            <div className="panel mb-16">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Card</th>
                    <th className="text-right">TCG price</th>
                    <th className="text-right">List price ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCards.map(c => (
                    <tr key={c.card_id}>
                      <td>
                        <div className="name-cell">{c.name}{c.foil ? ' ✦' : ''}</div>
                        <div className="set-cell">{c.rarity}{c.set_name ? ` · ${c.set_name}` : ''}{c.cost_basis ? ` · cost ${usd(c.cost_basis)}` : ''}</div>
                      </td>
                      <td className="text-right text-muted">{usd(c.tcgplayer_market)}</td>
                      <td className="text-right" style={{ width: 110 }}>
                        <input className="form-input" type="number" min="0" step="0.01" value={prices[c.card_id] ?? ''} onChange={e => setPrices(prev => ({ ...prev, [c.card_id]: e.target.value }))} placeholder="0.00" style={{ textAlign: 'right', padding: '5px 8px' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>Total listing price</td>
                    <td className="text-right text-gold" style={{ padding: '10px 14px', fontWeight: 500, borderTop: '1px solid var(--border)' }}>{usd(totalPrice)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Fee preview */}
            {totalPrice > 0 && (
              <div className="metrics-grid mb-16" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
                {[['eBay fee', usd(fee), ''], ['Shipping', usd(s), ''], ['Net proceeds', usd(net), net >= 0 ? 'success' : 'danger'], ['Est. profit', estProfit != null ? fmtPnl(estProfit) : '—', estProfit != null ? (estProfit >= 0 ? 'success' : 'danger') : '']].map(([label, val, cls]) => (
                  <div key={label} className="metric-card">
                    <div className="metric-label">{label}</div>
                    <div className={`metric-value ${cls}`} style={{ fontSize: 18 }}>{val}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">eBay listing title</label>
              <input className="form-input" type="text" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Shipping ($)</label>
                <input className="form-input" type="number" min="0" step="0.01" value={shipping} onChange={e => setShipping(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Condition</label>
                <select className="form-select" value={condition} onChange={e => setCondition(e.target.value)}>
                  {['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes (optional)</label>
              <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>

            {error && <div className="alert-item danger mb-16"><span className="alert-content">{error}</span></div>}

            <div className="modal-footer" style={{ padding: '16px 0 0', border: 'none' }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || totalPrice <= 0}>
                {saving ? 'Saving…' : `Save listing${selectedIds.length > 1 ? ` (${selectedIds.length} cards)` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sold modal ───────────────────────────────────────────────
function SoldModal({ listing, onClose, onSaved }) {
  const [soldPrice, setSoldPrice]       = useState(String(listing.listed_price))
  const [soldShipping, setSoldShipping] = useState(String(listing.shipping_cost))
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')

  const sp = parseFloat(soldPrice) || 0
  const ss = parseFloat(soldShipping) || 0
  const fee = calcFee(sp); const net = calcNet(sp, ss, fee)
  const profit = listing.cost_basis != null ? net - listing.cost_basis : null

  async function handleSave() {
    if (!sp) { setError('Enter the sold price.'); return }
    setSaving(true); setError('')
    try {
      const { error: err } = await supabase.from('ebay_listings').update({
        status: 'sold', sold_price: sp, sold_shipping: ss,
        sold_ebay_fee: parseFloat(fee.toFixed(2)),
        net_profit: parseFloat((profit ?? net).toFixed(2)),
        sold_at: new Date().toISOString(),
      }).eq('id', listing.id)
      if (err) throw err; onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Mark sold</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>{listing.title}</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Sold price ($)</label>
              <input className="form-input" type="number" min="0" step="0.01" value={soldPrice} onChange={e => setSoldPrice(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Actual shipping ($)</label>
              <input className="form-input" type="number" min="0" step="0.01" value={soldShipping} onChange={e => setSoldShipping(e.target.value)} />
            </div>
          </div>

          <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">eBay fee</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{usd(fee)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Net proceeds</div>
              <div className={`metric-value ${net >= 0 ? 'success' : 'danger'}`} style={{ fontSize: 18 }}>{usd(net)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">P&L vs cost basis</div>
              <div className={`metric-value ${profit == null ? '' : profit >= 0 ? 'success' : 'danger'}`} style={{ fontSize: 18 }}>
                {profit != null ? fmtPnl(profit) : '—'}
              </div>
            </div>
          </div>

          {error && <div className="alert-item danger mt-16"><span className="alert-content">{error}</span></div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm sale'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit modal ───────────────────────────────────────────────
function EditModal({ listing, onClose, onSaved }) {
  const [title, setTitle]         = useState(listing.title)
  const [price, setPrice]         = useState(String(listing.listed_price))
  const [shipping, setShipping]   = useState(String(listing.shipping_cost))
  const [condition, setCondition] = useState(listing.condition)
  const [notes, setNotes]         = useState(listing.notes || '')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const p = parseFloat(price) || 0; const s = parseFloat(shipping) || 0
  const fee = calcFee(p); const net = calcNet(p, s, fee)

  async function handleSave() {
    if (!title.trim() || !p) { setError('Title and price are required.'); return }
    setSaving(true); setError('')
    try {
      const { error: err } = await supabase.from('ebay_listings').update({
        title: title.trim(), listed_price: p, shipping_cost: s, condition, notes: notes.trim() || null,
      }).eq('id', listing.id)
      if (err) throw err; onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Edit listing</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="form-input" type="text" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Price ($)</label>
              <input className="form-input" type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Shipping ($)</label>
              <input className="form-input" type="number" min="0" step="0.01" value={shipping} onChange={e => setShipping(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Condition</label>
            <select className="form-select" value={condition} onChange={e => setCondition(e.target.value)}>
              {['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          {p > 0 && (
            <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              <span>Fee: <span className="text-gold">{usd(fee)}</span></span>
              <span>Net: <span className={net >= 0 ? 'text-success' : 'text-danger'}>{usd(net)}</span></span>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
          {error && <div className="alert-item danger"><span className="alert-content">{error}</span></div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── End listing modal ────────────────────────────────────────
function EndModal({ listing, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  async function handleEnd() { setSaving(true); await supabase.from('ebay_listings').delete().eq('id', listing.id); onSaved() }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">End listing</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Permanently remove <strong style={{ color: 'var(--text-primary)' }}>{listing.title}</strong> from your listings? This cannot be undone.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={handleEnd} disabled={saving}>
            {saving ? 'Removing…' : 'End listing'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────
export default function EbayListings() {
  const [tab, setTab]           = useState('active')
  const [listings, setListings] = useState([])
  const [cards, setCards]       = useState([])
  const [pnl, setPnl]           = useState(null)
  const [loading, setLoading]   = useState(true)
  const [boxCosts, setBoxCosts] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [soldTarget, setSoldTarget] = useState(null)
  const [endTarget, setEndTarget]   = useState(null)
  const [sortBy, setSortBy]     = useState('listed_at')
  const [sortDir, setSortDir]   = useState('desc')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [activeRes, soldRes, pnlRes, cardsRes] = await Promise.all([
      supabase.from('v_ebay_active').select('*'),
      supabase.from('v_ebay_sold').select('*'),
      supabase.from('v_global_pnl').select('*').single(),
      supabase.from('v_latest_prices').select('card_id, name, set_name, rarity, foil, tcgplayer_market, cost_basis').order('name'),
    ])
    setListings([
      ...(activeRes.data || []).map(r => ({ ...r, status: 'active' })),
      ...(soldRes.data  || []).map(r => ({ ...r, status: 'sold'   })),
    ])
    setPnl(pnlRes.data)
    setCards(cardsRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => {
    supabase.from('boxes').select('purchase_price').then(({ data }) => {
      if (data) setBoxCosts(data.reduce((s, b) => s + (b.purchase_price || 0), 0))
    })
  }, [])

  const onSaved = () => {
    fetchAll()
    setShowCreate(false); setEditTarget(null); setSoldTarget(null); setEndTarget(null)
  }

  const activeListings = listings.filter(l => l.status === 'active')
  const soldListings   = listings.filter(l => l.status === 'sold')
  const tabListings    = tab === 'active' ? activeListings : soldListings

  const sorted = [...tabListings].sort((a, b) => {
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

  const totalNetProfit = pnl ? Number(pnl.total_net_profit) : 0
  const totalCogs      = pnl ? Number(pnl.total_cogs) : 0
  const businessProfit = pnl && boxCosts != null ? totalNetProfit - (boxCosts - totalCogs) : null

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">eBay Listings</h1>
          <p className="page-subtitle">{activeListings.length} active · {soldListings.length} sold</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New listing</button>
      </div>

      {/* Summary metrics */}
      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-label">Active listings</div>
          <div className="metric-value">{pnl?.active_listings_count ?? '—'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Active GMV</div>
          <div className="metric-value gold">{usd(pnl?.active_listings_gmv)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Net if all sell</div>
          <div className="metric-value gold">{usd(pnl?.active_listings_net_if_sold)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total revenue</div>
          <div className="metric-value success">{usd(pnl?.total_revenue)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Net profit (sold)</div>
          <div className={`metric-value ${totalNetProfit >= 0 ? 'success' : 'danger'}`}>{fmtPnl(totalNetProfit)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Business profit</div>
          <div className={`metric-value ${businessProfit == null ? '' : businessProfit >= 0 ? 'success' : 'danger'}`}>
            {businessProfit != null ? fmtPnl(businessProfit) : '…'}
          </div>
          <div className="metric-sub">revenue − fees − boxes</div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {[['active', `Active (${activeListings.length})`], ['sold', `Sold (${soldListings.length})`], ['pnl', 'Business P&L']].map(([id, label]) => (
          <button key={id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── Active / Sold tables ── */}
      {(tab === 'active' || tab === 'sold') && (
        loading ? <div className="loading">Loading listings…</div> :
        sorted.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏷️</div>
            {tab === 'active' ? 'No active listings. Click + New listing to add one.' : 'No sold listings yet.'}
          </div>
        ) : (
          <div className="panel">
            <table className="data-table">
              {tab === 'active' ? (
                <>
                  <thead><tr>
                    <th onClick={() => toggleSort('title')} style={{ cursor: 'pointer' }}>Card <SortIcon col="title" /></th>
                    <th onClick={() => toggleSort('listed_price')} style={{ cursor: 'pointer', textAlign: 'right' }}>Price <SortIcon col="listed_price" /></th>
                    <th onClick={() => toggleSort('shipping_cost')} style={{ cursor: 'pointer', textAlign: 'right' }}>Shipping <SortIcon col="shipping_cost" /></th>
                    <th style={{ textAlign: 'right' }}>eBay fee</th>
                    <th onClick={() => toggleSort('net_listed')} style={{ cursor: 'pointer', textAlign: 'right' }}>Net <SortIcon col="net_listed" /></th>
                    <th onClick={() => toggleSort('days_listed')} style={{ cursor: 'pointer', textAlign: 'right' }}>Days <SortIcon col="days_listed" /></th>
                    <th onClick={() => toggleSort('listed_at')} style={{ cursor: 'pointer' }}>Listed <SortIcon col="listed_at" /></th>
                    <th></th>
                  </tr></thead>
                  <tbody>{sorted.map(l => (
                    <tr key={l.id}>
                      <td>
                        <div className="name-cell">{l.card_name || l.title}</div>
                        {l.card_name && <div className="set-cell">{l.rarity}{l.foil ? ' · Foil' : ''}{l.set_name ? ` · ${l.set_name}` : ''}{l.tcg_market_price ? ` · TCG ${usd(l.tcg_market_price)}` : ''}</div>}
                        {l.condition && <span className="badge badge-ordinary" style={{ marginTop: 3 }}>{l.condition}</span>}
                      </td>
                      <td className="text-right text-gold">{usd(l.listed_price)}</td>
                      <td className="text-right text-muted">{usd(l.shipping_cost)}</td>
                      <td className="text-right text-muted">{usd(l.ebay_fee)}</td>
                      <td className={`text-right ${l.net_listed >= 0 ? 'text-success' : 'text-danger'}`} style={{ fontWeight: 500 }}>{usd(l.net_listed)}</td>
                      <td className="text-right text-muted">{l.days_listed ?? 0}d</td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{fmtDate(l.listed_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-ghost" style={{ color: 'var(--success)', borderColor: 'rgba(76,175,110,0.3)' }} onClick={() => setSoldTarget(l)}>Sold</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditTarget(l)}>Edit</button>
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setEndTarget(l)}>End</button>
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </>
              ) : (
                <>
                  <thead><tr>
                    <th onClick={() => toggleSort('title')} style={{ cursor: 'pointer' }}>Card <SortIcon col="title" /></th>
                    <th onClick={() => toggleSort('sold_price')} style={{ cursor: 'pointer', textAlign: 'right' }}>Sold for <SortIcon col="sold_price" /></th>
                    <th style={{ textAlign: 'right' }}>Shipping</th>
                    <th style={{ textAlign: 'right' }}>eBay fee</th>
                    <th style={{ textAlign: 'right' }}>Cost basis</th>
                    <th onClick={() => toggleSort('net_profit')} style={{ cursor: 'pointer', textAlign: 'right' }}>Net profit <SortIcon col="net_profit" /></th>
                    <th onClick={() => toggleSort('days_to_sell')} style={{ cursor: 'pointer', textAlign: 'right' }}>Days <SortIcon col="days_to_sell" /></th>
                    <th onClick={() => toggleSort('sold_at')} style={{ cursor: 'pointer' }}>Sold <SortIcon col="sold_at" /></th>
                  </tr></thead>
                  <tbody>{sorted.map(l => (
                    <tr key={l.id}>
                      <td>
                        <div className="name-cell">{l.card_name || l.title}</div>
                        {l.card_name && <div className="set-cell">{l.rarity}{l.foil ? ' · Foil' : ''}{l.set_name ? ` · ${l.set_name}` : ''}</div>}
                      </td>
                      <td className="text-right text-gold">{usd(l.sold_price)}</td>
                      <td className="text-right text-muted">{usd(l.sold_shipping)}</td>
                      <td className="text-right text-muted">{usd(l.sold_ebay_fee)}</td>
                      <td className="text-right text-muted">{usd(l.cost_basis)}</td>
                      <td className={`text-right ${l.net_profit >= 0 ? 'text-success' : 'text-danger'}`} style={{ fontWeight: 500 }}>{fmtPnl(l.net_profit)}</td>
                      <td className="text-right text-muted">{l.days_to_sell ?? '—'}d</td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{fmtDate(l.sold_at)}</td>
                    </tr>
                  ))}</tbody>
                </>
              )}
            </table>
          </div>
        )
      )}

      {/* ── Business P&L tab ── */}
      {tab === 'pnl' && pnl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {[
            { heading: 'eBay sales', rows: [['Total revenue', usd(pnl.total_revenue), 'gold'], ['eBay fees paid', usd(pnl.total_ebay_fees), ''], ['Shipping paid', usd(pnl.total_shipping_paid), ''], ['Cost of goods', usd(pnl.total_cogs), ''], ['Net profit', fmtPnl(totalNetProfit), totalNetProfit >= 0 ? 'success' : 'danger']] },
            { heading: 'Box inventory', rows: [['Total box spend', boxCosts != null ? usd(boxCosts) : '…', ''], ['Cost of sold cards', usd(pnl.total_cogs), ''], ['Remaining inventory cost', boxCosts != null ? usd(boxCosts - totalCogs) : '…', '']] },
            { heading: 'Active pipeline', rows: [['Active listings', pnl.active_listings_count, ''], ['Listed GMV', usd(pnl.active_listings_gmv), 'gold'], ['Net if all sell', usd(pnl.active_listings_net_if_sold), 'gold']] },
          ].map(({ heading, rows }) => (
            <div key={heading}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>{heading}</div>
              <div className="metrics-grid" style={{ gridTemplateColumns: `repeat(${rows.length}, 1fr)` }}>
                {rows.map(([label, val, cls]) => (
                  <div key={label} className="metric-card">
                    <div className="metric-label">{label}</div>
                    <div className={`metric-value ${cls}`} style={{ fontSize: 20 }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Bottom line */}
          <div className="panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px' }}>
              <div>
                <div className="panel-title">Business net profit</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>eBay revenue − fees − shipping − box costs</div>
              </div>
              <div className={`metric-value ${businessProfit == null ? '' : businessProfit >= 0 ? 'success' : 'danger'}`} style={{ fontSize: 32 }}>
                {businessProfit != null ? fmtPnl(businessProfit) : '…'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && <CreateModal cards={cards} onClose={() => setShowCreate(false)} onSaved={onSaved} />}
      {editTarget  && <EditModal  listing={editTarget} onClose={() => setEditTarget(null)} onSaved={onSaved} />}
      {soldTarget  && <SoldModal  listing={soldTarget} onClose={() => setSoldTarget(null)} onSaved={onSaved} />}
      {endTarget   && <EndModal   listing={endTarget}  onClose={() => setEndTarget(null)}  onSaved={onSaved} />}
    </div>
  )
}
