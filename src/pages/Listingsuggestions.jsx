import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const usd    = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPnl = (n) => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+$' : '-$'}${Math.abs(v).toFixed(2)}` }

const EBAY_FEE_PCT  = 0.129
const EBAY_FEE_FLAT = 0.30
const DEFAULT_SHIP  = 5.00
const calcNet = (price) => price - (price * EBAY_FEE_PCT + EBAY_FEE_FLAT) - DEFAULT_SHIP

// ── Grouping logic ────────────────────────────────────────────
function groupCards(cards) {
  const groups = []

  // Exclude exceptionals — only unique and elite
  const eligible = cards.filter(c => c.rarity === 'unique' || c.rarity === 'elite')

  // Separate into tiers
  const uniqueCards = eligible.filter(c => c.rarity === 'unique')
  const foils       = eligible.filter(c => c.foil && c.rarity === 'elite')
  const elites      = eligible.filter(c => !c.foil && c.rarity === 'elite')

  // Helper: pack cards into lots of max 6, only emit if total >= $20
  function packIntoLots(cardList, tierLabel, color) {
    // Sort highest value first so best cards anchor each lot
    const sorted = [...cardList].sort((a, b) => (b.tcgplayer_market || 0) - (a.tcgplayer_market || 0))
    let current = []
    let currentTotal = 0

    for (const card of sorted) {
      const price = card.tcgplayer_market || 0

      // If this single card alone hits $20, emit it solo
      if (price >= 20 && current.length === 0) {
        groups.push({ tier: tierLabel, cards: [card], total: price, color })
        continue
      }

      current.push(card)
      currentTotal += price

      // Emit when we hit 6 cards or total >= $20
      if (current.length >= 6 || currentTotal >= 20) {
        if (currentTotal >= 20) {
          groups.push({ tier: tierLabel, cards: [...current], total: currentTotal, color })
          current = []; currentTotal = 0
        } else if (current.length >= 6) {
          // Hit 6 cards but not $20 — keep as partial
          groups.push({ tier: tierLabel, cards: [...current], total: currentTotal, color, partial: true })
          current = []; currentTotal = 0
        }
      }
    }

    // Remaining cards
    if (current.length > 0) {
      if (currentTotal >= 20) {
        groups.push({ tier: tierLabel, cards: [...current], total: currentTotal, color })
      } else {
        // Try to merge into last lot of same tier
        const lastSameTier = [...groups].reverse().find(g => g.tier === tierLabel && !g.partial)
        if (lastSameTier && lastSameTier.cards.length + current.length <= 6) {
          lastSameTier.cards.push(...current)
          lastSameTier.total += currentTotal
        } else {
          // Show as partial — under $20, needs attention
          groups.push({ tier: tierLabel, cards: [...current], total: currentTotal, color, partial: true })
        }
      }
    }
  }

  // 1. Unique — each card gets its own listing (high value)
  for (const card of uniqueCards) {
    const price = card.tcgplayer_market || 0
    groups.push({
      tier:    card.foil ? 'Unique Foil' : 'Unique',
      cards:   [card],
      total:   price,
      color:   card.foil ? 'var(--gold-light)' : 'var(--gold)',
      partial: price < 20,
    })
  }

  // 2. Elite foils grouped together
  packIntoLots(foils,  'Elite Foil', '#7AADEC')

  // 3. Elite non-foils grouped together
  packIntoLots(elites, 'Elite',      '#9A9080')

  return groups
}

// ── AI title + analysis via Claude API ───────────────────────
async function getAISuggestions(groups) {
  const prompt = `You are helping a Sorcery: Contested Realm TCG seller create optimal eBay listing titles and grouping analysis.

Here are the proposed card lots:
${groups.map((g, i) => `
Lot ${i + 1} [${g.tier}] — $${g.total.toFixed(2)} total
Cards: ${g.cards.map(c => `${c.name} (${c.rarity}${c.foil ? ' Foil' : ''}) $${(c.tcgplayer_market || 0).toFixed(2)}`).join(', ')}
`).join('\n')}

For each lot, provide:
1. A compelling eBay listing title (max 80 chars) that highlights the best cards
2. A brief 1-sentence selling note about why this lot is good value
3. A "synergy score" from 1-5 based on how well the cards go together thematically

Respond ONLY with a JSON array, one object per lot, in order:
[{"title": "...", "note": "...", "synergy": 3}, ...]`

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  })

  const data = await response.json()
  const text = data.content?.[0]?.text ?? '[]'
  try {
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return groups.map(() => ({ title: '', note: '', synergy: 3 }))
  }
}

