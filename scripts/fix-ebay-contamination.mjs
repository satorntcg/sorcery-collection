/**
 * Fix contaminated eBay sold data in price_snapshots.
 *
 * Bad data patterns:
 *   - Non-foil card with eBay avg > 2× its TCG market  → foil sale slipped through
 *   - Foil card with eBay avg < 15% of its TCG market  → non-foil sale slipped through
 *
 * Usage:
 *   node scripts/fix-ebay-contamination.mjs          # dry run (no changes)
 *   node scripts/fix-ebay-contamination.mjs --fix    # apply nulls
 *
 * Requires env vars (VITE_SUPABASE_URL + VITE_SUPABASE_SERVICE_ROLE_KEY or ANON_KEY)
 */

import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient }  from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath   = path.resolve(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} else {
  console.warn(`Warning: .env not found at ${envPath}`)
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const DRY_RUN  = !process.argv.includes('--fix')

if (DRY_RUN) {
  console.log('DRY RUN — pass --fix to apply changes\n')
} else {
  console.log('LIVE RUN — changes will be written\n')
}

// ── 1. Load all cards (id, name, foil) ──────────────────────────────────────
console.log('Loading cards…')
const { data: cards, error: cardErr } = await supabase
  .from('cards')
  .select('id, name, foil')
  .limit(10000)

if (cardErr) { console.error(cardErr); process.exit(1) }
const cardMap = new Map(cards.map(c => [c.id, c]))
console.log(`  ${cards.length} cards loaded`)

// ── 2. Load all snapshots with eBay data ────────────────────────────────────
console.log('Loading snapshots with eBay data…')
let allSnaps = []
let page = 0
while (true) {
  const { data, error } = await supabase
    .from('price_snapshots')
    .select('id, card_id, checked_at, tcgplayer_market, ebay_sold_avg, ebay_sold_low, ebay_sold_high')
    .not('ebay_sold_avg', 'is', null)
    .gt('ebay_sold_avg', 0)
    .not('tcgplayer_market', 'is', null)
    .gt('tcgplayer_market', 0)
    .range(page * 1000, (page + 1) * 1000 - 1)
  if (error) { console.error(error); process.exit(1) }
  allSnaps = [...allSnaps, ...(data ?? [])]
  if (!data || data.length < 1000) break
  page++
}
console.log(`  ${allSnaps.length} snapshots with eBay + TCG data\n`)

// ── 3. Identify bad rows ─────────────────────────────────────────────────────
const bad = []
for (const snap of allSnaps) {
  const card   = cardMap.get(snap.card_id)
  if (!card) continue

  const tcg  = Number(snap.tcgplayer_market)
  const ebay = Number(snap.ebay_sold_avg)
  const foil = card.foil ?? false

  const nonFoilContaminated = !foil && ebay > tcg * 2.0
  const foilContaminated    = foil  && ebay < tcg * 0.15

  if (nonFoilContaminated || foilContaminated) {
    bad.push({
      id:     snap.id,
      card:   `${card.name}${foil ? ' (Foil)' : ''}`,
      date:   snap.checked_at?.slice(0, 10),
      tcg,
      ebay,
      reason: nonFoilContaminated ? `non-foil eBay ${ebay} > 2× TCG ${tcg}` : `foil eBay ${ebay} < 15% of TCG ${tcg}`,
    })
  }
}

if (bad.length === 0) {
  console.log('No contaminated snapshots found. All clean!')
  process.exit(0)
}

console.log(`Found ${bad.length} contaminated snapshots:\n`)
for (const row of bad) {
  console.log(`  [${row.date}] ${row.card.padEnd(40)} TCG $${row.tcg.toFixed(2)}  eBay $${row.ebay.toFixed(2)}  — ${row.reason}`)
}
console.log()

if (DRY_RUN) {
  console.log(`Run with --fix to null out eBay fields on these ${bad.length} snapshots.`)
  process.exit(0)
}

// ── 4. Batch-null the bad rows ────────────────────────────────────────────────
const ids      = bad.map(r => r.id)
const BATCH    = 500
let   fixed    = 0

for (let i = 0; i < ids.length; i += BATCH) {
  const chunk = ids.slice(i, i + BATCH)
  const { error } = await supabase
    .from('price_snapshots')
    .update({ ebay_sold_avg: null, ebay_sold_low: null, ebay_sold_high: null })
    .in('id', chunk)
  if (error) {
    console.error(`Batch ${i}–${i + BATCH} failed:`, error)
  } else {
    fixed += chunk.length
    console.log(`  Cleared ${fixed} / ${ids.length}…`)
  }
}

console.log(`\nDone. ${fixed} snapshots cleaned.`)
