import { useState } from 'react'
import { supabase } from '../lib/supabase'

function getSheetUrls(url, boxesGid, packsGid) {
  const pubIdMatch = url.match(/\/d\/e\/([^/]+)/)
  if (!pubIdMatch) return null
  const pubId = pubIdMatch[1]
  return {
    cards: `https://docs.google.com/spreadsheets/d/e/${pubId}/pub?gid=0&single=true&output=csv`,
    boxes: `https://docs.google.com/spreadsheets/d/e/${pubId}/pub?gid=${boxesGid}&single=true&output=csv`,
    packs: `https://docs.google.com/spreadsheets/d/e/${pubId}/pub?gid=${packsGid}&single=true&output=csv`,
  }
}

function parseCsv(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase().replace(/ /g, '_'))
  return lines.slice(1).map(line => {
    const values = []
    let current = '', inQuotes = false
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue }
      if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue }
      current += char
    }
    values.push(current.trim())
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  }).filter(row => Object.values(row).some(v => v !== ''))
}

const RARITY_MAP = {
  'ordinary':'ordinary','o':'ordinary','exceptional':'exceptional','e':'exceptional',
  'elite':'elite','el':'elite','unique':'unique','u':'unique',
}
const BOX_TYPE_MAP = {
  'booster_box':'booster_box','booster box':'booster_box',
  'prerelease_kit':'prerelease_kit','prerelease kit':'prerelease_kit',
  'bundle':'bundle','other':'other',
}

// Simplified — condition always near_mint, quantity always 1 for pack pulls
function normalizeCard(row) {
  return {
    name:         row.name?.trim(),
    set_name:     (row.set_name ?? row.set ?? 'Gothic').trim(),
    set_code:     row.set_code?.trim() || null,
    rarity:       RARITY_MAP[row.rarity?.toLowerCase().trim()] ?? 'elite',
    condition:    'near_mint',
    foil:         ['true','yes','1','foil'].includes(row.foil?.toLowerCase().trim()),
    tcgplayer_id: row.tcgplayer_id?.trim() || null,
    image_url:    null,
    notes:        row.notes?.trim() || null,
    _pack_ref:    row.pack_ref?.trim() || null,
    _quantity:    1,
  }
}

function normalizeBox(row) {
  return {
    name:           row.name?.trim() || null,
    set_name:       (row.set_name ?? row.set ?? 'Gothic').trim(),
    box_type:       BOX_TYPE_MAP[row.box_type?.toLowerCase().trim()] ?? 'booster_box',
    purchase_price: parseFloat(row.purchase_price ?? '0') || 0,
    pack_count:     parseInt(row.pack_count ?? '36') || 36,
    pack_msrp:      parseFloat(row.pack_msrp ?? '5') || 5,
    purchased_at:   row.purchased_at ? new Date(row.purchased_at).toISOString() : new Date().toISOString(),
    seller:         row.seller?.trim() || null,
    notes:          row.notes?.trim() || null,
    _ref:           row.ref?.trim() || null,
  }
}

function normalizePack(row) {
  return {
    pack_number: parseInt(row.pack_number ?? '1') || 1,
    opened_at:   row.opened_at ? new Date(row.opened_at).toISOString() : new Date().toISOString(),
    notes:       row.notes?.trim() || null,
    _box_ref:    row.box_ref?.trim() || null,
    _ref:        row.ref?.trim() || null,
  }
}

