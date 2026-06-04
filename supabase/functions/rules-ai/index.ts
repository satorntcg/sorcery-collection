import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function ok(payload: any) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { question, mode } = await req.json()
    if (!question || !mode) return ok({ error: 'Missing question or mode' })

    // Embedding
    const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'text-embedding-ada-002', input: question }),
    })
    const embedData = await embedRes.json()
    if (!embedData.data) return ok({ error: `OpenAI failed: ${JSON.stringify(embedData.error ?? embedData)}` })
    const embedding = embedData.data[0].embedding

    // Vector search
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let chunks: any
    if (mode === 'compare') {
      const [r1, r2] = await Promise.all([
        serviceSupabase.rpc('match_documents', { query_embedding: embedding, match_threshold: 0.65, match_count: 3, filter_source: 'rulebook' }),
        serviceSupabase.rpc('match_documents', { query_embedding: embedding, match_threshold: 0.65, match_count: 3, filter_source: 'mtg_guide' }),
      ])
      if (r1.error) return ok({ error: `DB error (rulebook): ${r1.error.message}` })
      if (r2.error) return ok({ error: `DB error (mtg_guide): ${r2.error.message}` })
      chunks = { sorcery: r1.data ?? [], mtg: r2.data ?? [] }
    } else {
      const source = mode === 'mtg' ? 'mtg_guide' : 'rulebook'
      const { data, error } = await serviceSupabase.rpc('match_documents', {
        query_embedding: embedding, match_threshold: 0.65, match_count: 5, filter_source: source,
      })
      if (error) return ok({ error: `DB error: ${error.message}` })
      chunks = { single: data ?? [] }
    }

    const noMatch = mode === 'compare'
      ? chunks.sorcery.length === 0 && chunks.mtg.length === 0
      : chunks.single.length === 0
    if (noMatch) return ok({ noMatch: true })

    // Build system prompt
    let system: string
    if (mode === 'compare') {
      const sCtx = chunks.sorcery.length ? chunks.sorcery.map((c: any) => c.content).join('\n\n---\n\n') : 'No relevant Sorcery rulebook excerpts found.'
      const mCtx = chunks.mtg.length ? chunks.mtg.map((c: any) => c.content).join('\n\n---\n\n') : 'No relevant MTG comparison guide excerpts found.'
      system = `You are an expert on both Magic: The Gathering and Sorcery: Contested Realm. Using ONLY the excerpts below, compare how this rule or mechanic works in Sorcery versus MTG. First explain the Sorcery rule, then how it compares to MTG. Be clear and concise. Use plain text only — no markdown headers or bullet symbols.\n\nSorcery rulebook excerpts:\n${sCtx}\n\n---\n\nMTG comparison guide excerpts:\n${mCtx}`
    } else if (mode === 'mtg') {
      system = `You are an expert helping Magic: The Gathering players understand Sorcery: Contested Realm. Answer the player's question using ONLY the guide excerpts below. Highlight how mechanics relate to or differ from MTG where relevant. Be clear and concise. Use plain text only — no markdown headers or bullet symbols. If the answer isn't in the excerpts, say so honestly.\n\nMTG-to-Sorcery guide excerpts:\n${chunks.single.map((c: any) => c.content).join('\n\n---\n\n')}`
    } else {
      system = `You are a Sorcery: Contested Realm rules expert. Answer the player's question using ONLY the rulebook excerpts below. Be clear and concise. Use plain text only — no markdown headers or bullet symbols. If the answer isn't in the excerpts, say so honestly and suggest they check the full rulebook.\n\nRulebook excerpts:\n${chunks.single.map((c: any) => c.content).join('\n\n---\n\n')}`
    }

    // Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: question }],
      }),
    })
    const claudeData = await claudeRes.json()
    if (claudeData.error) return ok({ error: `Claude failed: ${claudeData.error.message}` })

    return ok({ answer: claudeData.content[0].text })

  } catch (e: any) {
    return ok({ error: `Unhandled exception: ${e?.message ?? String(e)}` })
  }
})
