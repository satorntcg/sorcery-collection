import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { useGame } from '../context/GameContext'
import { gameConfig } from '../lib/games'

const usd     = n  => n  == null ? '—' : `$${Number(n).toFixed(2)}`
const fmtPct  = n  => n  == null ? '—' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(1)}%`
const fmtPnl  = n  => { if (n == null) return '—'; const v = Number(n); return `${v >= 0 ? '+$' : '-$'}${Math.abs(v).toFixed(2)}` }
const fmtDate = d  => d  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const roiCol  = v  => v  == null ? 'var(--text-muted)' : Number(v) >= 0 ? 'var(--success)' : 'var(--danger)'

const PACK_MSRP     = 5.00 // fallback when a box has no pack_msrp set
const DEFAULT_PACKS = 36

const packMsrpOf = box => Number(box?.pack_msrp) || PACK_MSRP

function BoxSelector({ opened, selectedIds, onToggle, onSelectAll, onSelectNone }) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function onMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const filtered = opened.filter(b =>
    (b.name ?? b.set_name ?? '').toLowerCase().includes(query.toLowerCase())
  )

  const triggerLabel = selectedIds.size === 0
    ? 'No boxes selected'
    : selectedIds.size === opened.length
    ? `All ${opened.length} boxes`
    : `${selectedIds.size} of ${opened.length} boxes`

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="btn btn-ghost btn-sm"
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
        </svg>
        {triggerLabel}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200,
          width: 300,
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search boxes…"
              className="form-input"
              style={{ width: '100%', padding: '5px 8px', fontSize: 12, boxSizing: 'border-box' }}
            />
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
            <button onClick={onSelectAll}  className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>All</button>
            <button onClick={onSelectNone} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>None</button>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
              {selectedIds.size} selected
            </span>
          </div>

          {/* Box list */}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                No boxes match "{query}"
              </div>
            ) : filtered.map(box => {
              const active = selectedIds.has(box.id)
              const label  = box.name ?? box.set_name ?? 'Box'
              return (
                <div
                  key={box.id}
                  onClick={() => onToggle(box.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', cursor: 'pointer',
                    background: active ? 'rgba(201,168,76,0.06)' : 'transparent',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = active ? 'rgba(201,168,76,0.1)' : 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = active ? 'rgba(201,168,76,0.06)' : 'transparent' }}
                >
                  <div style={{
                    width: 15, height: 15, borderRadius: 3, flexShrink: 0,
                    border: `1.5px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                    background: active ? 'var(--gold)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.1s',
                  }}>
                    {active && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <polyline points="1,3.5 3.5,6 8,1" stroke="var(--bg-void)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(box.opened_at)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BoxEV() {
  const { activeGame } = useGame()
  const config = gameConfig(activeGame.slug)
  const [loading,     setLoading]     = useState(true)
  const [boxes,       setBoxes]       = useState([])
  const [pulls,       setPulls]       = useState([])
  const [selectedIds, setSelectedIds] = useState(null) // null = not yet init'd

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: boxData } = await supabase
        .from('v_box_pnl').select('*').eq('game_id', activeGame.id).order('opened_at', { ascending: true, nullsFirst: false })
      const allBoxes = boxData ?? []
      const boxIds   = allBoxes.map(b => b.id)

      // Scoped to this game's boxes via an inner join through packs, so switching games
      // doesn't pull (and price-lookup) every other game's pull records too.
      const { data: pcData } = boxIds.length
        ? await supabase.from('pack_cards')
            .select('quantity, pack_id, cards(id, name, rarity, foil), packs!inner(pack_number, box_id)')
            .in('packs.box_id', boxIds)
        : { data: [] }

      const cardIds = [...new Set((pcData ?? []).map(pc => pc.cards?.id).filter(Boolean))]
      let priceMap = {}
      if (cardIds.length) {
        const { data: pd } = await supabase
          .from('v_latest_prices').select('card_id, tcgplayer_market').in('card_id', cardIds)
        priceMap = Object.fromEntries((pd ?? []).map(p => [p.card_id, Number(p.tcgplayer_market) || 0]))
      }

      const boxLookup = Object.fromEntries(allBoxes.map(b => [b.id, b]))
      const enriched  = (pcData ?? []).map(pc => ({
        cardId:   pc.cards?.id,
        cardName: pc.cards?.name,
        rarity:   pc.cards?.rarity,
        foil:     pc.cards?.foil,
        quantity: pc.quantity ?? 1,
        packId:   pc.pack_id,
        packNum:  pc.packs?.pack_number,
        boxId:    pc.packs?.box_id,
        boxName:  boxLookup[pc.packs?.box_id]?.name ?? boxLookup[pc.packs?.box_id]?.set_name ?? '—',
        setName:  boxLookup[pc.packs?.box_id]?.set_name,
        boxType:  boxLookup[pc.packs?.box_id]?.box_type,
        price:    priceMap[pc.cards?.id] ?? null,
      }))

      setBoxes(allBoxes)
      setPulls(enriched)
      // default: opened boxes that actually have tracked packs -- a box marked
      // opened with nothing logged yet has no EV data and would just show as a
      // -100% ROI outlier dragging down the aggregate stats if pre-selected.
      const openedIds = allBoxes.filter(b => b.opened_at && Number(b.packs_opened) > 0).map(b => b.id)
      setSelectedIds(new Set(openedIds))
      setLoading(false)
    }
    load()
  }, [activeGame.id])

  // ── All opened boxes ───────────────────────────────────────────────────────
  const opened = useMemo(() => boxes.filter(b => b.opened_at), [boxes])

  // ── Toggle helpers ─────────────────────────────────────────────────────────
  function toggleBox(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAll()  { setSelectedIds(new Set(opened.map(b => b.id))) }
  function selectNone() { setSelectedIds(new Set()) }

  // ── Filtered views (drive all derived stats) ───────────────────────────────
  const sel      = selectedIds ?? new Set(opened.map(b => b.id))
  const filtBoxes = useMemo(() => opened.filter(b => sel.has(b.id)), [opened, sel])
  const filtPulls = useMemo(() => pulls.filter(p => sel.has(p.boxId)), [pulls, sel])

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalBoxes  = filtBoxes.length
  const totalInvest = filtBoxes.reduce((s, b) => s + Number(b.purchase_price || 0), 0)
  const totalValue  = filtBoxes.reduce((s, b) => s + Number(b.cards_market_value || 0), 0)
  const totalPnl    = totalValue - totalInvest
  const totalRoi    = totalInvest > 0 ? (totalPnl / totalInvest) * 100 : null

  const uniquePackIds = useMemo(() => new Set(filtPulls.map(p => p.packId).filter(Boolean)), [filtPulls])
  const totalPacks    = uniquePackIds.size
  const evPerPack     = totalPacks > 0 ? totalValue / totalPacks : null

  // Blended break-even for the current selection: each tracked pack's own box's
  // pack_msrp (falling back to $5), averaged — so a mix of boxes with different
  // actual pack prices compares evPerPack against the right bar, not a flat $5.
  const boxById = useMemo(() => Object.fromEntries(filtBoxes.map(b => [b.id, b])), [filtBoxes])
  const blendedMsrp = useMemo(() => {
    const packBoxMap = {}
    for (const p of filtPulls) {
      if (p.packId && !(p.packId in packBoxMap)) packBoxMap[p.packId] = p.boxId
    }
    const ids = Object.keys(packBoxMap)
    if (!ids.length) return PACK_MSRP
    const total = ids.reduce((s, packId) => s + packMsrpOf(boxById[packBoxMap[packId]]), 0)
    return total / ids.length
  }, [filtPulls, boxById])

  // Best single pack within selection
  const packValMap = useMemo(() => {
    const m = {}
    for (const p of filtPulls) {
      if (!p.packId) continue
      m[p.packId] = (m[p.packId] ?? 0) + (p.price ?? 0) * p.quantity
    }
    return m
  }, [filtPulls])
  const bestPackValue = Object.values(packValMap).length > 0 ? Math.max(...Object.values(packValMap)) : null

  // "Is a [set] box worth it?" — auto-picks whichever booster set has the most
  // opened-box data within the current selection, rather than assuming Gothic.
  const boosterBoxes = filtBoxes.filter(b => b.box_type === 'booster_box')
  const setCounts = {}
  for (const b of boosterBoxes) {
    if (!b.set_name) continue
    setCounts[b.set_name] = (setCounts[b.set_name] ?? 0) + 1
  }
  const primarySet   = Object.entries(setCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const gothicBoxes  = boosterBoxes.filter(b => b.set_name === primarySet)
  const gothicCost   = gothicBoxes.reduce((s, b) => s + Number(b.purchase_price || 0), 0)
  const gothicValue  = gothicBoxes.reduce((s, b) => s + Number(b.cards_market_value || 0), 0)
  const gothicPnl    = gothicValue - gothicCost
  const gothicRoi    = gothicCost > 0 ? (gothicPnl / gothicCost * 100) : null
  const gothicBoxIds = new Set(gothicBoxes.map(b => b.id))
  const gothicPacks  = new Set(filtPulls.filter(p => gothicBoxIds.has(p.boxId)).map(p => p.packId).filter(Boolean))
  const gothicEV     = gothicPacks.size > 0 ? gothicValue / gothicPacks.size : null
  const gothicMsrp   = gothicBoxes.length > 0 ? gothicBoxes.reduce((s, b) => s + packMsrpOf(b), 0) / gothicBoxes.length : PACK_MSRP
  const gothicWorth  = gothicEV != null && gothicEV >= gothicMsrp
  const gothicAvgBox = gothicBoxes.length > 0 ? gothicCost / gothicBoxes.length : null
  const gothicAvgPacks = gothicBoxes.length > 0 ? gothicBoxes.reduce((s, b) => s + Number(b.pack_count || DEFAULT_PACKS), 0) / gothicBoxes.length : DEFAULT_PACKS

  // Pull rates by rarity (within selection)
  const { rarityStats, totalTracked } = useMemo(() => {
    const stats = {}
    let total = 0
    for (const p of filtPulls) {
      if (!p.rarity) continue
      if (!stats[p.rarity]) stats[p.rarity] = { count: 0, totalValue: 0, valuedCount: 0 }
      stats[p.rarity].count += p.quantity
      total                 += p.quantity
      if (p.price != null && p.price > 0) {
        stats[p.rarity].totalValue  += p.price * p.quantity
        stats[p.rarity].valuedCount += p.quantity
      }
    }
    return { rarityStats: stats, totalTracked: total }
  }, [filtPulls])

  // Top 10 pulls (within selection, by per-card market price)
  const topPulls = useMemo(() => (
    [...filtPulls]
      .filter(p => p.price != null && p.price > 0 && p.cardName)
      .sort((a, b) => b.price - a.price)
      .slice(0, 10)
  ), [filtPulls])

  // Packs actually tracked (recorded pulls) per box, across ALL opened boxes —
  // not just the current selection, since boxRows lists every opened box.
  const trackedPacksByBox = useMemo(() => {
    const m = {}
    for (const p of pulls) {
      if (!p.boxId || !p.packId) continue
      if (!m[p.boxId]) m[p.boxId] = new Set()
      m[p.boxId].add(p.packId)
    }
    return m
  }, [pulls])

  // Box-by-box ROI table (all opened, so user can see and click)
  const boxRows = useMemo(() => (
    [...opened]
      .sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at))
      .map(box => {
        const cost  = Number(box.purchase_price || 0)
        const val   = Number(box.cards_market_value || 0)
        const pnl   = val - cost
        const roi   = cost > 0 ? (pnl / cost * 100) : null
        // EV/pack uses packs actually tracked, matching the hero "EV per Pack" metric --
        // dividing by the box's full advertised pack_count would understate EV for any
        // box that hasn't had every pack logged yet.
        const packs = trackedPacksByBox[box.id]?.size ?? 0
        const ev    = packs > 0 ? val / packs : null
        return { ...box, _pnl: pnl, _roi: roi, _ev: ev, _msrp: packMsrpOf(box) }
      })
  ), [opened, trackedPacksByBox])

  // ROI over time (cumulative, filtered selection, sorted by opened_at)
  const roiChart = useMemo(() => {
    let cumCost = 0, cumVal = 0
    return [...filtBoxes]
      .sort((a, b) => new Date(a.opened_at) - new Date(b.opened_at))
      .map(box => {
        cumCost += Number(box.purchase_price || 0)
        cumVal  += Number(box.cards_market_value || 0)
        const pnl = cumVal - cumCost
        const roi = cumCost > 0 ? (pnl / cumCost) * 100 : 0
        return {
          date:    fmtDate(box.opened_at),
          'P&L':   Math.round(pnl * 100) / 100,
          'ROI %': Math.round(roi * 10) / 10,
        }
      })
  }, [filtBoxes])

  if (loading) return <div className="loading">Loading Box EV…</div>

  const noneSelected = sel.size === 0

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 className="page-title">Box EV</h1>
          <p className="page-subtitle">
            Expected value analysis
            {sel.size < opened.length
              ? ` · ${sel.size} of ${opened.length} boxes selected`
              : ` · ${opened.length} opened ${opened.length === 1 ? 'box' : 'boxes'}`}
            {totalPacks > 0 && ` · ${totalPacks} packs tracked`}
          </p>
        </div>
        {opened.length > 0 && (
          <BoxSelector
            opened={opened}
            selectedIds={sel}
            onToggle={toggleBox}
            onSelectAll={selectAll}
            onSelectNone={selectNone}
          />
        )}
      </div>

      {noneSelected ? (
        <div className="empty-state" style={{ padding: 48 }}>
          <div className="empty-state-icon">📦</div>
          Select at least one box to see EV analysis.
        </div>
      ) : (
        <>
          {/* ── 1. Hero metrics ───────────────────────────────────────────── */}
          <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">Boxes Selected</div>
              <div className="metric-value">{totalBoxes}</div>
              <div className="metric-sub">{totalPacks} packs tracked</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">EV per Pack</div>
              <div className="metric-value gold">{usd(evPerPack)}</div>
              <div className="metric-sub" style={{ color: evPerPack != null && evPerPack >= blendedMsrp ? 'var(--success)' : 'var(--danger)' }}>
                {evPerPack != null ? (evPerPack >= blendedMsrp ? `↑ beats $${blendedMsrp.toFixed(2)} MSRP` : `↓ below $${blendedMsrp.toFixed(2)} MSRP`) : `vs $${blendedMsrp.toFixed(2)} MSRP`}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Overall ROI</div>
              <div className="metric-value" style={{ color: roiCol(totalRoi) }}>{fmtPct(totalRoi)}</div>
              <div className="metric-sub">{fmtPnl(totalPnl)} total P&amp;L</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Best Pack</div>
              <div className="metric-value gold">{usd(bestPackValue)}</div>
              <div className="metric-sub">single pack record</div>
            </div>
          </div>

          {/* ── 2. "Is a Gothic box worth it?" ────────────────────────────── */}
          {gothicBoxes.length > 0 && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="panel-title">Is a {primarySet} Box Worth It?</span>
                <span className={`badge ${gothicWorth ? 'badge-ok' : 'badge-danger'}`} style={{ fontSize: 11 }}>
                  {gothicWorth ? '✓ EV beats MSRP' : '✗ EV below MSRP'}
                </span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                  {[
                    { label: `${primarySet} boxes`, value: String(gothicBoxes.length) },
                    { label: 'Avg purchase price',  value: usd(gothicAvgBox) },
                    { label: 'EV per pack',         value: usd(gothicEV),  accent: true },
                    { label: `${primarySet} ROI`,   value: fmtPct(gothicRoi), color: roiCol(gothicRoi) },
                  ].map(({ label, value, accent, color }) => (
                    <div key={label} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 12 }}>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 20, fontWeight: 300, color: color ?? (accent ? 'var(--gold-light)' : 'var(--text-primary)') }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    Break-even: {usd(gothicMsrp)}/pack · {usd(gothicAvgBox != null ? gothicAvgBox / gothicAvgPacks : null)}/pack at avg box cost
                  </div>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div style={{
                  background: gothicWorth ? 'rgba(76,175,110,0.07)' : 'rgba(201,76,76,0.07)',
                  border: `1px solid ${gothicWorth ? 'rgba(76,175,110,0.25)' : 'rgba(201,76,76,0.25)'}`,
                  borderRadius: 8, padding: '12px 16px',
                  fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65,
                }}>
                  {gothicWorth
                    ? `Based on ${gothicPacks.size} tracked packs across ${gothicBoxes.length} ${primarySet} booster ${gothicBoxes.length === 1 ? 'box' : 'boxes'}, your average pack EV of ${usd(gothicEV)} beats the $${gothicMsrp.toFixed(2)} MSRP. ${primarySet} boxes have been profitable on average — total P&L: ${fmtPnl(gothicPnl)}.`
                    : `Based on ${gothicPacks.size} tracked packs across ${gothicBoxes.length} ${primarySet} booster ${gothicBoxes.length === 1 ? 'box' : 'boxes'}, your average pack EV of ${usd(gothicEV)} is below the $${gothicMsrp.toFixed(2)} MSRP. If you bought at or below MSRP you may still be in profit — check individual box ROI below.`
                  }
                </div>
              </div>
            </div>
          )}

          {/* ── 3. Pull rate breakdown ─────────────────────────────────────── */}
          {totalTracked > 0 && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="panel-title">Pull Rate Breakdown</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalTracked.toLocaleString()} tracked pulls</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rarity</th>
                    <th className="text-right">Pulls</th>
                    <th>Pull rate</th>
                    <th className="text-right">Avg value</th>
                    <th className="text-right">Total value</th>
                    <th className="text-right">% of total value</th>
                  </tr>
                </thead>
                <tbody>
                  {[...config.rarities].reverse().filter(r => rarityStats[r]).map(r => {
                    const s        = rarityStats[r]
                    const rate     = totalTracked > 0 ? s.count / totalTracked * 100 : 0
                    const avgVal   = s.valuedCount > 0 ? s.totalValue / s.valuedCount : null
                    const allTotal = config.rarities.reduce((sum, x) => sum + (rarityStats[x]?.totalValue ?? 0), 0)
                    const valShare = allTotal > 0 ? s.totalValue / allTotal * 100 : 0
                    return (
                      <tr key={r}>
                        <td><span className={`badge badge-${r}`}>{r}</span></td>
                        <td className="text-right" style={{ fontSize: 13 }}>{s.count.toLocaleString()}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 80, height: 5, background: 'var(--bg-raised)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                              <div style={{ width: `${Math.min(rate, 100)}%`, height: '100%', background: 'var(--gold-dim)', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 38 }}>{rate.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="text-right">{usd(avgVal)}</td>
                        <td className="text-right text-gold">{s.totalValue > 0 ? usd(s.totalValue) : '—'}</td>
                        <td className="text-right">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                            <div style={{ width: 60, height: 5, background: 'var(--bg-raised)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(valShare, 100)}%`, height: '100%', background: 'var(--gold)', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 12, minWidth: 38, textAlign: 'right' }}>{valShare.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── 4 + 5. Box ROI table + Top pulls leaderboard ──────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

            {/* ── 4. Box-by-box ROI — clicking a row toggles selection ── */}
            <div className="panel">
              <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="panel-title">Box-by-Box ROI</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
                  background: 'rgba(201,168,76,0.1)', color: 'var(--gold-dim)',
                  border: '1px solid rgba(201,168,76,0.2)',
                }}>
                  Your boxes
                </span>
              </div>
              {boxRows.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <div className="empty-state-icon">📦</div>
                  No opened boxes yet.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 20 }} />
                      <th>Box</th>
                      <th className="text-right">Cost</th>
                      <th className="text-right">Value</th>
                      <th className="text-right">EV/pack</th>
                      <th className="text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boxRows.map(box => {
                      const active = sel.has(box.id)
                      return (
                        <tr
                          key={box.id}
                          onClick={() => toggleBox(box.id)}
                          style={{
                            cursor: 'pointer',
                            opacity: active ? 1 : 0.4,
                            background: active ? undefined : 'transparent',
                          }}
                        >
                          <td style={{ paddingRight: 4 }}>
                            <div style={{
                              width: 14, height: 14, borderRadius: 3,
                              border: `1.5px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                              background: active ? 'var(--gold)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {active && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><polyline points="1,3.5 3.5,6 8,1" stroke="var(--bg-void)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 500, fontSize: 12, color: 'var(--text-primary)' }}>
                              {box.name ?? box.set_name}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(box.opened_at)}</div>
                          </td>
                          <td className="text-right" style={{ fontSize: 12 }}>{usd(box.purchase_price)}</td>
                          <td className="text-right text-gold" style={{ fontSize: 12 }}>{usd(box.cards_market_value)}</td>
                          <td className="text-right" style={{ fontSize: 12 }}>
                            <span style={{ color: box._ev != null && box._ev >= box._msrp ? 'var(--success)' : 'var(--danger)' }}>
                              {usd(box._ev)}
                            </span>
                          </td>
                          <td className="text-right" style={{ fontSize: 12 }}>
                            <span style={{ color: roiCol(box._roi) }}>{fmtPct(box._roi)}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td />
                      <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                        {sel.size} of {opened.length} selected
                      </td>
                      <td style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12, textAlign: 'right', color: 'var(--text-muted)' }}>
                        {usd(totalInvest)}
                      </td>
                      <td className="text-right text-gold" style={{ padding: '8px 14px', fontWeight: 500, borderTop: '1px solid var(--border)', fontSize: 12 }}>{usd(totalValue)}</td>
                      <td className="text-right" style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                        <span style={{ color: evPerPack != null && evPerPack >= blendedMsrp ? 'var(--success)' : 'var(--danger)' }}>
                          {usd(evPerPack)}
                        </span>
                      </td>
                      <td className="text-right" style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                        <span style={{ color: roiCol(totalRoi) }}>{fmtPct(totalRoi)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* ── 5. Top 10 pulls leaderboard ── */}
            <div className="panel">
              <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="panel-title">Top 10 All-Time Pulls</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>by TCGPlayer market price</span>
              </div>
              {topPulls.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <div className="empty-state-icon">🃏</div>
                  No priced pulls yet.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 28, textAlign: 'center' }}>#</th>
                      <th>Card</th>
                      <th>From</th>
                      <th className="text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPulls.map((p, i) => (
                      <tr key={i} style={{ background: i === 0 ? 'rgba(201,168,76,0.04)' : undefined }}>
                        <td style={{ textAlign: 'center', fontSize: i === 0 ? 16 : 11, color: 'var(--gold)', fontWeight: 700 }}>
                          {i === 0 ? '⭐' : i + 1}
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 12, color: 'var(--text-primary)' }}>
                            {p.cardName}{p.foil ? ' ✦' : ''}
                          </div>
                          <span className={`badge badge-${p.rarity}`} style={{ fontSize: 10 }}>{p.rarity}</span>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.boxName}
                        </td>
                        <td className="text-right text-gold" style={{ fontWeight: 500 }}>{usd(p.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── 6. ROI over time chart ─────────────────────────────────────── */}
          {roiChart.length >= 2 && (
            <div className="panel">
              <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="panel-title">Cumulative P&amp;L Over Time</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{filtBoxes.length} {filtBoxes.length === 1 ? 'box' : 'boxes'} selected</span>
              </div>
              <div style={{ padding: '20px', height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={roiChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <XAxis dataKey="date" tick={{ fill: '#5A5448', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="pnl" tick={{ fill: '#5A5448', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} width={55} />
                    <YAxis yAxisId="roi" orientation="right" tick={{ fill: '#5A5448', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={45} />
                    <ReferenceLine yAxisId="pnl" y={0} stroke="var(--border)" strokeDasharray="4 2" />
                    <ReferenceLine yAxisId="roi" y={0} stroke="transparent" />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-muted)' }}
                      formatter={(value, name) => [name === 'P&L' ? usd(value) : fmtPct(value), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }} />
                    <Line yAxisId="pnl" type="monotone" dataKey="P&L" stroke="var(--gold)" strokeWidth={2} dot={{ r: 3, fill: 'var(--gold)', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                    <Line yAxisId="roi" type="monotone" dataKey="ROI %" stroke="var(--success)" strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ padding: '0 20px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
                Gold line = cumulative P&amp;L · Green dashed = cumulative ROI % · Each point = one box opened
              </div>
            </div>
          )}
        </>
      )}

      {opened.length === 0 && (
        <div className="empty-state" style={{ padding: 64 }}>
          <div className="empty-state-icon">📦</div>
          No opened boxes yet — mark boxes as opened in the Boxes &amp; P&amp;L page to see EV analysis.
        </div>
      )}
    </div>
  )
}
