import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const usd = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—'
const date = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const STATUS_LABELS = ['all', 'active', 'sold', 'ended', 'cancelled']

const BLANK_LISTING = {
  card_id: '', ebay_item_id: '', list_price: '', shipping_cost: '0',
  quantity: 1, status: 'active', notes: '',
}

export default function Listings() {
  const [listings, setListings] = useState([])
  const [cards, setCards]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [modal, setModal]       = useState(false)
  const [form, setForm]         = useState(BLANK_LISTING)
  const [saving, setSaving]     = useState(false)

  async function load() {
    setLoading(true)
    const [listRes, cardRes] = await Promise.all([
      supabase
        .from('ebay_listings')
        .select('*, cards(name, set_name, rarity)')
        .order('listed_at', { ascending: false }),
      supabase.from('cards').select('id, name, set_name').order('name'),
    ])
    setListings(listRes.data ?? [])
    setCards(cardRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = statusFilter === 'all'
    ? listings
    : listings.filter(l => l.status === statusFilter)

  const totalActive    = listings.filter(l => l.status === 'active').reduce((s, l) => s + Number(l.list_price || 0), 0)
  const totalSold      = listings.filter(l => l.status === 'sold').reduce((s, l) => s + Number(l.net_proceeds || 0), 0)

  const f = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))

  async function save() {
    setSaving(true)
    await supabase.from('ebay_listings').insert({
      card_id:       form.card_id,
      ebay_item_id:  form.ebay_item_id || null,
      list_price:    Number(form.list_price),
      shipping_cost: Number(form.shipping_cost),
      quantity:      Number(form.quantity),
      status:        form.status,
      notes:         form.notes || null,
    })
    setSaving(false)
    setModal(false)
    setForm(BLANK_LISTING)
    load()
  }

  async function markSold(listing) {
    const soldPrice = prompt(`Sold price for ${listing.cards?.name}? (Enter amount in $)`)
    if (!soldPrice) return
    const fees = prompt('eBay fees? (Enter amount in $, or 0)')
    await supabase.from('ebay_listings').update({
      status:     'sold',
      sold_price: Number(soldPrice),
      ebay_fees:  Number(fees || 0),
      sold_at:    new Date().toISOString(),
    }).eq('id', listing.id)
    load()
  }

  return (
    <div className="page">
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">eBay Listings</h1>
          <p className="page-subtitle">{listings.filter(l => l.status === 'active').length} active · {usd(totalActive)} listed value</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add listing</button>
      </div>

      {/* Summary metrics */}
      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-label">Active listings value</div>
          <div className="metric-value gold">{usd(totalActive)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total net proceeds</div>
          <div className="metric-value success">{usd(totalSold)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total listings</div>
          <div className="metric-value">{listings.length}</div>
        </div>
      </div>

      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {STATUS_LABELS.map(s => (
          <button
            key={s}
            className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setStatusFilter(s)}
            style={{ textTransform: 'capitalize' }}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading listings…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏷️</div>
          No listings found.
        </div>
      ) : (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>eBay ID</th>
                <th>Status</th>
                <th className="text-right">List price</th>
                <th className="text-right">Shipping</th>
                <th className="text-right">Sold price</th>
                <th className="text-right">Net proceeds</th>
                <th>Listed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(listing => (
                <tr key={listing.id}>
                  <td>
                    <div className="name-cell">{listing.cards?.name}</div>
                    <div className="set-cell">{listing.cards?.set_name}</div>
                  </td>
                  <td>
                    {listing.ebay_item_id
                      ? <a href={`https://www.ebay.com/itm/${listing.ebay_item_id}`} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--info)', fontSize: 12, textDecoration: 'none' }}>
                          #{listing.ebay_item_id}
                        </a>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <span className={`badge badge-${listing.status === 'active' ? 'active' : listing.status === 'sold' ? 'ok' : 'ordinary'}`}>
                      {listing.status}
                    </span>
                  </td>
                  <td className="text-right">{usd(listing.list_price)}</td>
                  <td className="text-right text-muted">{usd(listing.shipping_cost)}</td>
                  <td className="text-right">{usd(listing.sold_price)}</td>
                  <td className="text-right text-success">{usd(listing.net_proceeds)}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{date(listing.listed_at)}</td>
                  <td>
                    {listing.status === 'active' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => markSold(listing)}>
                        Mark sold
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add listing modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Add eBay listing</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Card *</label>
                <select className="form-select" value={form.card_id} onChange={f('card_id')}>
                  <option value="">Select a card…</option>
                  {cards.map(c => (
                    <option key={c.id} value={c.id}>{c.name} — {c.set_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">List price ($) *</label>
                  <input className="form-input" type="number" step="0.01" value={form.list_price} onChange={f('list_price')} />
                </div>
                <div className="form-group">
                  <label className="form-label">Shipping ($)</label>
                  <input className="form-input" type="number" step="0.01" value={form.shipping_cost} onChange={f('shipping_cost')} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">eBay item ID</label>
                  <input className="form-input" value={form.ebay_item_id} onChange={f('ebay_item_id')} placeholder="From your eBay listing URL" />
                </div>
                <div className="form-group">
                  <label className="form-label">Quantity</label>
                  <input className="form-input" type="number" min="1" value={form.quantity} onChange={f('quantity')} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" value={form.notes} onChange={f('notes')} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}
                disabled={!form.card_id || !form.list_price || saving}>
                {saving ? 'Saving…' : 'Add listing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
