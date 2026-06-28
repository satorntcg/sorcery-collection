import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const ebayItemNum = url => url?.match(/\/itm\/(\d+)/)?.[1] ?? null

const EBAY_FEE_PCT  = 0.129
const EBAY_FEE_FLAT = 0.30
const calcFee = (price) => price * EBAY_FEE_PCT + EBAY_FEE_FLAT
const calcNet = (price, shipping, fee) => price - fee - shipping
const usd    = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPnl = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+$' : '-$'}${Math.abs(v).toFixed(2)}` }
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// ── Create modal (2-step: pick cards → set prices) ───────────
function CreateModal({ cards, onClose, onSaved }) {
  const [step, setStep]               = useState(1)
  const [search, setSearch]           = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [cardQtys, setCardQtys]       = useState({}) // cardId -> qty per lot
  const [prices, setPrices]           = useState({})
  const [title, setTitle]             = useState('')
  const [shipping, setShipping]       = useState('4.00')
  const [condition, setCondition]     = useState('Near Mint')
  const [ebayUrl, setEbayUrl]         = useState('')
  const [notes, setNotes]             = useState('')
  const [quantity, setQuantity]       = useState(1)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const selectedCards = cards.filter(c => selectedIds.includes(c.card_id))
  const filtered = cards.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name?.toLowerCase().includes(q) || c.set_name?.toLowerCase().includes(q) || c.rarity?.toLowerCase().includes(q)
  })

  function toggleCard(id) {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        setCardQtys(q => { const next = { ...q }; delete next[id]; return next })
        return prev.filter(x => x !== id)
      } else {
        setCardQtys(q => ({ ...q, [id]: q[id] ?? 1 }))
        return [...prev, id]
      }
    })
  }

  function adjustCardQty(id, delta) {
    setCardQtys(q => ({ ...q, [id]: Math.max(1, (q[id] ?? 1) + delta) }))
  }

  function clearAll() {
    setSelectedIds([])
    setCardQtys({})
  }

  function goToStep2() {
    if (!selectedIds.length) return
    const initial = {}
    selectedCards.forEach(c => { initial[c.card_id] = c.tcg_market_price ? Number(c.tcg_market_price).toFixed(2) : '' })
    setPrices(initial)
    const totalQtyInLot = selectedIds.reduce((s, id) => s + (cardQtys[id] ?? 1), 0)
    const isSingle = selectedIds.length === 1 && (cardQtys[selectedIds[0]] ?? 1) === 1
    setTitle(isSingle
      ? `${selectedCards[0].name}${selectedCards[0].foil ? ' (Foil)' : ''} — Sorcery TCG${selectedCards[0].set_name ? ` ${selectedCards[0].set_name}` : ''} — ${condition}`
      : `Sorcery TCG Lot — ${totalQtyInLot} Cards`)
    setStep(2)
  }

  const totalPrice     = selectedCards.reduce((s, c) => s + (parseFloat(prices[c.card_id]) || 0) * (cardQtys[c.card_id] ?? 1), 0)
  const s              = parseFloat(shipping) || 0
  const fee            = calcFee(totalPrice)
  const net            = calcNet(totalPrice, s, fee)
  const totalCostBasis = selectedCards.reduce((s, c) => s + (c.cost_basis || 0) * (cardQtys[c.card_id] ?? 1), 0)
  const estProfit      = totalPrice > 0 ? net - totalCostBasis : null
  const totalQtyInLot  = selectedIds.reduce((s, id) => s + (cardQtys[id] ?? 1), 0)

  async function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return }
    if (totalPrice <= 0) { setError('At least one card needs a price.'); return }
    setSaving(true); setError('')
    const listingQty = Math.max(1, parseInt(quantity) || 1)
    const isSingleCard = selectedIds.length === 1 && (cardQtys[selectedIds[0]] ?? 1) === 1
    try {
      const { data: listing, error: err } = await supabase.from('ebay_listings').insert({
        card_id:       isSingleCard ? selectedIds[0] : null,
        title:         title.trim(),
        listed_price:  parseFloat(totalPrice.toFixed(2)),
        shipping_cost: s,
        condition,
        quantity:      listingQty,
        notes:         notes.trim() || null,
        ebay_url:      ebayUrl.trim() || null,
        cost_basis:    totalCostBasis > 0 ? parseFloat(totalCostBasis.toFixed(4)) : null,
        status:        'active',
      }).select('id').single()
      if (err) throw err

      // Link cards via junction table (same as EditModal)
      if (listing && selectedCards.length > 0) {
        await supabase.from('ebay_listing_cards').insert(
          selectedCards.map(c => ({
            listing_id: listing.id,
            card_id:    c.card_id,
            price:      parseFloat(prices[c.card_id]) || 0,
            quantity:   cardQtys[c.card_id] ?? 1,
          }))
        )
      }

      // Increment quantity_listed: cardQty * listingQty per card
      for (const c of selectedCards) {
        const cardQty = (cardQtys[c.card_id] ?? 1) * listingQty
        const { data: cardRow } = await supabase.from('cards').select('quantity_listed').eq('id', c.card_id).single()
        if (cardRow) await supabase.from('cards').update({ quantity_listed: (cardRow.quantity_listed ?? 0) + cardQty }).eq('id', c.card_id)
      }
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: step === 2 ? 660 : 520 }} onClick={e => e.stopPropagation()}>
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
                  {totalQtyInLot} card{totalQtyInLot !== 1 ? 's' : ''} selected ({selectedIds.length} unique)
                </span>
                <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear</button>
              </div>
            )}

            <div className="panel" style={{ maxHeight: 380, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px' }}>No cards found</div>
              ) : filtered.map(c => {
                const isSel = selectedIds.includes(c.card_id)
                const qty   = cardQtys[c.card_id] ?? 1
                return (
                  <div key={c.card_id} onClick={() => toggleCard(c.card_id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isSel ? 'rgba(201,168,76,0.06)' : 'transparent', borderLeft: isSel ? '2px solid var(--gold)' : '2px solid transparent' }}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleCard(c.card_id)} onClick={e => e.stopPropagation()} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name-cell" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}{c.foil ? ' ✦' : ''}</div>
                      <div className="set-cell">{c.rarity}{c.set_name ? ` · ${c.set_name}` : ''}</div>
                    </div>
                    {isSel && (
                      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => adjustCardQty(c.card_id, -1)} style={{ padding: '2px 7px', minWidth: 0 }}>−</button>
                        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 18, textAlign: 'center' }}>{qty}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => adjustCardQty(c.card_id, +1)} style={{ padding: '2px 7px', minWidth: 0 }}>+</button>
                      </div>
                    )}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {c.tcg_market_price ? <span className="text-gold" style={{ fontSize: 13, fontWeight: 500 }}>{usd(c.tcg_market_price)}</span> : <span className="text-muted" style={{ fontSize: 12 }}>No price</span>}
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
                    <th className="text-right">Qty</th>
                    <th className="text-right">TCG price</th>
                    <th className="text-right">Unit price ($)</th>
                    <th className="text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCards.map(c => {
                    const qty      = cardQtys[c.card_id] ?? 1
                    const unitPrice = parseFloat(prices[c.card_id]) || 0
                    return (
                      <tr key={c.card_id}>
                        <td>
                          <div className="name-cell">{c.name}{c.foil ? ' ✦' : ''}</div>
                          <div className="set-cell">{c.rarity}{c.set_name ? ` · ${c.set_name}` : ''}{c.cost_basis ? ` · cost ${usd(c.cost_basis * qty)}` : ''}</div>
                        </td>
                        <td className="text-right">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => adjustCardQty(c.card_id, -1)} style={{ padding: '2px 7px', minWidth: 0 }}>−</button>
                            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 18, textAlign: 'center' }}>{qty}</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => adjustCardQty(c.card_id, +1)} style={{ padding: '2px 7px', minWidth: 0 }}>+</button>
                          </div>
                        </td>
                        <td className="text-right text-muted">{usd(c.tcg_market_price)}</td>
                        <td className="text-right" style={{ width: 110 }}>
                          <input className="form-input" type="number" min="0" step="0.01" value={prices[c.card_id] ?? ''} onChange={e => setPrices(prev => ({ ...prev, [c.card_id]: e.target.value }))} placeholder="0.00" style={{ textAlign: 'right', padding: '5px 8px' }} />
                        </td>
                        <td className="text-right text-gold" style={{ fontSize: 13 }}>{unitPrice > 0 ? usd(unitPrice * qty) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>Total listing price ({totalQtyInLot} cards)</td>
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
                <label className="form-label">Qty listed</label>
                <input className="form-input" type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ textAlign: 'center' }} />
              </div>
              <div className="form-group">
                <label className="form-label">Condition</label>
                <select className="form-select" value={condition} onChange={e => setCondition(e.target.value)}>
                  {['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">eBay listing URL (optional)</label>
              <input className="form-input" type="text" value={ebayUrl} onChange={e => setEbayUrl(e.target.value)} placeholder="https://ebay.com/itm/…" />
            </div>
            <div className="form-group">
              <label className="form-label">Notes (optional)</label>
              <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>

            {error && <div className="alert-item danger mb-16"><span className="alert-content">{error}</span></div>}

            <div className="modal-footer" style={{ padding: '16px 0 0', border: 'none' }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || totalPrice <= 0}>
                {saving ? 'Saving…' : `Save listing (${totalQtyInLot} card${totalQtyInLot !== 1 ? 's' : ''})`}
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
  const isEdit = listing.status === 'sold'
  const [soldPrice, setSoldPrice]       = useState(String(listing.sold_price ?? listing.listed_price ?? ''))
  const [soldShipping, setSoldShipping] = useState(String(listing.sold_shipping ?? listing.shipping_cost ?? '0'))
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')

  const sp = parseFloat(soldPrice) || 0
  const ss = parseFloat(soldShipping) || 0
  const fee = calcFee(sp)
  const net = calcNet(sp, ss, fee)
  // True profit = net proceeds minus cost basis
  const profit = listing.cost_basis != null ? net - listing.cost_basis : net

  async function handleSave() {
    if (!sp) { setError('Enter the sold price.'); return }
    setSaving(true); setError('')
    try {
      const trueProfit = listing.cost_basis != null ? net - listing.cost_basis : net
      const update = {
        sold_price:    sp,
        sold_shipping: ss,
        sold_ebay_fee: parseFloat(fee.toFixed(2)),
        net_profit:    parseFloat(trueProfit.toFixed(2)),
      }
      // Only set status + sold_at if marking sold for the first time
      if (!isEdit) {
        update.status  = 'sold'
        update.sold_at = new Date().toISOString()
      }
      const { error: err } = await supabase.from('ebay_listings').update(update).eq('id', listing.id)
      if (err) throw err
      // Only decrement inventory quantities when marking sold for the first time
      if (!isEdit) {
        const listingQty = listing.quantity ?? 1
        if (listing.card_id) {
          const { data: cardRow } = await supabase.from('cards').select('quantity_owned, quantity_listed').eq('id', listing.card_id).single()
          if (cardRow) await supabase.from('cards').update({
            quantity_listed: Math.max(0, (cardRow.quantity_listed ?? 0) - listingQty),
            quantity_owned:  Math.max(0, (cardRow.quantity_owned  ?? 0) - listingQty),
          }).eq('id', listing.card_id)
        } else {
          // Lot listing — decrement each card via ebay_listing_cards
          const { data: lotCards } = await supabase.from('ebay_listing_cards').select('card_id, quantity').eq('listing_id', listing.id)
          for (const lc of (lotCards ?? [])) {
            const qty = (lc.quantity ?? 1) * listingQty
            const { data: cardRow } = await supabase.from('cards').select('quantity_owned, quantity_listed').eq('id', lc.card_id).single()
            if (cardRow) await supabase.from('cards').update({
              quantity_listed: Math.max(0, (cardRow.quantity_listed ?? 0) - qty),
              quantity_owned:  Math.max(0, (cardRow.quantity_owned  ?? 0) - qty),
            }).eq('id', lc.card_id)
          }
        }
      }
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit sale' : 'Mark sold'}</span>
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

          <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">eBay fee</div>
              <div className="metric-value" style={{ fontSize: 18, color: 'var(--danger)' }}>{usd(fee)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Shipping cost</div>
              <div className="metric-value" style={{ fontSize: 18, color: 'var(--danger)' }}>{usd(ss)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Net proceeds</div>
              <div className="metric-value" style={{ fontSize: 18, color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtPnl(net)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">True profit</div>
              <div className="metric-value" style={{ fontSize: 18, color: profit == null ? 'var(--text-primary)' : profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {profit != null ? fmtPnl(profit) : '—'}
              </div>
              {listing.cost_basis != null && <div className="metric-sub">after cost basis {usd(listing.cost_basis)}</div>}
            </div>
          </div>

          {error && <div className="alert-item danger mt-16"><span className="alert-content">{error}</span></div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Confirm sale'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit modal ───────────────────────────────────────────────
function EditModal({ listing, cards, onClose, onSaved }) {
  const [title, setTitle]           = useState(listing.title)
  const [price, setPrice]           = useState(String(listing.listed_price))
  const [shipping, setShipping]     = useState(String(listing.shipping_cost))
  const [condition, setCondition]   = useState(listing.condition)
  const [quantity, setQuantity]     = useState(listing.quantity ?? 1)
  const [ebayUrl, setEbayUrl]       = useState(listing.ebay_url || '')
  const [notes, setNotes]           = useState(listing.notes || '')
  const [tcgListed, setTcgListed]   = useState(listing.tcgplayer_listed ?? false)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [cardSearch, setCardSearch] = useState('')
  const [linkedCards, setLinkedCards] = useState([])
  const [initialLinkedCards, setInitialLinkedCards] = useState([])
  const [loadingCards, setLoadingCards] = useState(true)

  // Load existing linked cards
  useEffect(() => {
    async function loadLinked() {
      setLoadingCards(true)
      let initial = []
      // Check ebay_listing_cards junction table
      const { data: junctionRows } = await supabase
        .from('ebay_listing_cards')
        .select('card_id, quantity, cards(id, name, rarity, foil, set_name)')
        .eq('listing_id', listing.id)
      if (junctionRows?.length) {
        initial = junctionRows.map(r => ({ ...r.cards, qty: r.quantity ?? 1 })).filter(Boolean)
      } else if (listing.card_id) {
        const { data: card } = await supabase
          .from('cards').select('id, name, rarity, foil, set_name')
          .eq('id', listing.card_id).single()
        if (card) initial = [{ ...card, qty: 1 }]
      }
      setLinkedCards(initial)
      setInitialLinkedCards(initial)
      setLoadingCards(false)
    }
    loadLinked()
  }, [listing.id])

  const p = parseFloat(price) || 0; const s = parseFloat(shipping) || 0
  const fee = calcFee(p); const net = calcNet(p, s, fee)

  const filteredCards = cardSearch.length > 1
    ? (cards || []).filter(c =>
        c.name?.toLowerCase().includes(cardSearch.toLowerCase()) ||
        c.set_name?.toLowerCase().includes(cardSearch.toLowerCase())
      ).slice(0, 10)
    : []

  function addCard(card) {
    setLinkedCards(prev => {
      const exists = prev.find(c => c.id === card.id)
      return exists
        ? prev.map(c => c.id === card.id ? { ...c, qty: (c.qty ?? 1) + 1 } : c)
        : [...prev, { ...card, qty: 1 }]
    })
  }

  function removeCard(card) {
    setLinkedCards(prev => {
      const existing = prev.find(c => c.id === card.id)
      if (!existing) return prev
      if ((existing.qty ?? 1) <= 1) return prev.filter(c => c.id !== card.id)
      return prev.map(c => c.id === card.id ? { ...c, qty: c.qty - 1 } : c)
    })
  }

  async function handleSave() {
    if (!title.trim() || !p) { setError('Title and price are required.'); return }
    setSaving(true); setError('')
    try {
      // Update listing fields
      const { error: err } = await supabase.from('ebay_listings').update({
        title:             title.trim(),
        listed_price:      p,
        shipping_cost:     s,
        condition,
        quantity:          Math.max(1, parseInt(quantity) || 1),
        ebay_url:          ebayUrl.trim() || null,
        notes:             notes.trim() || null,
        tcgplayer_listed:  tcgListed,
        // Set card_id to first linked card if only one, null if multiple
        card_id:       linkedCards.length === 1 && (linkedCards[0].qty ?? 1) === 1 ? linkedCards[0].id : null,
      }).eq('id', listing.id)
      if (err) throw err

      // Rebuild ebay_listing_cards junction rows
      await supabase.from('ebay_listing_cards').delete().eq('listing_id', listing.id)
      if (linkedCards.length > 0) {
        const totalQty = linkedCards.reduce((sum, c) => sum + (c.qty ?? 1), 0)
        const perCardPrice = parseFloat((p / totalQty).toFixed(2))
        await supabase.from('ebay_listing_cards').insert(
          linkedCards.map(c => ({ listing_id: listing.id, card_id: c.id, price: perCardPrice, quantity: c.qty ?? 1 }))
        )
      }

      // Adjust quantity_listed: old contribution → new contribution per card
      const oldListingQty = listing.quantity ?? 1
      const newListingQty = Math.max(1, parseInt(quantity) || 1)
      const oldContrib = {}
      for (const c of initialLinkedCards) oldContrib[c.id] = (oldContrib[c.id] ?? 0) + (c.qty ?? 1) * oldListingQty
      const newContrib = {}
      for (const c of linkedCards)        newContrib[c.id] = (newContrib[c.id] ?? 0) + (c.qty ?? 1) * newListingQty
      const affectedIds = new Set([...Object.keys(oldContrib), ...Object.keys(newContrib)])
      for (const cardId of affectedIds) {
        const delta = (newContrib[cardId] ?? 0) - (oldContrib[cardId] ?? 0)
        if (delta === 0) continue
        const { data: cardRow } = await supabase.from('cards').select('quantity_listed').eq('id', cardId).single()
        if (cardRow) await supabase.from('cards').update({
          quantity_listed: Math.max(0, (cardRow.quantity_listed ?? 0) + delta)
        }).eq('id', cardId)
      }

      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 560 }}>
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
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Condition</label>
              <select className="form-select" value={condition} onChange={e => setCondition(e.target.value)}>
                {['Near Mint','Lightly Played','Moderately Played','Heavily Played','Damaged'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ maxWidth: 100 }}>
              <label className="form-label">Qty listed</label>
              <input className="form-input" type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ textAlign: 'center' }} />
            </div>
          </div>
          {p > 0 && (
            <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              <span>Fee: <span className="text-gold">{usd(fee)}</span></span>
              <span>Net: <span className={net >= 0 ? 'text-success' : 'text-danger'}>{usd(net)}</span></span>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">eBay listing URL</label>
            <input className="form-input" type="text" value={ebayUrl} onChange={e => setEbayUrl(e.target.value)} placeholder="https://ebay.com/itm/…" />
          </div>

          {/* Card linking */}
          <div className="form-group">
            <label className="form-label">Linked cards</label>
            {/* Currently linked */}
            {loadingCards ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Loading…</div>
            ) : linkedCards.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {linkedCards.map(c => (
                  <div key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12, padding: '3px 8px',
                    background: 'rgba(201,168,76,0.08)',
                    border: '1px solid var(--border-mid)',
                    borderRadius: 4, color: 'var(--gold-light)',
                  }}>
                    {c.name}{c.foil ? ' ✦' : ''}
                    {(c.qty ?? 1) > 1 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>×{c.qty}</span>}
                    <button onClick={() => removeCard(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>No cards linked — search to add</div>
            )}
            {/* Card search */}
            <input
              className="form-input"
              placeholder="Search to link a card…"
              value={cardSearch}
              onChange={e => setCardSearch(e.target.value)}
              style={{ fontSize: 13 }}
            />
            {filteredCards.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginTop: 4, maxHeight: 200, overflowY: 'auto', background: 'var(--bg-void)' }}>
                {filteredCards.map(c => {
                  const isLinked = linkedCards.find(lc => lc.id === c.card_id)
                  return (
                    <div
                      key={c.card_id}
                      onClick={e => { e.stopPropagation(); addCard({ id: c.card_id, name: c.name, rarity: c.rarity, foil: c.foil, set_name: c.set_name }); setCardSearch('') }}
                      style={{
                        padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                        background: isLinked ? 'rgba(201,168,76,0.06)' : 'transparent',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ color: 'var(--text-primary)' }}>{c.name}{c.foil ? ' ✦' : ''}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{c.rarity} · {c.set_name}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
            <input type="checkbox" checked={tcgListed} onChange={e => setTcgListed(e.target.checked)} />
            <span className="form-label" style={{ margin: 0 }}>Also listed on TCGPlayer</span>
          </label>
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
  async function handleEnd() {
    setSaving(true)
    const listingQty = listing.quantity ?? 1

    if (listing.card_id) {
      const { data: cardRow } = await supabase.from('cards').select('quantity_listed').eq('id', listing.card_id).single()
      if (cardRow) await supabase.from('cards').update({
        quantity_listed: Math.max(0, (cardRow.quantity_listed ?? 0) - listingQty),
      }).eq('id', listing.card_id)
    } else {
      // Lot listing — decrement each card via ebay_listing_cards
      const { data: lotCards } = await supabase.from('ebay_listing_cards').select('card_id, quantity').eq('listing_id', listing.id)
      for (const lc of (lotCards ?? [])) {
        const qty = (lc.quantity ?? 1) * listingQty
        const { data: cardRow } = await supabase.from('cards').select('quantity_listed').eq('id', lc.card_id).single()
        if (cardRow) await supabase.from('cards').update({
          quantity_listed: Math.max(0, (cardRow.quantity_listed ?? 0) - qty),
        }).eq('id', lc.card_id)
      }
    }

    await supabase.from('ebay_listings').delete().eq('id', listing.id)
    onSaved()
  }
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

// ── Link card modal ──────────────────────────────────────────
function LinkCardModal({ listing, cards, onClose, onSaved }) {
  const [cardSearch, setCardSearch] = useState('')
  const [linkedCards, setLinkedCards] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filteredCards = cardSearch.length > 1
    ? (cards || []).filter(c =>
        c.name?.toLowerCase().includes(cardSearch.toLowerCase()) ||
        c.set_name?.toLowerCase().includes(cardSearch.toLowerCase())
      ).slice(0, 10)
    : []

  function addCard(card) {
    setLinkedCards(prev => prev.find(c => c.id === card.id) ? prev : [...prev, card])
    setCardSearch('')
  }

  async function handleSave() {
    if (!linkedCards.length) { setError('Select at least one card.'); return }
    setSaving(true); setError('')
    try {
      await supabase.from('ebay_listings').update({
        card_id: linkedCards.length === 1 ? linkedCards[0].id : null,
      }).eq('id', listing.id)

      await supabase.from('ebay_listing_cards').delete().eq('listing_id', listing.id)
      const perCardPrice = parseFloat(((listing.listed_price ?? 0) / linkedCards.length).toFixed(2))
      await supabase.from('ebay_listing_cards').insert(
        linkedCards.map(c => ({ listing_id: listing.id, card_id: c.id, price: perCardPrice, quantity: 1 }))
      )

      for (const c of linkedCards) {
        const { data: cardRow } = await supabase.from('cards').select('quantity_listed').eq('id', c.id).single()
        if (cardRow) await supabase.from('cards').update({ quantity_listed: (cardRow.quantity_listed ?? 0) + 1 }).eq('id', c.id)
      }
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Link card to listing</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>{listing.title}</div>

          {linkedCards.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {linkedCards.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 8px', background: 'rgba(201,168,76,0.08)', border: '1px solid var(--border-mid)', borderRadius: 4, color: 'var(--gold-light)' }}>
                  {c.name}{c.foil ? ' ✦' : ''}
                  <button onClick={() => setLinkedCards(prev => prev.filter(x => x.id !== c.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <div className="form-group" style={{ position: 'relative' }}>
            <input
              className="form-input"
              placeholder="Search cards to link…"
              value={cardSearch}
              onChange={e => setCardSearch(e.target.value)}
              autoFocus
            />
            {filteredCards.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-void)', zIndex: 10, maxHeight: 220, overflowY: 'auto' }}>
                {filteredCards.map(c => (
                  <div
                    key={c.card_id}
                    onClick={() => addCard({ id: c.card_id, name: c.name, rarity: c.rarity, foil: c.foil, set_name: c.set_name })}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span style={{ color: 'var(--text-primary)' }}>{c.name}{c.foil ? ' ✦' : ''}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{c.rarity} · {c.set_name}{c.tcg_market_price ? ` · ${usd(c.tcg_market_price)}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="alert-item danger mt-16"><span className="alert-content">{error}</span></div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !linkedCards.length}>
            {saving ? 'Saving…' : `Link ${linkedCards.length || ''} card${linkedCards.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function exportListingsCSV(listings, label) {
  const escape = v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const headers = ['Title', 'Cards', 'Price', 'Shipping', 'eBay Fee', 'Net', 'Days Listed', 'Listed Date', 'eBay URL']
  const rows = listings.map(l => [
    l.card_name || l.title,
    l.all_card_names && l.card_count > 1 ? l.all_card_names : '',
    l.listed_price != null ? Number(l.listed_price).toFixed(2) : '',
    l.shipping_cost != null ? Number(l.shipping_cost).toFixed(2) : '',
    l.ebay_fee != null ? Number(l.ebay_fee).toFixed(2) : '',
    l.net_listed != null ? Number(l.net_listed).toFixed(2) : '',
    l.days_listed ?? '',
    l.listed_at ? new Date(l.listed_at).toLocaleDateString('en-US') : '',
    l.ebay_url ?? '',
  ])
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ebay-${label}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main page ────────────────────────────────────────────────

// ── Delete sold listing modal ────────────────────────────────
function DeleteSoldModal({ listing, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  async function handleDelete() {
    setSaving(true)
    const listingQty = listing.quantity ?? 1
    // Restore quantity_owned to inventory (card is back in stock)
    if (listing.card_id) {
      const { data: cardRow } = await supabase.from('cards').select('quantity_owned').eq('id', listing.card_id).single()
      if (cardRow) await supabase.from('cards').update({ quantity_owned: (cardRow.quantity_owned ?? 0) + listingQty }).eq('id', listing.card_id)
    } else {
      // Lot listing — restore each card via ebay_listing_cards
      const { data: lotCards } = await supabase.from('ebay_listing_cards').select('card_id, quantity').eq('listing_id', listing.id)
      for (const lc of (lotCards ?? [])) {
        const qty = (lc.quantity ?? 1) * listingQty
        const { data: cardRow } = await supabase.from('cards').select('quantity_owned').eq('id', lc.card_id).single()
        if (cardRow) await supabase.from('cards').update({ quantity_owned: (cardRow.quantity_owned ?? 0) + qty }).eq('id', lc.card_id)
      }
    }
    await supabase.from('ebay_listings').delete().eq('id', listing.id)
    onSaved()
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Delete sold listing</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
            Permanently delete the sale record for <strong style={{ color: 'var(--text-primary)' }}>{listing.card_name || listing.title}</strong>?
          </p>
          <div className="alert-item warning">
            <span className="alert-icon">⚠️</span>
            <div className="alert-content">
              <div className="alert-title">Inventory will be restored</div>
              <div className="alert-desc">quantity_owned will be incremented by 1 since the card is back in stock.</div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={handleDelete} disabled={saving}>
            {saving ? 'Deleting…' : 'Delete record'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function EbayListings() {
  const [tab, setTab]           = useState('active')
  const [search, setSearch]         = useState('')
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)
  const [noUrlOnly, setNoUrlOnly]       = useState(false)
  const [listings, setListings] = useState([])
  const [cards, setCards]       = useState([])
  const [pnl, setPnl]           = useState(null)
  const [loading, setLoading]   = useState(true)
  const [boxCosts, setBoxCosts] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [soldTarget, setSoldTarget] = useState(null)
  const [endTarget, setEndTarget]   = useState(null)
  const [linkTarget, setLinkTarget] = useState(null)
  const [deleteSoldTarget, setDeleteSoldTarget] = useState(null)
  const [sortBy, setSortBy]     = useState('listed_at')
  const [sortDir, setSortDir]   = useState('desc')

  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')
  const highlightRef = useRef(null)

  // If arriving with a highlight param, force active tab
  useEffect(() => {
    if (highlightId) setTab('active')
  }, [highlightId])

  // Scroll to highlighted row after data loads and DOM renders
  useEffect(() => {
    if (!highlightId || loading) return
    const timer = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    return () => clearTimeout(timer)
  }, [highlightId, loading])

  const fetchCards = useCallback(async () => {
    if (cards.length > 0) return  // already loaded
    let allCards = [], cardPage = 0
    while (true) {
      const { data } = await supabase
        .from('v_latest_prices')
        .select('card_id, name, set_name, rarity, foil, tcg_market_price, cost_basis')
        .order('name')
        .range(cardPage * 1000, (cardPage + 1) * 1000 - 1)
      allCards = [...allCards, ...(data ?? [])]
      if (!data || data.length < 1000) break
      cardPage++
    }
    setCards(allCards)
  }, [cards.length])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [activeRes, soldRes, pnlRes] = await Promise.all([
      supabase.from('v_ebay_active').select('*'),
      supabase.from('v_ebay_sold').select('*'),
      supabase.from('v_global_pnl').select('*').single(),
    ])
    setListings([
      ...(activeRes.data || []).map(r => ({ ...r, status: 'active' })),
      ...(soldRes.data  || []).map(r => ({ ...r, status: 'sold'   })),
    ])
    setPnl(pnlRes.data)
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
    setShowCreate(false); setEditTarget(null); setSoldTarget(null); setEndTarget(null); setLinkTarget(null); setDeleteSoldTarget(null)
  }

  async function toggleTcgListed(listingId, current) {
    setListings(prev => prev.map(l => l.id === listingId ? { ...l, tcgplayer_listed: !current } : l))
    await supabase.from('ebay_listings').update({ tcgplayer_listed: !current }).eq('id', listingId)
  }

  const activeListings = listings.filter(l => l.status === 'active')
  const soldListings   = listings.filter(l => l.status === 'sold')
  const tabListings    = (tab === 'active' ? activeListings : soldListings).filter(l => {
    if (unlinkedOnly && (l.card_id || l.card_name || (l.card_count ?? 0) > 0)) return false
    if (noUrlOnly && l.ebay_url) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      l.title?.toLowerCase().includes(q) ||
      l.card_name?.toLowerCase().includes(q) ||
      l.set_name?.toLowerCase().includes(q) ||
      l.all_card_names?.toLowerCase().includes(q) ||
      l.ebay_url?.includes(q)
    )
  })

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
        <div className="flex gap-8">
          <button
            className="btn btn-ghost"
            onClick={() => exportListingsCSV(activeListings, 'active')}
            disabled={loading || activeListings.length === 0}
          >
            ↓ Export active CSV
          </button>
          <button className="btn btn-primary" onClick={() => { fetchCards(); setShowCreate(true) }}>+ New listing</button>
        </div>
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
          <div className="metric-value" style={{ color: totalNetProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtPnl(totalNetProfit)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Business profit</div>
          <div className="metric-value" style={{ color: businessProfit == null ? 'var(--text-primary)' : businessProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {businessProfit != null ? fmtPnl(businessProfit) : '…'}
          </div>
          <div className="metric-sub">revenue − fees − boxes</div>
        </div>
      </div>

      {/* Tab bar + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['active', `Active (${activeListings.length})`], ['sold', `Sold (${soldListings.length})`], ['pnl', 'Business P&L']].map(([id, label]) => (
            <button key={id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setTab(id); setSearch('') }}>{label}</button>
          ))}
        </div>
        <input
          className="form-input"
          style={{ maxWidth: 220, fontSize: 13 }}
          placeholder="Search listings…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          className={`btn btn-sm ${unlinkedOnly ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setUnlinkedOnly(p => !p)}
          style={{ whiteSpace: 'nowrap' }}
        >
          {unlinkedOnly ? '⚠ Unlinked Cards' : 'Show Unlinked Cards'}
        </button>
        <button
          className={`btn btn-sm ${noUrlOnly ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setNoUrlOnly(p => !p)}
          style={{ whiteSpace: 'nowrap' }}
        >
          {noUrlOnly ? '⚠ No eBay URL' : 'Show No eBay URL'}
        </button>
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
                    <th>Cards in lot</th>
                    <th onClick={() => toggleSort('quantity')} style={{ cursor: 'pointer', textAlign: 'right' }}>Qty <SortIcon col="quantity" /></th>
                    <th onClick={() => toggleSort('listed_price')} style={{ cursor: 'pointer', textAlign: 'right' }}>Price <SortIcon col="listed_price" /></th>
                    <th onClick={() => toggleSort('shipping_cost')} style={{ cursor: 'pointer', textAlign: 'right' }}>Shipping <SortIcon col="shipping_cost" /></th>
                    <th style={{ textAlign: 'right' }}>eBay fee</th>
                    <th onClick={() => toggleSort('net_listed')} style={{ cursor: 'pointer', textAlign: 'right' }}>Net <SortIcon col="net_listed" /></th>
                    <th onClick={() => toggleSort('days_listed')} style={{ cursor: 'pointer', textAlign: 'right' }}>Days <SortIcon col="days_listed" /></th>
                    <th onClick={() => toggleSort('listed_at')} style={{ cursor: 'pointer' }}>Listed <SortIcon col="listed_at" /></th>
                    <th></th>
                  </tr></thead>
                  <tbody>{sorted.map(l => {
                    const isHighlighted = highlightId && highlightId === String(l.id)
                    return (
                    <tr key={l.id} ref={isHighlighted ? highlightRef : null} style={isHighlighted ? { background: 'rgba(201,168,76,0.10)', outline: '1px solid rgba(201,168,76,0.4)' } : undefined}>
                      <td>
                        <div className="name-cell">{l.card_name || l.title}</div>
                        {l.card_name && <div className="set-cell">{l.rarity}{l.foil ? ' · Foil' : ''}{l.set_name ? ` · ${l.set_name}` : ''}{l.tcg_market_price ? ` · TCG ${usd(l.tcg_market_price)}` : ''}</div>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                          {l.ebay_url && (() => { const n = ebayItemNum(l.ebay_url); return <a href={l.ebay_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}>{n ? `#${n}` : '↗ eBay'}</a> })()}
                          {l.condition && <span className="badge badge-ordinary">{l.condition}</span>}
                          <button
                            onClick={e => { e.stopPropagation(); toggleTcgListed(l.id, l.tcgplayer_listed) }}
                            title={l.tcgplayer_listed ? 'Listed on TCGPlayer — click to unmark' : 'Not on TCGPlayer — click to mark'}
                            style={{
                              fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                              padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
                              border: l.tcgplayer_listed ? '1px solid rgba(96,165,250,0.4)' : '1px dashed var(--border)',
                              background: l.tcgplayer_listed ? 'rgba(96,165,250,0.12)' : 'transparent',
                              color: l.tcgplayer_listed ? '#60a5fa' : 'var(--text-muted)',
                            }}
                          >
                            TCG
                          </button>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 160 }}>
                        {(() => {
                          // Prefer junction table names, fall back to notes "Cards: x, y, z"
                          if (l.all_card_names && l.card_count > 1) {
                            return l.all_card_names.split(', ').map((name, i) => <div key={i}>{name}</div>)
                          }
                          const notesMatch = l.notes?.match(/Cards: ([^\n]+)/)
                          if (notesMatch) {
                            return notesMatch[1].split(', ').map((name, i) => <div key={i}>{name.replace(/ \(\$[\d.]+\)/, '')}</div>)
                          }
                          return <span style={{ color: 'var(--text-muted)' }}>—</span>
                        })()}
                      </td>
                      <td className="text-right" style={{ fontWeight: (l.quantity ?? 1) > 1 ? 600 : 400, color: (l.quantity ?? 1) > 1 ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 13 }}>
                        {l.quantity ?? 1}
                      </td>
                      <td className="text-right text-gold">{usd(l.listed_price)}</td>
                      <td className="text-right text-muted">{usd(l.shipping_cost)}</td>
                      <td className="text-right text-muted">{usd(l.ebay_fee)}</td>
                      <td className={`text-right ${l.net_listed >= 0 ? 'text-success' : 'text-danger'}`} style={{ fontWeight: 500 }}>{usd(l.net_listed)}</td>
                      <td className="text-right text-muted">{l.days_listed ?? 0}d</td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{fmtDate(l.listed_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {!l.card_name && !l.card_id && !(l.card_count > 0) && (
                            <button className="btn btn-sm btn-ghost" style={{ color: 'var(--gold)', borderColor: 'rgba(201,168,76,0.3)' }} onClick={() => { fetchCards(); setLinkTarget(l) }}>Link</button>
                          )}
                          <button className="btn btn-sm btn-ghost" style={{ color: 'var(--success)', borderColor: 'rgba(76,175,110,0.3)' }} onClick={() => setSoldTarget(l)}>Sold</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => { fetchCards(); setEditTarget(l) }}>Edit</button>
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setEndTarget(l)}>End</button>
                        </div>
                      </td>
                    </tr>
                  )})}</tbody>
                </>
              ) : (
                <>
                  <thead><tr>
                    <th onClick={() => toggleSort('title')} style={{ cursor: 'pointer' }}>Card <SortIcon col="title" /></th>
                    <th>Cards in lot</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th onClick={() => toggleSort('sold_price')} style={{ cursor: 'pointer', textAlign: 'right' }}>Sold for <SortIcon col="sold_price" /></th>
                    <th style={{ textAlign: 'right' }}>Shipping</th>
                    <th style={{ textAlign: 'right' }}>eBay fee</th>
                    <th style={{ textAlign: 'right' }}>Cost basis</th>
                    <th onClick={() => toggleSort('net_profit')} style={{ cursor: 'pointer', textAlign: 'right' }}>Net profit <SortIcon col="net_profit" /></th>
                    <th onClick={() => toggleSort('days_to_sell')} style={{ cursor: 'pointer', textAlign: 'right' }}>Days <SortIcon col="days_to_sell" /></th>
                    <th onClick={() => toggleSort('sold_at')} style={{ cursor: 'pointer' }}>Sold <SortIcon col="sold_at" /></th>
                    <th></th>
                  </tr></thead>
                  <tbody>{sorted.map(l => (
                    <tr key={l.id}>
                      <td>
                        <div className="name-cell">{l.card_name || l.title}</div>
                        {l.card_name && <div className="set-cell">{l.rarity}{l.foil ? ' · Foil' : ''}{l.set_name ? ` · ${l.set_name}` : ''}</div>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          {l.ebay_url && (() => { const n = ebayItemNum(l.ebay_url); return <a href={l.ebay_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--gold)', textDecoration: 'none', borderBottom: '1px dashed var(--gold)' }}>{n ? `#${n}` : '↗ eBay'}</a> })()}
                          {l.tcgplayer_listed && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(96,165,250,0.4)', background: 'rgba(96,165,250,0.12)', color: '#60a5fa', letterSpacing: '0.04em' }}>TCG</span>}
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 160 }}>
                        {(() => {
                          if (l.all_card_names && l.card_count > 1) {
                            return l.all_card_names.split(', ').map((name, i) => <div key={i}>{name}</div>)
                          }
                          const notesMatch = l.notes?.match(/Cards: ([^\n]+)/)
                          if (notesMatch) {
                            return notesMatch[1].split(', ').map((name, i) => <div key={i}>{name.replace(/ \(\$[\d.]+\)/, '')}</div>)
                          }
                          return <span style={{ color: 'var(--text-muted)' }}>—</span>
                        })()}
                      </td>
                      <td className="text-right text-muted" style={{ fontSize: 13 }}>{l.quantity ?? 1}</td>
                      <td className="text-right text-gold">{usd(l.sold_price)}</td>
                      <td className="text-right text-muted">{usd(l.sold_shipping)}</td>
                      <td className="text-right text-muted">{usd(l.sold_ebay_fee)}</td>
                      <td className="text-right text-muted">{usd(l.cost_basis)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500, color: Number(l.net_profit) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtPnl(l.net_profit)}</td>
                      <td className="text-right text-muted">{l.days_to_sell ?? '—'}d</td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{fmtDate(l.sold_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setSoldTarget(l)}>Edit sale</button>
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setDeleteSoldTarget(l)}>Delete</button>
                        </div>
                      </td>
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
              <div className="metric-value" style={{ fontSize: 32, color: businessProfit == null ? 'var(--text-primary)' : businessProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {businessProfit != null ? fmtPnl(businessProfit) : '…'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && <CreateModal cards={cards} onClose={() => setShowCreate(false)} onSaved={onSaved} />}
      {editTarget  && <EditModal  listing={editTarget} cards={cards} onClose={() => setEditTarget(null)} onSaved={onSaved} />}
      {soldTarget  && <SoldModal  listing={soldTarget} onClose={() => setSoldTarget(null)} onSaved={onSaved} />}
      {endTarget   && <EndModal   listing={endTarget}  onClose={() => setEndTarget(null)}  onSaved={onSaved} />}
      {linkTarget  && <LinkCardModal listing={linkTarget} cards={cards} onClose={() => setLinkTarget(null)} onSaved={onSaved} />}
      {deleteSoldTarget && <DeleteSoldModal listing={deleteSoldTarget} onClose={() => setDeleteSoldTarget(null)} onSaved={onSaved} />}
    </div>
  )
}