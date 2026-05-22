import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const usd = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—'

const RARITIES   = ['ordinary', 'exceptional', 'elite', 'unique']
const CONDITIONS = ['near_mint', 'lightly_played', 'moderately_played', 'heavily_played', 'damaged']
const SETS       = ['Alpha', 'Beta', 'Arthurian Legends', 'Other']

const BLANK = {
  name: '', set_name: 'Alpha', set_code: '', rarity: 'elite',
  condition: 'near_mint', foil: false, quantity_owned: 1,
  cost_basis: '', image_url: '', tcgplayer_id: '', notes: '',
}

export default function Inventory() {
  const [cards, setCards]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [modal, setModal]       = useState(null)   // null | 'add' | 'edit'
  const [form, setForm]         = useState(BLANK)
  const [saving, setSaving]     = useState(false)
  const [deleteId, setDeleteId] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('v_inventory_dashboard')
      .select('*')
      .order('name')
    setCards(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = cards.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.set_name?.toLowerCase().includes(search.toLowerCase())
  )

  function openAdd() { setForm(BLANK); setModal('add') }
  function openEdit(card) {
    setForm({
      ...card,
      cost_basis: card.cost_basis ?? '',
      image_url:  card.image_url  ?? '',
      tcgplayer_id: card.tcgplayer_id ?? '',
      notes: card.notes ?? '',
    })
    setModal('edit')
  }
  function closeModal() { setModal(null); setForm(BLANK) }

  async function save() {
    setSaving(true)
    const payload = {
      name:           form.name,
      set_name:       form.set_name,
      set_code:       form.set_code || null,
      rarity:         form.rarity,
      condition:      form.condition,
      foil:           form.foil,
      quantity_owned: Number(form.quantity_owned),
      cost_basis:     form.cost_basis !== '' ? Number(form.cost_basis) : null,
      image_url:      form.image_url  || null,
      tcgplayer_id:   form.tcgplayer_id || null,
      notes:          form.notes || null,
    }
    if (modal === 'add') {
      await supabase.from('cards').insert(payload)
    } else {
      await supabase.from('cards').update(payload).eq('id', form.id)
    }
    setSaving(false)
    closeModal()
    load()
  }

  async function confirmDelete() {
    await supabase.from('cards').delete().eq('id', deleteId)
    setDeleteId(null)
    load()
  }

  const f = (field) => (e) => setForm(prev => ({
    ...prev,
    [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value
  }))

  return (
    <div className="page">
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">{cards.length} cards tracked</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add card</button>
      </div>

      {/* Search */}
      <div className="mb-16">
        <input
          className="form-input"
          style={{ maxWidth: 320 }}
          placeholder="Search cards or sets…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading">Loading inventory…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🃏</div>
          {search ? 'No cards match your search.' : 'No cards yet — click Add card to get started.'}
        </div>
      ) : (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Rarity</th>
                <th>Condition</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Cost basis</th>
                <th className="text-right">TCGPlayer</th>
                <th className="text-right">eBay avg</th>
                <th className="text-right">Market value</th>
                <th className="text-right">P&L</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(card => (
                <tr key={card.id}>
                  <td>
                    <div className="name-cell">{card.name}</div>
                    <div className="set-cell">{card.set_name}{card.foil ? ' · Foil' : ''}</div>
                  </td>
                  <td><span className={`badge badge-${card.rarity}`}>{card.rarity}</span></td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    {card.condition?.replace(/_/g, ' ')}
                  </td>
                  <td className="text-right">{card.quantity_owned}</td>
                  <td className="text-right text-muted">{usd(card.cost_basis)}</td>
                  <td className="text-right">{usd(card.tcgplayer_market)}</td>
                  <td className="text-right">{usd(card.ebay_sold_avg)}</td>
                  <td className="text-right text-gold">{usd(card.market_value)}</td>
                  <td className="text-right">
                    <span className={card.unrealized_pnl >= 0 ? 'text-success' : 'text-danger'}>
                      {card.unrealized_pnl != null
                        ? `${card.unrealized_pnl >= 0 ? '+' : ''}${usd(card.unrealized_pnl)}`
                        : '—'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-8" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(card)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(card.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{modal === 'add' ? 'Add card' : 'Edit card'}</span>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Card name *</label>
                <input className="form-input" value={form.name} onChange={f('name')} placeholder="e.g. Grandmother of Sharks" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Set</label>
                  <select className="form-select" value={form.set_name} onChange={f('set_name')}>
                    {SETS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Set code</label>
                  <input className="form-input" value={form.set_code} onChange={f('set_code')} placeholder="e.g. ALP" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Rarity</label>
                  <select className="form-select" value={form.rarity} onChange={f('rarity')}>
                    {RARITIES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Condition</label>
                  <select className="form-select" value={form.condition} onChange={f('condition')}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Quantity owned</label>
                  <input className="form-input" type="number" min="0" value={form.quantity_owned} onChange={f('quantity_owned')} />
                </div>
                <div className="form-group">
                  <label className="form-label">Cost basis ($)</label>
                  <input className="form-input" type="number" step="0.01" min="0" value={form.cost_basis} onChange={f('cost_basis')} placeholder="Total paid for all copies" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">TCGPlayer ID (optional)</label>
                <input className="form-input" value={form.tcgplayer_id} onChange={f('tcgplayer_id')} placeholder="Product ID from TCGPlayer URL" />
              </div>
              <div className="form-group">
                <label className="form-label">Image URL (optional)</label>
                <input className="form-input" value={form.image_url} onChange={f('image_url')} placeholder="https://…" />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" value={form.notes} onChange={f('notes')} placeholder="Any notes about this card…" />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.foil} onChange={f('foil')} />
                  <span className="form-label" style={{ margin: 0 }}>Foil</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.name || saving}>
                {saving ? 'Saving…' : modal === 'add' ? 'Add card' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Delete card?</span>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                This will permanently remove the card and all its price history. This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
