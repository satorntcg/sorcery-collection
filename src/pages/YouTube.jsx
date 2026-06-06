import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const usd  = (n) => n != null ? `$${Number(n).toFixed(2)}` : '—'
const date = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// ─────────────────────────────────────────
// Shareable summary card (screenshot target)
// ─────────────────────────────────────────
function SummaryCard({ opening, packs }) {
  const cardRef = useRef(null)

  const bestPull = packs
    .flatMap(p => p.cards)
    .sort((a, b) => (b.tcgplayer_market ?? 0) - (a.tcgplayer_market ?? 0))[0]

  const packBreakdown = packs.map(pack => ({
    number: pack.pack_number,
    value:  pack.cards.reduce((s, c) => s + (c.tcgplayer_market ?? 0) * c.quantity, 0),
    cards:  pack.cards,
  }))

  const trackedValue = packBreakdown.reduce((s, p) => s + p.value, 0)
  const ordinaryEst  = packs.length * 1.00
  const totalValue   = trackedValue + ordinaryEst
  const totalCost    = packs.length * (opening.pack_msrp ?? 5)
  const pnl          = totalValue - totalCost
  const evPerPack    = packs.length > 0 ? totalValue / packs.length : 0
  const projBox    = evPerPack * (opening.pack_count ?? 36)
  const projBoxPnl = projBox - (opening.box_cost ?? 0)
  const boxLabel   = opening.box_name ?? opening.set_name ?? 'Unknown Box'

  return (
    <div>
      <div ref={cardRef} style={{
        background: 'linear-gradient(135deg, #0F0D0B 0%, #1A1712 100%)',
        border: '1px solid rgba(201,168,76,0.4)',
        borderRadius: 16,
        padding: 28,
        maxWidth: 640,
        fontFamily: 'var(--font-body)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.14em', color: 'var(--gold)', textTransform: 'uppercase', marginBottom: 6 }}>
              Sorcery TCG · {boxLabel}
            </div>
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)' }}>{opening.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {boxLabel} · {date(opening.filmed_at)} · {packs.length} packs opened
            </div>
          </div>
          {opening.youtube_url && (
            <a href={opening.youtube_url} target="_blank" rel="noreferrer" style={{
              background: '#FF0000', color: '#fff', borderRadius: 6,
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              textDecoration: 'none', flexShrink: 0,
            }}>▶ Watch</a>
          )}
        </div>

        {/* Main metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 6 }}>
          {[
            { label: 'Total value', value: usd(totalValue), color: 'var(--gold-light)' },
            { label: 'Cost', value: usd(totalCost), color: 'var(--text-secondary)' },
            { label: pnl >= 0 ? 'Profit' : 'Loss', value: `${pnl >= 0 ? '+' : ''}${usd(pnl)}`, color: pnl >= 0 ? 'var(--success)' : 'var(--danger)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 300, color }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginBottom: 12 }}>
          Includes {usd(ordinaryEst)} ordinary card est. ({packs.length} × $1.00)
        </div>

        {/* Box projection */}
        <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--gold-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            {boxLabel} · Box projection (based on {packs.length} of {opening.pack_count ?? 36} packs)
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>EV per pack</div>
              <div style={{ fontSize: 16, color: 'var(--gold-light)' }}>{usd(evPerPack)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Projected box value</div>
              <div style={{ fontSize: 16, color: 'var(--gold-light)' }}>{usd(projBox)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Projected box P&L</div>
              <div style={{ fontSize: 16, color: projBoxPnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {projBoxPnl >= 0 ? '+' : ''}{usd(projBoxPnl)}
              </div>
            </div>
          </div>
        </div>

        {/* Best pull */}
        {bestPull && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            <span style={{ fontSize: 20 }}>⭐</span>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Best pull</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{bestPull.name}</div>
              <div style={{ fontSize: 12, color: 'var(--gold-light)' }}>{usd(bestPull.tcgplayer_market)} TCGPlayer</div>
            </div>
          </div>
        )}

        {/* Pack breakdown grid */}
        <div style={{ borderTop: '1px solid rgba(201,168,76,0.1)', paddingTop: 14 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Pack breakdown</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {packBreakdown.map(p => {
              const displayVal = p.value + 1.00
              const beats      = displayVal >= (opening.pack_msrp ?? 5)
              return (
                <div key={p.number} style={{
                  background: beats ? 'rgba(76,175,110,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${beats ? 'rgba(76,175,110,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 8, padding: '8px 6px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Pack {p.number}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: beats ? 'var(--success)' : 'var(--text-secondary)' }}>
                    {usd(displayVal)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
          satorntcg · {boxLabel} · Prices via TCGPlayer
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        💡 Right-click the card above and "Save image as" to screenshot, or use Windows Snipping Tool
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// New opening modal
// ─────────────────────────────────────────
function NewOpeningModal({ onClose, onCreated }) {
  const [boxes, setBoxes]             = useState([])
  const [boxId, setBoxId]             = useState('')
  const [packs, setPacks]             = useState([])
  const [selectedPacks, setSelectedPacks] = useState([])
  const [title, setTitle]             = useState('')
  const [youtubeUrl, setYoutubeUrl]   = useState('')
  const [filmedAt, setFilmedAt]       = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    supabase
      .from('boxes')
      .select('id, name, set_name, box_type, pack_count, pack_msrp, purchase_price')
      .order('purchased_at', { ascending: false })
      .then(({ data }) => setBoxes(data ?? []))
  }, [])

  useEffect(() => {
    if (!boxId) { setPacks([]); return }
    supabase
      .from('packs')
      .select('id, pack_number')
      .eq('box_id', boxId)
      .order('pack_number')
      .then(({ data }) => setPacks(data ?? []))
    setSelectedPacks([])
  }, [boxId])

  function togglePack(packId) {
    setSelectedPacks(prev =>
      prev.includes(packId) ? prev.filter(id => id !== packId) : [...prev, packId]
    )
  }

  function selectRange(start, end) {
    const inRange = packs
      .filter(p => p.pack_number >= start && p.pack_number <= end)
      .map(p => p.id)
    setSelectedPacks(inRange)
  }

  async function save() {
    if (!title || !boxId || !selectedPacks.length) return
    setSaving(true)

    const { data: opening, error } = await supabase
      .from('youtube_openings')
      .insert({
        title,
        box_id:      boxId,
        youtube_url: youtubeUrl || null,
        filmed_at:   new Date(filmedAt).toISOString(),
      })
      .select('id')
      .single()

    if (error) { console.error(error); setSaving(false); return }

    await supabase.from('youtube_opening_packs').insert(
      selectedPacks.map(pack_id => ({ opening_id: opening.id, pack_id }))
    )

    setSaving(false)
    onCreated(opening.id)
  }

  const selectedBox = boxes.find(b => b.id === boxId)
  const boxLabel    = (b) => b.name ? `${b.name} — ${b.set_name}` : b.set_name

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">New YouTube Opening</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Video title *</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Gothic Box 1 — 12-Pack Opening #1" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Box *</label>
              <select className="form-select" value={boxId} onChange={e => setBoxId(e.target.value)}>
                <option value="">Select a box…</option>
                {boxes.map(b => (
                  <option key={b.id} value={b.id}>
                    {boxLabel(b)} ({b.box_type?.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Filmed date</label>
              <input className="form-input" type="date" value={filmedAt}
                onChange={e => setFilmedAt(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">YouTube URL (optional)</label>
            <input className="form-input" value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..." />
          </div>

          {/* Pack selector */}
          {packs.length > 0 && (
            <div className="form-group">
              <label className="form-label">
                Select packs in this video ({selectedPacks.length} selected)
              </label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {[[1,12],[13,24],[25,36]].map(([s, e]) => (
                  <button key={s} className="btn btn-ghost btn-sm" onClick={() => selectRange(s, e)}>
                    Packs {s}–{e}
                  </button>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedPacks([])}>Clear</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                {packs.map(pack => (
                  <button
                    key={pack.id}
                    onClick={() => togglePack(pack.id)}
                    style={{
                      padding: '6px 4px', borderRadius: 6, border: '1px solid',
                      cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-body)',
                      background:   selectedPacks.includes(pack.id) ? 'rgba(201,168,76,0.15)' : 'var(--bg-void)',
                      borderColor:  selectedPacks.includes(pack.id) ? 'var(--gold)' : 'var(--border)',
                      color:        selectedPacks.includes(pack.id) ? 'var(--gold-light)' : 'var(--text-muted)',
                    }}
                  >
                    #{pack.pack_number}
                  </button>
                ))}
              </div>
              {selectedBox && selectedPacks.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  {selectedBox.name ?? selectedBox.set_name} · Cost: {usd(selectedPacks.length * (selectedBox.pack_msrp ?? 5))} ·
                  {' '}{selectedPacks.length}/{selectedBox.pack_count ?? 36} packs
                  ({Math.round(selectedPacks.length / (selectedBox.pack_count ?? 36) * 100)}% of box)
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}
            disabled={!title || !boxId || !selectedPacks.length || saving}>
            {saving ? 'Creating…' : 'Create opening'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// Main YouTube page
// ─────────────────────────────────────────
export default function YouTube() {
  const [openings, setOpenings]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [showModal, setShowModal]     = useState(false)
  const [selected, setSelected]       = useState(null)
  const [packData, setPackData]       = useState([])
  const [packLoading, setPackLoading] = useState(false)
  const [openingMeta, setOpeningMeta] = useState(null)
  const [editingUrl, setEditingUrl]     = useState(null)
  const [urlDraft, setUrlDraft]         = useState('')
  const [editingShortsUrl, setEditingShortsUrl] = useState(null)
  const [shortsDraft, setShortsDraft]   = useState('')
  const [shortsMap, setShortsMap]       = useState({})
  const [search, setSearch]             = useState('')
  const [sortBy, setSortBy]             = useState('date_desc')

  async function load() {
    setLoading(true)
    const [{ data }, { data: shortsData }] = await Promise.all([
      supabase.from('v_youtube_opening_summary').select('*').order('filmed_at', { ascending: false }),
      supabase.from('youtube_openings').select('id, shorts_url'),
    ])
    setOpenings(data ?? [])
    const map = {}
    for (const r of (shortsData ?? [])) map[r.id] = r.shorts_url
    setShortsMap(map)
    setLoading(false)
  }

  async function loadOpening(openingId) {
    setPackLoading(true)
    setSelected(openingId)

    const { data: meta } = await supabase
      .from('v_youtube_opening_summary')
      .select('*')
      .eq('id', openingId)
      .single()
    setOpeningMeta(meta)

    const { data: openingPacks } = await supabase
      .from('youtube_opening_packs')
      .select('pack_id')
      .eq('opening_id', openingId)

    const packIds = (openingPacks ?? []).map(p => p.pack_id)

    const { data: packs } = await supabase
      .from('packs')
      .select('id, pack_number')
      .in('id', packIds)
      .order('pack_number')

    const packsWithCards = await Promise.all(
      (packs ?? []).map(async pack => {
        const { data: packCards } = await supabase
          .from('pack_cards')
          .select('quantity, cards(id, name, rarity, condition, tcgplayer_id)')
          .eq('pack_id', pack.id)

        const cardIds = (packCards ?? []).map(pc => pc.cards?.id).filter(Boolean)
        let prices = []
        if (cardIds.length) {
          const { data: priceData } = await supabase
            .from('v_latest_prices')
            .select('card_id, tcgplayer_market')
            .in('card_id', cardIds)
          prices = priceData ?? []
        }
        const priceMap = Object.fromEntries(prices.map(p => [p.card_id, p.tcgplayer_market]))

        return {
          ...pack,
          cards: (packCards ?? []).map(pc => ({
            ...pc.cards,
            quantity: pc.quantity,
            tcgplayer_market: priceMap[pc.cards?.id] ?? null,
          }))
        }
      })
    )

    setPackData(packsWithCards)
    setPackLoading(false)
  }

  useEffect(() => { load() }, [])

  function handleCreated(id) {
    setShowModal(false)
    load()
    loadOpening(id)
  }

  async function deleteOpening(id) {
    const opening = openings.find(o => o.id === id)
    if (!window.confirm(`Delete "${opening?.title ?? 'this opening'}"? This cannot be undone.`)) return
    await supabase.from('youtube_openings').delete().eq('id', id)
    if (selected === id) { setSelected(null); setPackData([]); setOpeningMeta(null) }
    load()
  }

  async function saveUrl(id) {
    await supabase.from('youtube_openings').update({ youtube_url: urlDraft || null }).eq('id', id)
    setEditingUrl(null)
    load()
    if (selected === id) loadOpening(id)
  }

  async function saveShortsUrl(id) {
    await supabase.from('youtube_openings').update({ shorts_url: shortsDraft || null }).eq('id', id)
    setEditingShortsUrl(null)
    load()
  }

  // ── Filter + sort ─────────────────────────────────────────────────────────
  const visibleOpenings = openings
    .filter(o => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        o.title?.toLowerCase().includes(q) ||
        o.box_name?.toLowerCase().includes(q) ||
        o.set_name?.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':   return new Date(a.filmed_at) - new Date(b.filmed_at)
        case 'value_desc': return (Number(b.total_tcg_value) || 0) - (Number(a.total_tcg_value) || 0)
        case 'pnl_desc':   return (Number(b.opening_pnl) || 0) - (Number(a.opening_pnl) || 0)
        case 'packs_desc': return (b.packs_in_video || 0) - (a.packs_in_video || 0)
        default:           return new Date(b.filmed_at) - new Date(a.filmed_at) // date_desc
      }
    })

  return (
    <div className="page">
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">YouTube Openings</h1>
          <p className="page-subtitle">{openings.length} opening{openings.length !== 1 ? 's' : ''} tracked</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New opening</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '320px 1fr' : '1fr', gap: 16 }}>

        {/* Openings list */}
        <div>
          {/* Search + sort controls */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className="form-input"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search title or box…"
                style={{ paddingLeft: 28, fontSize: 12 }}
              />
            </div>
            <select
              className="form-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{ fontSize: 12, width: 'auto', flexShrink: 0 }}
            >
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="value_desc">Highest value</option>
              <option value="pnl_desc">Best P&amp;L</option>
              <option value="packs_desc">Most packs</option>
            </select>
          </div>

          {loading ? <div className="loading">Loading…</div> : openings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🎬</div>
              No openings yet — create your first one!
            </div>
          ) : visibleOpenings.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <div className="empty-state-icon">🔍</div>
              No openings match "{search}"
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleOpenings.map(o => {
                const pnl      = Number(o.opening_pnl ?? 0)
                const boxLabel = o.box_name ?? o.set_name
                return (
                  <div
                    key={o.id}
                    className="panel"
                    style={{
                      cursor: 'pointer',
                      borderLeft: selected === o.id ? '3px solid var(--gold)' : '3px solid transparent',
                      background: selected === o.id ? 'var(--bg-hover)' : undefined,
                    }}
                    onClick={() => loadOpening(o.id)}
                  >
                    <div style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-primary)', marginBottom: 3 }}>
                            {o.title}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {boxLabel} · {date(o.filmed_at)} · {o.packs_in_video} packs
                          </div>
                        </div>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10, padding: '3px 6px' }}
                          onClick={e => { e.stopPropagation(); deleteOpening(o.id) }}
                        >✕</button>
                      </div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Value</div>
                          <div style={{ fontSize: 14, color: 'var(--gold-light)' }}>{usd(o.total_tcg_value)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Cost</div>
                          <div style={{ fontSize: 14 }}>{usd(o.packs_cost)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>P&L</div>
                          <div style={{ fontSize: 14, color: pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {pnl >= 0 ? '+' : ''}{usd(pnl)}
                          </div>
                        </div>
                      </div>
                      {/* YouTube URL */}
                      {editingUrl === o.id ? (
                        <div style={{ marginTop: 8, display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                          <input
                            className="form-input"
                            value={urlDraft}
                            onChange={e => setUrlDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveUrl(o.id); if (e.key === 'Escape') setEditingUrl(null) }}
                            placeholder="https://youtube.com/watch?v=..."
                            autoFocus
                            style={{ fontSize: 11, padding: '4px 8px', flex: 1 }}
                          />
                          <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => saveUrl(o.id)}>Save</button>
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setEditingUrl(null)}>✕</button>
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
                          {o.youtube_url ? (
                            <a href={o.youtube_url} target="_blank" rel="noreferrer"
                              style={{ fontSize: 11, color: '#FF0000', textDecoration: 'none' }}>
                              ▶ Watch on YouTube
                            </a>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No URL yet</span>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 10, padding: '2px 6px' }}
                            onClick={() => { setEditingUrl(o.id); setUrlDraft(o.youtube_url ?? '') }}
                          >
                            {o.youtube_url ? 'Edit' : '+ Add URL'}
                          </button>
                        </div>
                      )}

                      {/* Shorts URL */}
                      {editingShortsUrl === o.id ? (
                        <div style={{ marginTop: 6, display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                          <input
                            className="form-input"
                            value={shortsDraft}
                            onChange={e => setShortsDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveShortsUrl(o.id); if (e.key === 'Escape') setEditingShortsUrl(null) }}
                            placeholder="https://youtube.com/shorts/..."
                            autoFocus
                            style={{ fontSize: 11, padding: '4px 8px', flex: 1 }}
                          />
                          <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => saveShortsUrl(o.id)}>Save</button>
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setEditingShortsUrl(null)}>✕</button>
                        </div>
                      ) : (
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
                          {shortsMap[o.id] ? (
                            <a href={shortsMap[o.id]} target="_blank" rel="noreferrer"
                              style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none' }}>
                              ▶ View Short
                            </a>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--border-mid)' }}>No Short</span>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 10, padding: '2px 6px' }}
                            onClick={() => { setEditingShortsUrl(o.id); setShortsDraft(shortsMap[o.id] ?? '') }}
                          >
                            {shortsMap[o.id] ? 'Edit' : '+ Add Short'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {!loading && openings.length > 0 && visibleOpenings.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
              {visibleOpenings.length !== openings.length
                ? `${visibleOpenings.length} of ${openings.length} shown`
                : `${openings.length} opening${openings.length !== 1 ? 's' : ''}`}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div>
            {packLoading ? (
              <div className="loading">Loading opening…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Summary card */}
                {openingMeta && <SummaryCard opening={openingMeta} packs={packData} />}

                {/* Pack-by-pack breakdown */}
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">
                      Pack by pack · {openingMeta?.box_name ?? openingMeta?.set_name}
                    </span>
                  </div>
                  {packData.map(pack => {
                    const trackedVal = pack.cards.reduce((s, c) => s + (c.tcgplayer_market ?? 0) * c.quantity, 0)
                    const packValue  = trackedVal + 1.00
                    const packCost   = openingMeta?.pack_msrp ?? 5
                    const isProfit   = packValue >= packCost
                    return (
                      <div key={pack.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '10px 16px',
                          background: isProfit ? 'rgba(76,175,110,0.05)' : 'transparent',
                        }}>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>
                            Pack #{pack.pack_number}
                          </div>
                          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                            <span style={{ color: 'var(--text-muted)' }}>Cost: {usd(packCost)}</span>
                            <span style={{ color: 'var(--gold-light)' }}>Value: {usd(packValue)}</span>
                            <span style={{ color: isProfit ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
                              {isProfit ? '+' : ''}{usd(packValue - packCost)}
                            </span>
                          </div>
                        </div>
                        <table className="data-table" style={{ margin: 0 }}>
                          <tbody>
                            {pack.cards
                              .sort((a, b) => (b.tcgplayer_market ?? 0) - (a.tcgplayer_market ?? 0))
                              .map((card, i) => (
                                <tr key={i}>
                                  <td style={{ paddingLeft: 24 }}>
                                    <a
                                      href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(card.name + ' Sorcery TCG')}&LH_Complete=1&LH_Sold=1&_sop=13`}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: 'var(--text-primary)', fontWeight: 500, textDecoration: 'none', borderBottom: '1px dashed var(--border-mid)' }}
                                      onMouseOver={e => e.target.style.color = 'var(--gold-light)'}
                                      onMouseOut={e => e.target.style.color = 'var(--text-primary)'}
                                    >
                                      {card.name}
                                    </a>
                                    <a
                                      href={card.tcgplayer_id
                                        ? `https://www.tcgplayer.com/product/${card.tcgplayer_id}`
                                        : `https://www.tcgplayer.com/search/sorcery-contested-realm/product?q=${encodeURIComponent(card.name)}&view=grid`
                                      }
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ fontSize: 10, color: 'var(--text-muted)', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', marginLeft: 6 }}
                                      onMouseOver={e => e.target.style.color = 'var(--gold-light)'}
                                      onMouseOut={e => e.target.style.color = 'var(--text-muted)'}
                                    >
                                      TCG
                                    </a>
                                  </td>
                                  <td>
                                    <span className={`badge badge-${card.rarity}`}>{card.rarity}</span>
                                  </td>
                                  <td className="text-right" style={{ color: 'var(--gold-light)' }}>
                                    {usd(card.tcgplayer_market)}
                                  </td>
                                </tr>
                              ))}
                            <tr style={{ opacity: 0.55 }}>
                              <td style={{ paddingLeft: 24, fontSize: 11, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                                Ordinary card est.
                              </td>
                              <td>
                                <span className="badge badge-ordinary" style={{ fontSize: 10 }}>ordinary</span>
                              </td>
                              <td className="text-right" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                $1.00
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <NewOpeningModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}