import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-ada-002', input: text }),
  })
  const data = await res.json()
  if (!data.data) throw new Error('Embedding failed')
  return data.data[0].embedding
}

async function fetchChunks(supabase: any, embedding: number[], filterSource: string, count: number) {
  const { data } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: 0.65,
    match_count: count,
    filter_source: filterSource,
  })
  return data ?? []
}

function buildSystemPrompt(mode: string, chunks: any): string {
  if (mode === 'compare') {
    const sCtx = chunks.sorcery.length
      ? chunks.sorcery.map((c: any) => c.content).join('\n\n---\n\n')
      : 'No relevant Sorcery rulebook excerpts found.'
    const mCtx = chunks.mtg.length
      ? chunks.mtg.map((c: any) => c.content).join('\n\n---\n\n')
      : 'No relevant MTG comparison guide excerpts found.'
    return `You are an expert on both Magic: The Gathering and Sorcery: Contested Realm. Using ONLY the excerpts below, compare how this rule or mechanic works in Sorcery versus MTG. First explain the Sorcery rule, then how it compares to MTG. Be clear and concise. Use plain text only — no markdown headers or bullet symbols.

Sorcery rulebook excerpts:
${sCtx}

---

MTG comparison guide excerpts:
${mCtx}`
  }

  const context = chunks.single.map((c: any) => c.content).join('\n\n---\n\n')

  if (mode === 'mtg') {
    return `You are an expert helping Magic: The Gathering players understand Sorcery: Contested Realm. Answer the player's question using ONLY the guide excerpts below. Highlight how mechanics relate to or differ from MTG where relevant. Be clear and concise. Use plain text only — no markdown headers or bullet symbols. If the answer isn't in the excerpts, say so honestly.

MTG-to-Sorcery guide excerpts:
${context}`
  }

  return `You are a Sorcery: Contested Realm rules expert. Answer the player's question using ONLY the rulebook excerpts below. Be clear and concise. Use plain text only — no markdown headers or bullet symbols. If the answer isn't in the excerpts, say so honestly and suggest they check the full rulebook.

Rulebook excerpts:
${context}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { question, mode } = await req.json()

  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const embedding = await getEmbedding(question)

  let chunks: any
  if (mode === 'compare') {
    const [sorcery, mtg] = await Promise.all([
      fetchChunks(serviceSupabase, embedding, 'rulebook', 3),
      fetchChunks(serviceSupabase, embedding, 'mtg_guide', 3),
    ])
    chunks = { sorcery, mtg }
  } else {
    const source = mode === 'mtg' ? 'mtg_guide' : 'rulebook'
    chunks = { single: await fetchChunks(serviceSupabase, embedding, source, 5) }
  }

  const noMatch = mode === 'compare'
    ? chunks.sorcery.length === 0 && chunks.mtg.length === 0
    : chunks.single.length === 0

  if (noMatch) {
    return new Response(JSON.stringify({ noMatch: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: buildSystemPrompt(mode, chunks),
      messages: [{ role: 'user', content: question }],
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(data.error.message)

  return new Response(JSON.stringify({ answer: data.content[0].text }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
