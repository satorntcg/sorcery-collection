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

    const prompt = `You are helping a Sorcery: Contested Realm TCG seller create eBay listing titles.

Here are the proposed card lots (cards listed highest-value first):
${groups.map((g: any, i: number) => {
  const sorted = [...g.cards].sort((a: any, b: any) => (b.tcgplayer_market || 0) - (a.tcgplayer_market || 0))
  const setCounts: Record<string, number> = {}
  for (const c of sorted) if (c.set_name) setCounts[c.set_name] = (setCounts[c.set_name] || 0) + 1
  const dominantSet = Object.entries(setCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Sorcery TCG'
  return `
Lot ${i + 1} [${g.tier}] — $${g.total.toFixed(2)} total | ${g.cards.length} card${g.cards.length !== 1 ? 's' : ''} | Set: ${dominantSet}
Cards: ${sorted.map((c: any) => `${c.name} (${c.set_name ?? dominantSet}, ${c.rarity}${c.foil ? ' Foil' : ''}) $${(c.tcgplayer_market || 0).toFixed(2)}`).join(', ')}`
}).join('\n')}

For each lot, generate a title using this exact formula (max 80 chars):
  Single card: "{Card Name} Sorcery TCG {Set} {Tier} NM"
  Lot:         "{Top Card Name} + {N} More Sorcery TCG {Set} {Qty}-Card {Tier} Lot NM"

Rules:
- Lead with the highest-value card's name (first card listed above)
- For lots with 2+ cards: "{Top Card Name} + {remaining count} More ..."
- Set comes from the dominant set name in the lot (e.g. "Gothic", "Arthurian Legends")
- Quantity (e.g. "5-Card") appears before the tier label
- Tier label (e.g. "Elite", "Unique", "Foil", "Unique Foil") comes from the lot's tier
- Always end with "NM" for Near Mint condition
- Stay within 80 characters — abbreviate if needed

Also provide:
- A brief 1-sentence selling note about why this lot is good value
- A "synergy score" from 1-5 based on how well the cards go together thematically

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
