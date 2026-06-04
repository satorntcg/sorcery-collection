import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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
    const { groups } = await req.json()
    if (!groups) return ok({ error: 'Missing groups' })

    const prompt = `You are helping a Sorcery: Contested Realm TCG seller create optimal eBay listing titles and grouping analysis.

Here are the proposed card lots:
${groups.map((g: any, i: number) => `
Lot ${i + 1} [${g.tier}] — $${g.total.toFixed(2)} total
Cards: ${g.cards.map((c: any) => `${c.name} (${c.rarity}${c.foil ? ' Foil' : ''}) $${(c.tcgplayer_market || 0).toFixed(2)}`).join(', ')}
`).join('\n')}

For each lot, provide:
1. A compelling eBay listing title (max 80 chars) that highlights the best cards
2. A brief 1-sentence selling note about why this lot is good value
3. A "synergy score" from 1-5 based on how well the cards go together thematically

Respond ONLY with a JSON array, one object per lot, in order:
[{"title": "...", "note": "...", "synergy": 3}, ...]`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    if (data.error) return ok({ error: `Claude failed: ${data.error.message}` })

    const text = data.content?.[0]?.text ?? '[]'
    try {
      return ok({ suggestions: JSON.parse(text.replace(/```json|```/g, '').trim()) })
    } catch {
      return ok({ suggestions: groups.map(() => ({ title: '', note: '', synergy: 3 })) })
    }
  } catch (e: any) {
    return ok({ error: `Unhandled exception: ${e?.message ?? String(e)}` })
  }
})