// ── Create listing ────────────────────────────────────────────
async function createListing(group, aiSuggestion) {
  const title = aiSuggestion?.title || (
    group.cards.length === 1
      ? `${group.cards[0].name}${group.cards[0].foil ? ' (Foil)' : ''} — Sorcery TCG Gothic`
      : `Sorcery TCG Gothic Lot — ${group.tier} — ${group.cards.length} Cards`
  )

  const totalCostBasis = group.cards.reduce((s, c) => s + (c.cost_basis || 0), 0)
  const cardBreakdown  = group.cards.map(c => `${c.name} ($${(c.tcgplayer_market || 0).toFixed(2)})`).join(', ')

  const { data: listing, error } = await supabase.from('ebay_listings').insert({
    card_id:       group.cards.length === 1 ? group.cards[0].id : null,
    title,
    listed_price:  parseFloat(group.total.toFixed(2)),
    shipping_cost: DEFAULT_SHIP,
    condition:     'Near Mint',
    notes:         `Cards: ${cardBreakdown}\nAI note: ${aiSuggestion?.note || ''}`,
    cost_basis:    totalCostBasis > 0 ? parseFloat(totalCostBasis.toFixed(4)) : null,
    status:        'active',
  }).select('id').single()

  if (error) throw error

  // Link all cards in junction table
  if (listing && group.cards.length > 0) {
    const perCardPrice = parseFloat((group.total / group.cards.length).toFixed(2))
    await supabase.from('ebay_listing_cards').insert(
      group.cards.map(c => ({ listing_id: listing.id, card_id: c.id, price: perCardPrice }))
    )
  }

  // Increment quantity_listed for each card
  for (const card of group.cards) {
    const { data: cardRow } = await supabase.from('cards').select('quantity_listed').eq('id', card.id).single()
    if (cardRow) {
      await supabase.from('cards').update({ quantity_listed: (cardRow.quantity_listed ?? 0) + 1 }).eq('id', card.id)
    }
  }

  return listing
}

