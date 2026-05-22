import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const usd  = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—'
const date = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const BOX_TYPES = ['booster_box', 'prerelease_kit', 'single_booster', 'bundle', 'other']
const SETS = ['Alpha', 'Beta', 'Arthurian Legends', 'Gothic', 'Other']

const BLANK = { name: '',set_name: 'Gothic', box_type: 'booster_box', purchase_price: '', purchased_at: '', seller: '', notes: '' }

export default function Boxes() {
  const [boxes, setBoxes]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(false)
  const [form, setForm]         = useState(BLANK)
  const [saving, setSaving]     = useState(false)
  const [selected, setSelected] = useState(null)   // box id for drill-down
  const [boxCards, setBoxCards] = useState([])
  const [cardsLoading, setCardsLoading] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('v_box_pnl')
      .select('*')
      .order('purchased_at', { ascending: false })
    setBoxes(data ?? [])
    setLoading(false)
  }

  async function loadBoxCards(boxId) {
    setCardsLoading(true)

    // Get all packs for this box, then all cards from those packs
    const { data: packs } = await supabase
      .from('packs')
      .select('id')
      .eq('box_id', boxId)

    const packIds = (packs ?? []).map(p => p.id)
    if (!packIds.length) { setBoxCards([]); setCardsLoading(false); return }

    const { data: packCards } = await supabase
      .from('pack_cards')
      .select(`
        quantity,
        pack_id,
        packs ( pack_number ),
        cards (
          id, name, rarity, condition, tcgplayer_id
        )
      `)
      .in('pack_id', packIds)

    // Get latest prices
    const cardIds = (packCards ?? []).map(r => r.cards?.id).filter(Boolean)
    let prices = []
    if (cardIds.length) {
      const { data: priceData } = await supabase
        .from('v_latest_prices')
        .select('card_id, tcgplayer_market, ebay_sold_avg')
        .in('card_id', cardIds)
      prices = priceData ?? []
    }
    const priceMap = Object.fromEntries(prices.map(p => [p.card_id, p]))

    setBoxCards((packCards ?? []).map(row => ({
      ...row,
      pack_number: row.packs?.pack_number ?? null,
      price: priceMap[row.cards?.id] ?? null,
    })))
    setCardsLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (selected) loadBoxCards(selected)
    else setBoxCards([])
  }, [selected])

  const totalCost  = boxes.reduce((s, b) => s + Number(b.purchase_price || 0), 0)
  const totalValue = boxes.reduce((s, b) => s + Number(b.cards_market_value || 0), 0)
  const totalPnl   = boxes.reduce((s, b) => s + Number(b.gross_pnl || 0), 0)

  const selectedBox = boxes.find(b => b.id === selected)

  const f = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))

  async function save() {
    setSaving(true)
    await supabase.from('boxes').insert({
      set_name:       form.set_name,
      box_type:       form.box_type,
      purchase_price: Number(form.purchase_price),
      purchased_at:   form.purchased_at ? new Date(form.purchased_at).toISOString() : new Date().toISOString(),
      seller:         form.seller || null,
      notes:          form.notes || null,
    })
    setSaving(false)
    setModal(false)
    setForm(BLANK)
    load()
  }

  async function markOpened(boxId) {
    await supabase.from('boxes').update({ opened_at: new Date().toISOString() }).eq('id', boxId)
    load()
  }

  return (
    <div className="page">
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Boxes & P&L</h1>
          <p className="page-subtitle">{boxes.length} boxes tracked</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add box</button>
      </div>

      {/* Summary metrics */}
      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-label">Total invested</div>
          <div className="metric-value">{usd(totalCost)}</div>
          <div className="metric-sub">{boxes.length} boxes</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Cards market value</div>
          <div className="metric-value gold">{usd(totalValue)}</div>
          <div className="metric-sub">at current prices</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Gross P&L</div>
          <div className={`metric-value ${totalPnl >= 0 ? 'success' : 'danger'}`}>
            {totalPnl >= 0 ? '+' : ''}{usd(totalPnl)}
          </div>
          <div className="metric-sub">unrealized</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 16 }}>

        {/* Boxes list */}
        <div>
          {loading ? (
            <div className="loading">Loading boxes…</div>
          ) : boxes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📦</div>
              No boxes yet — add one to start tracking P&L.
            </div>
          ) : (
            <div className="panel">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Box</th>
                    <th>Type</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Card value</th>
                    <th className="text-right">P&L</th>
                    <th className="text-right">Cards</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {boxes.map(box => (
                    <tr
                      key={box.id}
                      style={{
                        cursor: 'pointer',
                        background: selected === box.id ? 'var(--bg-hover)' : undefined,
                        borderLeft: selected === box.id ? '2px solid var(--gold)' : '2px solid transparent',
                      }}
                      onClick={() => setSelected(selected === box.id ? null : box.id)}
                    >
                      <td>
                        <div className="name-cell">{box.name ?? box.set_name}</div>
                        <div className="set-cell">{date(box.purchased_at)}</div>
                      </td>
                      <td className="text-muted" style={{ fontSize: 12 }}>
                        {box.box_type?.replace(/_/g, ' ')}
                      </td>
                      <td className="text-right">{usd(box.purchase_price)}</td>
                      <td className="text-right text-gold">{usd(box.cards_market_value)}</td>
                      <td className="text-right">
                        <span className={box.gross_pnl >= 0 ? 'text-success' : 'text-danger'}>
                          {box.gross_pnl >= 0 ? '+' : ''}{usd(box.gross_pnl)}
                        </span>
                      </td>
                      <td className="text-right">{box.distinct_cards_pulled ?? 0}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {!box.opened_at && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={e => { e.stopPropagation(); markOpened(box.id) }}
                            >
                              Mark opened
                            </button>
                          )}
                          {box.opened_at && (
                            <span className="badge badge-ok" style={{ fontSize: 10 }}>Opened</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Drill-down panel */}
        {selected && (
          <div>
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">{selectedBox?.set_name} — Cards pulled</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {selectedBox?.box_type?.replace(/_/g, ' ')} · {usd(selectedBox?.purchase_price)} cost
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>✕</button>
              </div>

              {/* Box P&L summary */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid var(--border)' }}>
                {[
                  ['Cost', usd(selectedBox?.purchase_price), ''],
                  ['Card value', usd(selectedBox?.cards_market_value), 'gold'],
                  ['P&L', `${selectedBox?.gross_pnl >= 0 ? '+' : ''}${usd(selectedBox?.gross_pnl)}`, selectedBox?.gross_pnl >= 0 ? 'success' : 'danger'],
                ].map(([label, val, cls]) => (
                  <div key={label} style={{ padding: '12px 16px', borderRight: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                    <div className={`metric-value ${cls}`} style={{ fontSize: 18 }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Cards table */}
              {cardsLoading ? (
                <div className="loading" style={{ padding: 24 }}>Loading cards…</div>
              ) : boxCards.length === 0 ? (
                <div className="empty-state" style={{ padding: 32 }}>
                  <div className="empty-state-icon">🃏</div>
                  No cards linked to this box yet.
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    Set <code style={{ background: 'var(--bg-void)', padding: '1px 5px', borderRadius: 4 }}>box_ref</code> in your import sheet to link cards.
                  </div>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Card</th>
                      <th>Pack</th>
                      <th>Rarity</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">TCGPlayer</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boxCards
                      .sort((a, b) => (a.pack_number ?? 0) - (b.pack_number ?? 0))
                      .map((row, i) => {
                        const card     = row.cards
                        const mktPrice = row.price?.tcgplayer_market
                        const value    = mktPrice ? mktPrice * row.quantity : null
                        return (
                          <tr key={i}>
                            <td className="name-cell">{card?.name}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              #{row.pack_number ?? '—'}
                            </td>
                            <td>
                              <span className={`badge badge-${card?.rarity}`}>{card?.rarity}</span>
                            </td>
                            <td className="text-right">{row.quantity}</td>
                            <td className="text-right">{usd(mktPrice)}</td>
                            <td className="text-right text-gold">{usd(value)}</td>
                          </tr>
                        )
                      })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                        Total card value
                      </td>
                      <td className="text-right text-gold" style={{ padding: '10px 14px', fontWeight: 500, borderTop: '1px solid var(--border)' }}>
                        {usd(boxCards.reduce((s, r) => s + (r.price?.tcgplayer_market ?? 0) * r.quantity, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add box modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Add box</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                 <label className="form-label">Box name</label>
                 <input className="form-input" value={form.name ?? ''} 
                  onChange={f('name')} placeholder="e.g. Gothic Box 1" />
                </div>
                <div className="form-group">
                  <label className="form-label">Set</label>
                  <select className="form-select" value={form.set_name} onChange={f('set_name')}>
                    {SETS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Box type</label>
                  <select className="form-select" value={form.box_type} onChange={f('box_type')}>
                    {BOX_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Purchase price ($) *</label>
                  <input className="form-input" type="number" step="0.01" value={form.purchase_price} onChange={f('purchase_price')} placeholder="e.g. 180.00 for 36 packs" />
                </div>
                <div className="form-group">
                  <label className="form-label">Purchase date</label>
                  <input className="form-input" type="date" value={form.purchased_at} onChange={f('purchased_at')} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Seller / source</label>
                <input className="form-input" value={form.seller} onChange={f('seller')} placeholder="e.g. local game store" />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" value={form.notes} onChange={f('notes')} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.purchase_price || saving}>
                {saving ? 'Saving…' : 'Add box'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}