async function runImport(cardRows, boxRows, packRows, onLog) {
  let cardCount = 0, boxCount = 0, packCount = 0, skipped = 0, errorCount = 0
  const boxRefMap = {}
  const packRefMap = {}

  // ── Boxes ──
  for (const raw of boxRows) {
    const box = normalizeBox(raw)
    const ref = box._ref; delete box._ref
    if (!box.purchase_price) { onLog('warn', `Skipping box with no price: ${raw.set_name}`); continue }

    const { data: existing } = await supabase
      .from('boxes').select('id')
      .eq('set_name', box.set_name)
      .eq('purchase_price', box.purchase_price)
      .eq('pack_count', box.pack_count)
      .maybeSingle()

    if (existing) {
      if (ref) boxRefMap[ref] = existing.id
      onLog('info', `Skipped (exists): ${box.set_name} box`)
      skipped++; continue
    }

    const { data, error } = await supabase.from('boxes').insert(box).select('id').single()
    if (error) { onLog('error', `Box (${box.set_name}): ${error.message}`); errorCount++; continue }
    if (ref) boxRefMap[ref] = data.id
    onLog('success', `Box: ${box.set_name} — ${box.pack_count} packs @ $${box.pack_msrp}`)
    boxCount++
  }

  // ── Packs ──
  for (const raw of packRows) {
    const pack = normalizePack(raw)
    const ref = pack._ref; const boxRef = pack._box_ref
    delete pack._ref; delete pack._box_ref

    const boxId = boxRefMap[boxRef]
    if (!boxId) { onLog('warn', `Pack ${pack.pack_number}: no matching box_ref "${boxRef}"`); continue }

    const { data: existing } = await supabase
      .from('packs').select('id')
      .eq('box_id', boxId)
      .eq('pack_number', pack.pack_number)
      .maybeSingle()

    if (existing) {
      if (ref) packRefMap[ref] = existing.id
      onLog('info', `Skipped (exists): Pack #${pack.pack_number}`)
      skipped++; continue
    }

    const { data, error } = await supabase.from('packs')
      .insert({ ...pack, box_id: boxId }).select('id').single()
    if (error) { onLog('error', `Pack ${pack.pack_number}: ${error.message}`); errorCount++; continue }
    if (ref) packRefMap[ref] = data.id
    onLog('success', `Pack #${pack.pack_number} → box ${boxRef}`)
    packCount++
  }

  // ── Cards ──
  for (const raw of cardRows) {
    const card = normalizeCard(raw)
    const packRef = card._pack_ref
    const quantity = card._quantity ?? 1
    delete card._pack_ref; delete card._quantity

    if (!card.name) { onLog('warn', 'Skipping row with no name'); continue }

    const { data: existing } = await supabase
      .from('cards').select('id, quantity_owned')
      .ilike('name', card.name)
      .eq('set_name', card.set_name)
      .eq('condition', card.condition)
      .eq('foil', card.foil)
      .maybeSingle()

    let cardId
    if (existing) {
      cardId = existing.id
      const nextQuantity = Number(existing.quantity_owned ?? 0) + quantity
      const { error } = await supabase
        .from('cards')
        .update({ quantity_owned: nextQuantity })
        .eq('id', cardId)
      if (error) { onLog('error', `Card quantity (${card.name}): ${error.message}`); errorCount++; continue }
      onLog('info', `Updated quantity: ${card.name} (${nextQuantity} owned)`)
      skipped++
    } else {
      const { data, error } = await supabase.from('cards').insert({ ...card, quantity_owned: quantity }).select('id').single()
      if (error) { onLog('error', `Card (${card.name}): ${error.message}`); errorCount++; continue }
      cardId = data.id
      onLog('success', `Added: ${card.name} (${card.rarity})`)
      cardCount++
    }

    if (packRef && packRefMap[packRef]) {
      const packId = packRefMap[packRef]
      const { data: existingLink } = await supabase
        .from('pack_cards')
        .select('quantity')
        .eq('pack_id', packId)
        .eq('card_id', cardId)
        .maybeSingle()
      const { error } = existingLink
        ? await supabase
            .from('pack_cards')
            .update({ quantity: Number(existingLink.quantity ?? 0) + quantity })
            .eq('pack_id', packId)
            .eq('card_id', cardId)
        : await supabase
            .from('pack_cards')
            .insert({ pack_id: packId, card_id: cardId, quantity })
      if (error) onLog('warn', `Link failed ${card.name} → ${packRef}: ${error.message}`)
    } else if (packRef) {
      onLog('warn', `No matching pack for ref "${packRef}" (card: ${card.name})`)
    }
  }

  return { cardCount, boxCount, packCount, skipped, errorCount }
}