// ── Main component ────────────────────────────────────────────
export default function ListingSuggestions() {
  const [cards, setCards]         = useState([])
  const [groups, setGroups]       = useState([])
  const [aiData, setAiData]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [creating, setCreating]   = useState({})
  const [created, setCreated]     = useState(new Set())
  const [error, setError]         = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      // Fetch cards not already listed — join with ebay_listing_cards to exclude
      const { data } = await supabase
        .from('v_inventory_dashboard')
        .select('id, name, set_name, rarity, foil, tcgplayer_market, cost_basis, quantity_owned, quantity_listed, quantity_available, active_listing_count')
        .not('rarity', 'eq', 'ordinary')
        .order('tcgplayer_market', { ascending: false })

      // Filter: elite/unique only, has available copies, has a price
      const available = (data ?? []).filter(c => {
        const owned  = Number(c.quantity_owned ?? 0)
        const listed = Number(c.quantity_listed ?? 0)
        const price  = Number(c.tcgplayer_market ?? 0)
        return (c.rarity === 'elite' || c.rarity === 'unique') && owned > listed && price > 0
      })

      // Add is_site flag based on known site cards — can expand this list
      const withSite = available.map(c => ({
        ...c,
        card_id: c.id,
        is_site: false, // TODO: add site detection from card type when available
      }))

      setCards(withSite)
      const grouped = groupCards(withSite)
      setGroups(grouped)
      setLoading(false)
    }
    load()
  }, [])

  async function runAI() {
    if (!groups.length) return
    setAnalyzing(true); setError('')
    try {
      const suggestions = await getAISuggestions(groups)
      setAiData(suggestions)
    } catch (e) {
      setError(`AI analysis failed: ${e.message}`)
    }
    setAnalyzing(false)
  }

  async function handleCreate(groupIdx) {
    setCreating(prev => ({ ...prev, [groupIdx]: true }))
    try {
      await createListing(groups[groupIdx], aiData[groupIdx])
      setCreated(prev => new Set([...prev, groupIdx]))
    } catch (e) {
      setError(`Failed to create listing: ${e.message}`)
    }
    setCreating(prev => ({ ...prev, [groupIdx]: false }))
  }

  const totalLots   = groups.length
  const totalValue  = groups.reduce((s, g) => s + g.total, 0)
  const totalNet    = groups.reduce((s, g) => s + calcNet(g.total), 0)
  const unlistedCount = cards.length

  if (loading) return <div className="page"><div className="loading">Analysing inventory…</div></div>

  return (
    <div className="page">
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Listing Suggestions</h1>
          <p className="page-subtitle">
            {unlistedCount} unlisted cards · {totalLots} suggested lots · {usd(totalValue)} total value
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={runAI}
          disabled={analyzing || !groups.length}
        >
          {analyzing ? '⟳ Analysing…' : '✦ AI analyse lots'}
        </button>
      </div>

      {error && (
        <div className="alert-item danger mb-16">
          <span className="alert-icon">✗</span>
          <div className="alert-content"><div className="alert-desc">{error}</div></div>
        </div>
      )}

      {/* Summary metrics */}
      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 24 }}>
        <div className="metric-card">
          <div className="metric-label">Unlisted cards</div>
          <div className="metric-value">{unlistedCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Suggested lots</div>
          <div className="metric-value gold">{totalLots}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total listed value</div>
          <div className="metric-value gold">{usd(totalValue)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Net if all sell</div>
          <div className="metric-value" style={{ color: totalNet >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {fmtPnl(totalNet)}
          </div>
          <div className="metric-sub">after fees & shipping</div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎉</div>
          All eligible cards are already listed on eBay!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((group, i) => {
            const ai       = aiData[i]
            const net      = calcNet(group.total)
            const isCreated = created.has(i)
            const isCreating = creating[i]

            return (
              <div
                key={i}
                className="panel"
                style={{
                  opacity: isCreated ? 0.5 : 1,
                  borderLeft: `3px solid ${group.color}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    {/* Tier badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: group.color,
                        background: `${group.color}18`,
                        border: `1px solid ${group.color}40`,
                        borderRadius: 4, padding: '2px 8px',
                      }}>
                        {group.tier}
                      </span>
                      {group.partial && (
                        <span className="badge badge-alert">Under $20</span>
                      )}
                      {ai?.synergy && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {'★'.repeat(ai.synergy)}{'☆'.repeat(5 - ai.synergy)} synergy
                        </span>
                      )}
                    </div>

                    {/* AI title or default */}
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {ai?.title || `Sorcery TCG Gothic — ${group.tier} Lot (${group.cards.length} cards)`}
                    </div>

                    {/* AI note */}
                    {ai?.note && (
                      <div style={{ fontSize: 12, color: 'var(--gold-dim)', marginBottom: 8, fontStyle: 'italic' }}>
                        ✦ {ai.note}
                      </div>
                    )}

                    {/* Cards */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {group.cards.map((card, j) => (
                        <div key={j} style={{
                          fontSize: 11, padding: '3px 8px',
                          background: 'var(--bg-raised)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          color: card.foil ? 'var(--gold-light)' : 'var(--text-secondary)',
                        }}>
                          {card.name}{card.foil ? ' ✦' : ''} · {usd(card.tcgplayer_market)}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pricing + action */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, marginLeft: 20, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 22, fontWeight: 300, color: 'var(--gold-light)' }}>{usd(group.total)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        net {usd(net)} · {group.cards.length} card{group.cards.length !== 1 ? 's' : ''}
                      </div>
                    </div>

                    {isCreated ? (
                      <span className="badge badge-ok">Listed ✓</span>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleCreate(i)}
                        disabled={isCreating}
                      >
                        {isCreating ? '⟳ Creating…' : '+ Create listing'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}