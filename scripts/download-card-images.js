// One-time script: downloads card images from TCGPlayer and hosts them in Supabase Storage.
// Run after adding SUPABASE_SERVICE_ROLE_KEY to .env:
//   node --env-file=.env scripts/download-card-images.js

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
const BUCKET       = 'card-images'
const DELAY_MS     = 300 // polite pause between downloads

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets()
  if (!buckets?.find(b => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
    if (error) throw new Error(`Could not create bucket: ${error.message}`)
    console.log(`Created storage bucket "${BUCKET}"`)
  }
}

async function run() {
  await ensureBucket()

  // Only fetch cards that have a tcgplayer_id but no image_url yet
  const { data: cards, error } = await supabase
    .from('cards')
    .select('id, name, tcgplayer_id')
    .not('tcgplayer_id', 'is', null)
    .is('image_url', null)

  if (error) { console.error('DB fetch error:', error.message); process.exit(1) }
  if (!cards.length) { console.log('All cards already have images.'); return }

  console.log(`Downloading images for ${cards.length} cards...\n`)

  let success = 0, failed = 0

  for (const card of cards) {
    const srcUrl  = `https://product-images.tcgplayer.com/fit-in/400x558/${card.tcgplayer_id}.jpg`
    const dstPath = `${card.tcgplayer_id}.jpg`

    try {
      const res = await fetch(srcUrl)
      if (!res.ok) throw new Error(`TCGPlayer returned HTTP ${res.status}`)

      const buffer = await res.arrayBuffer()

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(dstPath, buffer, { contentType: 'image/jpeg', upsert: true })
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(dstPath)

      const { error: dbErr } = await supabase
        .from('cards')
        .update({ image_url: publicUrl })
        .eq('id', card.id)
      if (dbErr) throw new Error(`DB update failed: ${dbErr.message}`)

      console.log(`✓  ${card.name}`)
      success++
    } catch (e) {
      console.error(`✗  ${card.name}: ${e.message}`)
      failed++
    }

    await sleep(DELAY_MS)
  }

  console.log(`\nFinished: ${success} succeeded, ${failed} failed`)
  if (failed > 0) console.log('Re-run the script to retry failed cards.')
}

run()