export default function Import() {
  const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/e/2PACX-1vTgjSY3ZKa5WFKauWOjlVQfuKCqhQD3p2c485h1jMV_iP8oatHLc_lQn3_4dGDO66VagE2hcTbGZWQ5/pub?output=csv')
  const [boxesGid, setBoxesGid] = useState('1200631871')
  const [packsGid, setPacksGid] = useState('894617018')
  const [status, setStatus]     = useState('idle')
  const [logs, setLogs]         = useState([])
  const [preview, setPreview]   = useState(null)
  const [summary, setSummary]   = useState(null)

  const addLog = (type, message) =>
    setLogs(prev => [...prev, { type, message, id: Date.now() + Math.random() }])

  async function fetchPreview() {
    if (!sheetUrl.trim() || !packsGid.trim()) return
    setStatus('fetching'); setLogs([]); setPreview(null); setSummary(null)
    const urls = getSheetUrls(sheetUrl, boxesGid, packsGid)
    if (!urls) { addLog('error', 'Could not parse URL'); setStatus('error'); return }
    try {
      addLog('info', 'Fetching Cards…')
      const cardsRes = await fetch(urls.cards)
      if (!cardsRes.ok) throw new Error(`Cards sheet not accessible (${cardsRes.status})`)
      const cardRows = parseCsv(await cardsRes.text())

      addLog('info', 'Fetching Boxes…')
      const boxRes  = await fetch(urls.boxes)
      const boxRows = boxRes.ok ? parseCsv(await boxRes.text()) : []
      if (!boxRes.ok) addLog('warn', 'Boxes sheet not found')

      addLog('info', 'Fetching Packs…')
      const packRes  = await fetch(urls.packs)
      const packRows = packRes.ok ? parseCsv(await packRes.text()) : []
      if (!packRes.ok) addLog('warn', 'Packs sheet not found')

      addLog('success', `Found ${cardRows.length} cards · ${boxRows.length} boxes · ${packRows.length} packs`)
      setPreview({ cards: cardRows, boxes: boxRows, packs: packRows })
      setStatus('idle')
    } catch (err) {
      addLog('error', String(err))
      setStatus('error')
    }
  }

  async function doImport() {
    if (!preview) return
    setStatus('importing'); setLogs([])
    const result = await runImport(preview.cards, preview.boxes, preview.packs, addLog)
    setSummary(result); setStatus('done')
  }

  const logColors = {
    success: 'var(--success)', error: 'var(--danger)',
    warn: 'var(--warning)', info: 'var(--text-muted)',
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-header">
        <h1 className="page-title">Bulk Import</h1>
        <p className="page-subtitle">Import boxes → packs → cards · safe to re-run, skips existing records</p>
      </div>

      {/* Sheet structure */}
      <div className="panel mb-16">
        <div className="panel-header"><span className="panel-title">Google Sheet structure — 3 tabs</span></div>
        <div className="panel-body" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>

          {[
            {
              tab: 'Cards',
              cols: 'name | set_name | set_code | rarity | foil | pack_ref | tcgplayer_id | notes',
              note: 'Condition defaults to near_mint. Quantity is always 1 per pack pull. pack_ref links to the Packs tab.',
            },
            {
              tab: 'Boxes',
              cols: 'ref | name | set_name | box_type | purchase_price | pack_count | pack_msrp | purchased_at | seller | notes',
              note: 'ref is a short unique ID e.g. "gothic_box1". pack_count=36, pack_msrp=5',
            },
            {
              tab: 'Packs',
              cols: 'ref | box_ref | pack_number | opened_at | notes',
              note: 'box_ref matches the ref in Boxes. ref is e.g. "gothic_box1_p01"',
            },
          ].map(({ tab, cols, note }) => (
            <div key={tab} style={{ marginBottom: 14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <span style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 8px', fontSize:11, fontWeight:500, color:'var(--gold-light)' }}>{tab}</span>
              </div>
              <div style={{ fontFamily:'monospace', fontSize:11, background:'var(--bg-void)', padding:'8px 12px', borderRadius:6, marginBottom:4, overflowX:'auto', whiteSpace:'nowrap' }}>{cols}</div>
              <div style={{ fontSize:12, color:'var(--text-muted)' }}>↳ {note}</div>
            </div>
          ))}

          {/* Rarity guide */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:8 }}>
            <div>
              <div style={{ fontSize:11, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Rarity values</div>
              {[['unique','u'],['elite','el'],['exceptional','e'],['ordinary','o']].map(([v,s]) => (
                <div key={v} style={{ fontSize:12, marginBottom:3 }}>
                  <span style={{ color:'var(--text-primary)' }}>{v}</span>
                  <span style={{ color:'var(--text-muted)' }}> or </span>
                  <span style={{ color:'var(--text-primary)' }}>{s}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Box type values</div>
              {[['booster_box'],['prerelease_kit'],['bundle'],['other']].map(([v]) => (
                <div key={v} style={{ fontSize:12, marginBottom:3, color:'var(--text-primary)' }}>{v}</div>
              ))}
            </div>
          </div>

          <div style={{ background:'var(--info-bg)', border:'1px solid rgba(76,132,201,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12, marginTop:12 }}>
            <strong style={{ color:'var(--info)' }}>Safe to re-run:</strong> The import skips boxes, packs, and cards that already exist. Only new records are inserted.
          </div>
          <div style={{ background:'var(--warning-bg)', border:'1px solid rgba(201,137,76,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12, marginTop:8 }}>
            <strong style={{ color:'var(--warning)' }}>Publish each tab:</strong> File → Share → Publish to web → select tab → CSV → Publish. Get gid from URL when clicking each tab (#gid=XXXXXXXX).
          </div>
        </div>
      </div>

      {/* Example */}
      <div className="panel mb-16">
        <div className="panel-header"><span className="panel-title">Example — 1 box · 2 packs · 4 cards</span></div>
        <div className="panel-body" style={{ fontSize:12, display:'flex', flexDirection:'column', gap:14 }}>
          {[
            {
              label: 'Boxes',
              rows: [
                ['ref','name', 'set_name','box_type','purchase_price','pack_count','pack_msrp'],
                ['gothic_box1','Gothic Box 1','Gothic','booster_box','180','36','5'],
              ]
            },
            {
              label: 'Packs',
              rows: [
                ['ref','box_ref','pack_number','opened_at'],
                ['gothic_box1_p01','gothic_box1','1','2026-05-20'],
                ['gothic_box1_p02','gothic_box1','2','2026-05-20'],
              ]
            },
            {
              label: 'Cards (simplified)',
              rows: [
                ['name','set_name','rarity','foil','pack_ref','tcgplayer_id'],
                ['Fertile Earth','Gothic','exceptional','','gothic_box1_p01','656589'],
                ['Accusation','Gothic','exceptional','','gothic_box1_p01','656590'],
                ['Kissers of Wounds','Gothic','exceptional','','gothic_box1_p02','656591'],
                ['The Doom of Dilmun','Gothic','unique','','gothic_box1_p02','656592'],
              ]
            },
          ].map(({ label, rows }) => (
            <div key={label}>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</div>
              <table style={{ borderCollapse:'collapse', fontSize:11, fontFamily:'monospace' }}>
                {rows.map((row, i) => (
                  <tr key={i} style={{ background: i===0 ? 'var(--bg-raised)' : 'transparent' }}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ padding:'3px 10px', border:'1px solid var(--border)', color: i===0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </table>
            </div>
          ))}
        </div>
      </div>

      {/* Inputs */}
      <div className="panel mb-16">
        <div className="panel-header"><span className="panel-title">Your sheet details</span></div>
        <div className="panel-body">
          <div className="form-group">
            <label className="form-label">Published sheet URL</label>
            <input className="form-input" placeholder="https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?..." value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Boxes tab gid</label>
              <input className="form-input" placeholder="e.g. 1200631871" value={boxesGid} onChange={e => setBoxesGid(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Packs tab gid</label>
              <input className="form-input" placeholder="Click Packs tab, get gid from URL" value={packsGid} onChange={e => setPacksGid(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary" onClick={fetchPreview}
            disabled={!sheetUrl.trim() || !packsGid.trim() || status === 'fetching'}>
            {status === 'fetching' ? 'Fetching…' : 'Preview import'}
          </button>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="panel mb-16">
          <div className="panel-header">
            <span className="panel-title">Preview</span>
            <div style={{ fontSize:12, color:'var(--text-muted)', display:'flex', gap:16 }}>
              <span>{preview.boxes.length} boxes</span>
              <span>{preview.packs.length} packs</span>
              <span>{preview.cards.length} cards</span>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Set</th>
                <th>Rarity</th>
                <th>Foil</th>
                <th>Pack ref</th>
                <th>TCGPlayer ID</th>
              </tr>
            </thead>
            <tbody>
              {preview.cards.slice(0, 20).map((row, i) => {
                const c = normalizeCard(row)
                return (
                  <tr key={i}>
                    <td className="name-cell">{c.name || <span className="text-danger">missing!</span>}</td>
                    <td>{c.set_name}</td>
                    <td><span className={`badge badge-${c.rarity}`}>{c.rarity}</span></td>
                    <td>{c.foil ? '✓' : ''}</td>
                    <td style={{ fontSize:11, color:'var(--text-muted)' }}>{c._pack_ref || '—'}</td>
                    <td style={{ fontSize:11, color:'var(--text-muted)' }}>{row.tcgplayer_id || '—'}</td>
                  </tr>
                )
              })}
              {preview.cards.length > 20 && (
                <tr>
                  <td colSpan={6} style={{ textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>
                    …and {preview.cards.length - 20} more
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ padding:'14px 20px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end' }}>
            <button className="btn btn-primary" onClick={doImport} disabled={status === 'importing'}>
              {status === 'importing'
                ? '⟳ Importing…'
                : `Import ${preview.boxes.length} boxes · ${preview.packs.length} packs · ${preview.cards.length} cards`}
            </button>
          </div>
        </div>
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div className="panel mb-16">
          <div className="panel-header"><span className="panel-title">Import log</span></div>
          <div style={{ padding:'12px 16px', maxHeight:300, overflowY:'auto', fontFamily:'monospace', fontSize:12 }}>
            {logs.map(log => (
              <div key={log.id} style={{ color:logColors[log.type], marginBottom:4 }}>
                [{log.type.toUpperCase()}] {log.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className={`alert-item ${summary.errorCount === 0 ? 'success' : 'warning'}`}>
          <span className="alert-icon">{summary.errorCount === 0 ? '✓' : '⚠️'}</span>
          <div className="alert-content">
            <div className="alert-title">Import complete</div>
            <div className="alert-desc">
              {summary.boxCount} new boxes · {summary.packCount} new packs · {summary.cardCount} new cards · {summary.skipped} skipped · {summary.errorCount} errors
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
