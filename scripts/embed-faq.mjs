/**
 * One-time script: embed the Sorcery card FAQ CSV into document_chunks.
 *
 * Usage:
 *   node scripts/embed-faq.mjs <path-to-faq.csv>
 *
 * Requires env vars (copy from .env.local or set in shell):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *   VITE_OPENAI_KEY
 *
 * Each CSV row (card name, question, answer) becomes one document_chunk
 * with source='rulebook' so the rules-ai Edge Function retrieves it
 * without any server-side changes.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import { createClient } from '@supabase/supabase-js'

// ── Load .env from project root (one level above scripts/) ───────────────────
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

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY     = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const OPENAI_KEY       = process.env.VITE_OPENAI_KEY || process.env.OPENAI_API_KEY
const EMBED_MODEL      = 'text-embedding-ada-002'
const BATCH_SIZE       = 20   // rows per embedding API call
const INSERT_BATCH     = 50   // rows per Supabase insert

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
  console.error('Missing env vars. Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_OPENAI_KEY')
  process.exit(1)
}

const csvPath = process.argv[2]
if (!csvPath) {
  console.error('Usage: node scripts/embed-faq.mjs <path-to-faq.csv>')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── CSV parser (handles quoted commas) ───────────────────────────────────────

function parseCSVLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

async function readCSV(path) {
  const rows = []
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity })
  let header = null
  for await (const line of rl) {
    if (!line.trim()) continue
    const fields = parseCSVLine(line)
    if (!header) { header = fields.map(f => f.toLowerCase()); continue }
    const row = {}
    header.forEach((h, i) => { row[h] = fields[i] ?? '' })
    rows.push(row)
  }
  return rows
}

// ── OpenAI embedding ─────────────────────────────────────────────────────────

async function embedBatch(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI error ${res.status}: ${err}`)
  }
  const json = await res.json()
  return json.data.map(d => d.embedding)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading CSV: ${csvPath}`)
  const rows = await readCSV(csvPath)
  console.log(`Parsed ${rows.length} FAQ rows`)

  // Detect header columns flexibly
  const sample = rows[0]
  const keys = Object.keys(sample)
  const cardKey     = keys.find(k => k.includes('card'))     ?? keys[0]
  const questionKey = keys.find(k => k.includes('question')) ?? keys[1]
  const answerKey   = keys.find(k => k.includes('answer'))   ?? keys[2]
  console.log(`Column mapping: card="${cardKey}", question="${questionKey}", answer="${answerKey}"`)

  // Build content strings (forward-fill empty card names from previous row)
  let lastCard = ''
  const chunks = rows
    .filter(r => r[questionKey] && r[answerKey])
    .map(r => {
      if (r[cardKey]) lastCard = r[cardKey]
      return {
        content:  `Card: ${lastCard}\nQ: ${r[questionKey]}\nA: ${r[answerKey]}`,
        cardName: lastCard,
      }
    })
  console.log(`${chunks.length} non-empty chunks to embed`)

  // Embed in batches
  const embeddings = []
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    process.stdout.write(`Embedding ${i + 1}–${Math.min(i + BATCH_SIZE, chunks.length)} / ${chunks.length}...`)
    const vecs = await embedBatch(batch.map(c => c.content))
    embeddings.push(...vecs)
    console.log(' done')
  }

  // Build insert rows
  const insertRows = chunks.map((c, idx) => ({
    source:     'rulebook',
    source_id:  `faq::${c.cardName}::${idx}`,
    content:    c.content,
    embedding:  embeddings[idx],
    metadata:   { type: 'faq', card: c.cardName },
  }))

  // Delete any previously embedded FAQ chunks, then insert fresh
  console.log('Deleting existing FAQ chunks...')
  const { error: delError } = await supabase
    .from('document_chunks')
    .delete()
    .eq('source', 'rulebook')
    .filter('metadata->>type', 'eq', 'faq')
  if (delError) throw new Error(`Supabase delete error: ${delError.message}`)

  let inserted = 0
  for (let i = 0; i < insertRows.length; i += INSERT_BATCH) {
    const batch = insertRows.slice(i, i + INSERT_BATCH)
    const { error } = await supabase
      .from('document_chunks')
      .insert(batch)
    if (error) throw new Error(`Supabase insert error: ${error.message}`)
    inserted += batch.length
    console.log(`Inserted ${inserted} / ${insertRows.length}`)
  }

  console.log(`\nDone! ${inserted} FAQ chunks embedded and stored in document_chunks.`)
  console.log('The rules-ai Edge Function will now retrieve these automatically.')
}

main().catch(e => { console.error(e); process.exit(1) })
