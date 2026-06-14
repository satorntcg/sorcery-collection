// ============================================================
// Edge Function: daily_price_check v18
// eBay prices ONLY — TCGPlayer handled by Google Apps Script
// Processes BATCH_SIZE cards per run, skips cards already
// checked today. Only processes cards that have a TCGplayer
// snapshot today — no wasted batch slots.
// Run every 20 min via pg_cron.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const EBAY_APP_ID      = Deno.env.get("EBAY_APP_ID")!;
const EBAY_CERT_ID     = Deno.env.get("EBAY_CERT_ID")!;
const ALERT_THRESHOLD  = parseFloat(Deno.env.get("ALERT_PCT_THRESHOLD") ?? "15");
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")!;
const ALERT_EMAIL_TO   = Deno.env.get("ALERT_EMAIL_TO") ?? "satorntcg@gmail.com";
const ALERT_EMAIL_FROM = "Sorcery TCG Manager <alerts@satorntcg.com>";
const BATCH_SIZE       = parseInt(Deno.env.get("BATCH_SIZE") ?? "25");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Content-Type":                 "application/json",
};

interface Card {
  id:           string;
  name:         string;
  set_name:     string;
  foil:         boolean;
  tcgplayer_id: string | null;
}

interface AlertRecord {
  cardName:  string;
  alertType: string;
  oldPrice:  number;
  newPrice:  number;
  pctChange: number;
  message:   string;
}

// ─────────────────────────────────────────
// eBay OAuth
// ─────────────────────────────────────────
async function getEbayToken(): Promise<string> {
  const credentials = btoa(`${EBAY_APP_ID}:${EBAY_CERT_ID}`);
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });
  if (!res.ok) throw new Error(`eBay OAuth failed: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

// ─────────────────────────────────────────
// eBay Finding API — completed/sold items only
// ─────────────────────────────────────────
async function fetchEbayPrices(
  cardName: string,
  foil: boolean,
  _token: string,
): Promise<{ avg: number | null; low: number | null; high: number | null; count: number }> {
  const foilTag = foil ? " foil" : " non-foil";

  const searchFn = async (keywords: string): Promise<number[]> => {
    const params = new URLSearchParams({
      "OPERATION-NAME":          "findCompletedItems",
      "SERVICE-VERSION":         "1.0.0",
      "SECURITY-APPNAME":        EBAY_APP_ID,
      "RESPONSE-DATA-FORMAT":    "JSON",
      "REST-PAYLOAD":            "",
      "keywords":                keywords,
      "itemFilter(0).name":      "SoldItemsOnly",
      "itemFilter(0).value":     "true",
      "itemFilter(1).name":      "ListingType",
      "itemFilter(1).value":     "FixedPrice",
      "sortOrder":               "EndTimeSoonest",
      "paginationInput.entriesPerPage": "50",
    });
    const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 3000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "X-EBAY-SOA-SECURITY-APPNAME": EBAY_APP_ID },
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res!.ok) return [];
    const json = await res.json();
    const items: Record<string, unknown>[] =
      json?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item ?? [];

    const titleFilter = (list: Record<string, unknown>[]) => {
      const filtered = list.filter(item => {
        const title = ((item.title as string[])?.[0] ?? '').toLowerCase();
        return foil ? title.includes('foil') : !title.includes('foil');
      });
      return (foil && filtered.length < 3) ? list : filtered;
    };

    return titleFilter(items)
      .map(item => parseFloat(
        ((item.sellingStatus as Record<string, unknown>[])?.[0]
          ?.currentPrice as Record<string, unknown>[])?.[0]
          ?.__value__ as string ?? "0"
      ))
      .filter(p => p > 0 && p < 50000);
  };

  try {
    let prices = await searchFn(`"${cardName}"${foilTag} Sorcery TCG`);
    if (!prices.length) prices = await searchFn(`${cardName}${foilTag} Sorcery card`);
    if (!prices.length) {
      prices = await searchFn(
        foil ? `"${cardName}" Sorcery TCG` : `"${cardName}" Sorcery TCG -foil`
      );
    }
    if (!prices.length) return { avg: null, low: null, high: null, count: 0 };

    prices.sort((a, b) => a - b);
    const mid      = Math.floor(prices.length / 2);
    const median   = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
    const filtered = prices.filter(p => p >= median * 0.2 && p <= median * 2.5);
    if (!filtered.length) return { avg: null, low: null, high: null, count: 0 };

    const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
    return {
      avg:   Math.round(avg * 100) / 100,
      low:   Math.min(...filtered),
      high:  Math.max(...filtered),
      count: filtered.length,
    };
  } catch {
    return { avg: null, low: null, high: null, count: 0 };
  }
}

// ─────────────────────────────────────────
// Alert engine — TCGPlayer price change only
// ─────────────────────────────────────────
async function checkAndCreateAlerts(
  cardId: string,
  cardName: string,
  prevTcgPrice: number | null,
  newTcgPrice: number | null,
  threshold: number,
  pendingEmailAlerts: AlertRecord[],
): Promise<void> {
  if (!prevTcgPrice || !newTcgPrice) return;
  const pct = ((newTcgPrice - prevTcgPrice) / prevTcgPrice) * 100;
  if (Math.abs(pct) < threshold) return;

  const alertType = pct > 0 ? "price_spike" : "price_drop";
  const message   = `TCGPlayer ${pct > 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}% ($${prevTcgPrice} → $${newTcgPrice})`;

  const { error } = await supabase.from("price_alerts").insert({
    card_id:    cardId,
    alert_type: alertType,
    old_price:  prevTcgPrice,
    new_price:  newTcgPrice,
    pct_change: Math.round(pct * 100) / 100,
    message,
  });
  if (error) { console.error("Alert insert failed:", error); return; }

  pendingEmailAlerts.push({
    cardName, alertType,
    oldPrice: prevTcgPrice, newPrice: newTcgPrice,
    pctChange: Math.round(pct * 100) / 100, message,
  });
}

// ─────────────────────────────────────────
// Status email
// ─────────────────────────────────────────
async function sendStatusEmail(
  results:   { updated: number; created: number; failed: number; skipped: number; alerts: number },
  alerts:    AlertRecord[],
  batchInfo: { batchSize: number; remaining: number; total: number; withSnapshot: number },
  lastCard:  string,
): Promise<void> {
  if (!RESEND_API_KEY) return;

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const allDone = batchInfo.remaining === 0;

  const alertRows = alerts.map(a => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #2A2520;color:#F0EAD6;font-weight:500;">${a.cardName}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2A2520;color:#9A9080;text-align:right;">$${a.oldPrice.toFixed(2)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2A2520;text-align:right;">$${a.newPrice.toFixed(2)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #2A2520;color:${a.pctChange > 0 ? '#4CAF6E' : '#C94C4C'};text-align:right;font-weight:600;">${a.pctChange > 0 ? '+' : ''}${a.pctChange.toFixed(1)}%</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><body style="background:#0A0908;color:#F0EAD6;font-family:-apple-system,sans-serif;margin:0;padding:0;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;">
  <div style="border-bottom:1px solid rgba(201,168,76,0.2);padding-bottom:20px;margin-bottom:24px;">
    <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#C9A84C;margin-bottom:6px;">Sorcery TCG Market Manager</div>
    <h1 style="margin:0;font-size:22px;font-weight:600;">eBay Price Check ${allDone ? '— Complete' : '— Batch'}</h1>
    <p style="margin:6px 0 0;font-size:13px;color:#9A9080;">${dateStr} · ${timeStr}</p>
  </div>

  <div style="background:#161411;border:1px solid rgba(201,168,76,0.1);border-radius:12px;padding:20px;margin-bottom:24px;">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center;">
      <div>
        <div style="font-size:22px;font-weight:300;color:#4CAF6E;">${results.updated}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5A5448;margin-top:4px;">Updated</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:300;color:#9A9080;">${results.created}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5A5448;margin-top:4px;">New snaps</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:300;color:${results.failed > 0 ? '#C94C4C' : '#9A9080'};">${results.failed}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5A5448;margin-top:4px;">Failed</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:300;color:${alerts.length > 0 ? '#C9A84C' : '#9A9080'};">${alerts.length}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5A5448;margin-top:4px;">Alerts</div>
      </div>
    </div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid #2A2520;font-size:12px;color:#5A5448;text-align:center;">
      Batch: ${batchInfo.batchSize} cards · ${batchInfo.remaining} remaining · ${batchInfo.withSnapshot} of ${batchInfo.total} cards have TCG snapshot today
      ${allDone ? ' · <span style="color:#4CAF6E;">All cards checked ✓</span>' : ''}
    </div>
    ${lastCard ? `
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #2A2520;font-size:12px;color:#5A5448;text-align:center;">
      Last card processed: <strong style="color:#F0EAD6;">${lastCard}</strong>
    </div>` : ''}
  </div>

  ${alerts.length > 0 ? `
  <div style="margin-bottom:24px;">
    <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;font-weight:500;">Price Alerts (${alerts.length})</div>
    <table style="width:100%;border-collapse:collapse;background:#161411;border:1px solid rgba(201,168,76,0.1);border-radius:10px;overflow:hidden;">
      <tr style="background:#1E1B17;">
        <th style="padding:8px 14px;text-align:left;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#5A5448;font-weight:400;">Card</th>
        <th style="padding:8px 14px;text-align:right;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#5A5448;font-weight:400;">Old</th>
        <th style="padding:8px 14px;text-align:right;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#5A5448;font-weight:400;">New</th>
        <th style="padding:8px 14px;text-align:right;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#5A5448;font-weight:400;">Change</th>
      </tr>
      ${alertRows}
    </table>
  </div>` : `
  <div style="background:#161411;border:1px solid rgba(201,168,76,0.1);border-radius:10px;padding:16px;margin-bottom:24px;text-align:center;color:#5A5448;font-size:13px;">
    No price alerts this batch
  </div>`}

  <div style="border-top:1px solid rgba(201,168,76,0.15);padding-top:16px;">
    <p style="font-size:12px;color:#5A5448;margin:0;">eBay sold prices (completed listings) · TCGPlayer via Google Apps Script · Alert threshold: ≥${ALERT_THRESHOLD}% · Foil-aware search v18</p>
  </div>
</div></body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from:    ALERT_EMAIL_FROM,
        to:      [ALERT_EMAIL_TO],
        subject: `🃏 eBay Check — ${results.updated} updated · ${alerts.length} alerts · ${batchInfo.remaining} remaining`,
        html,
      }),
    });
    const data = await res.json();
    if (!res.ok) console.error("Resend error:", JSON.stringify(data));
    else console.log("Status email sent:", data.id);
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}

// ─────────────────────────────────────────
// Failure alert email
// ─────────────────────────────────────────
async function sendFailureEmail(err: unknown): Promise<void> {
  if (!RESEND_API_KEY) return;
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from:    ALERT_EMAIL_FROM,
      to:      [ALERT_EMAIL_TO],
      subject: `🚨 eBay Price Check FAILED — ${dateStr}`,
      html: `<!DOCTYPE html><html><body style="background:#0A0908;color:#F0EAD6;font-family:-apple-system,sans-serif;margin:0;padding:0;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;">
  <div style="border-bottom:1px solid rgba(201,76,76,0.4);padding-bottom:20px;margin-bottom:24px;">
    <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#C94C4C;margin-bottom:6px;">Sorcery TCG Market Manager</div>
    <h1 style="margin:0;font-size:22px;font-weight:600;">⚠️ Edge Function Failed</h1>
    <p style="margin:6px 0 0;font-size:13px;color:#9A9080;">${dateStr} · ${timeStr}</p>
  </div>
  <div style="background:#1E1010;border:1px solid rgba(201,76,76,0.2);border-radius:12px;padding:20px;margin-bottom:24px;">
    <div style="font-size:12px;color:#C94C4C;font-weight:600;margin-bottom:8px;">ERROR</div>
    <pre style="font-size:12px;color:#F0EAD6;margin:0;white-space:pre-wrap;word-break:break-all;">${String(err)}</pre>
  </div>
  <div style="border-top:1px solid rgba(201,168,76,0.15);padding-top:16px;">
    <p style="font-size:12px;color:#5A5448;margin:0;">
      <a href="https://supabase.com/dashboard/project/fctyxspeishvjhlyfpbs/functions/daily_price_check/logs"
         style="color:#C9A84C;">View Edge Function logs →</a>
    </p>
  </div>
</div></body></html>`,
    }),
  }).catch(e => console.error("Failed to send failure email:", e));
}

// ─────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  // ── Auth: validate apikey header against Supabase secret keys ──
  const apiKey     = req.headers.get('apikey') ?? '';
  const secretKeys: Record<string, string> = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
  const isValid    = Object.values(secretKeys).some(k => k === apiKey);

  if (!isValid) {
    console.error(`Unauthorized — invalid apikey`);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  console.log(`Starting eBay price check v18 — batch size: ${BATCH_SIZE} — ${new Date().toISOString()}`);

  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // ── 1. Load today's snapshots — track which have TCG snapshot and which have eBay ──
    console.log("Step 1: Loading today's snapshot state...");
    const { data: todaySnaps } = await supabase
      .from("price_snapshots")
      .select("card_id, ebay_sold_avg")
      .gte("checked_at", todayStart.toISOString())
      .limit(50000);

    const hasSnapshotToday = new Set((todaySnaps ?? []).map(s => s.card_id));
    const alreadyHasEbay   = new Set(
      (todaySnaps ?? [])
        .filter(s => s.ebay_sold_avg !== null)
        .map(s => s.card_id)
    );

    // ── 2. Load all cards ──
    const { data: allCards, error: cardsError } = await supabase
      .from("cards")
      .select("id, name, set_name, foil, tcgplayer_id")
      .order("name")
      .limit(10000);

    if (cardsError) throw cardsError;

    const total        = allCards?.length ?? 0;
    const withSnapshot = hasSnapshotToday.size;

    // Only process cards that have a TCGplayer snapshot today but no eBay data yet
    const needsCheck = (allCards ?? []).filter(c =>
      hasSnapshotToday.has(c.id) && !alreadyHasEbay.has(c.id)
    );

    const batch     = needsCheck.slice(0, BATCH_SIZE);
    const remaining = needsCheck.length;

    console.log(`Cards total: ${total} | with TCG snapshot: ${withSnapshot} | need eBay: ${remaining} | this batch: ${batch.length}`);

    if (!batch.length) {
      console.log("All cards with snapshots have eBay prices today — nothing to do");
      return new Response(
        JSON.stringify({ message: "All cards checked today.", total, withSnapshot, remaining: 0 }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // ── 3. Load YESTERDAY's prices for alert comparison ──
    console.log("Step 2: Loading yesterday's prices for alert comparison...");
    const yesterday = new Date(todayStart);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const { data: prevSnaps } = await supabase
      .from("price_snapshots")
      .select("card_id, tcgplayer_market")
      .in("card_id", batch.map(c => c.id))
      .gte("checked_at", yesterday.toISOString())
      .lt("checked_at", todayStart.toISOString())
      .not("tcgplayer_market", "is", null)
      .order("checked_at", { ascending: false });

    const prevMap = new Map<string, number>();
    for (const s of (prevSnaps ?? [])) {
      if (!prevMap.has(s.card_id)) prevMap.set(s.card_id, s.tcgplayer_market as number);
    }

    // ── 4. Get eBay token (OAuth — still needed for other potential Browse API calls) ──
    console.log("Step 3: Getting eBay token...");
    const ebayToken = await getEbayToken();
    console.log("eBay token OK");

    // ── 5. Process batch ──
    const results   = { updated: 0, created: 0, failed: 0, skipped: 0, alerts: 0 };
    const pendingEmailAlerts: AlertRecord[] = [];
    let lastCard    = '';
    const startTime = Date.now();
    const DEADLINE  = 110_000; // stop at 110s to leave time for email before 150s timeout

    const CHUNK_SIZE = 5;
    for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
      if (Date.now() - startTime > DEADLINE) {
        console.log(`Time budget reached — stopping early (${results.updated} updated so far)`);
        break;
      }
      const chunk = (batch as Card[]).slice(i, i + CHUNK_SIZE);
      console.log(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: processing ${chunk.map(c => c.name).join(', ')}`);

      const chunkResults = await Promise.allSettled(chunk.map(async (card) => {
        const cardLabel = `${card.name}${card.foil ? ' (Foil)' : ''}`;
        const ebay = await fetchEbayPrices(card.name, card.foil ?? false, ebayToken);
        console.log(`  eBay: ${cardLabel} avg=$${ebay.avg} count=${ebay.count}`);

        const { data: existingSnap } = await supabase
          .from("price_snapshots")
          .select("id, tcgplayer_market")
          .eq("card_id", card.id)
          .gte("checked_at", todayStart.toISOString())
          .maybeSingle();

        if (!existingSnap) {
          console.log(`  → no snapshot for ${card.name}`);
          return 'skipped' as const;
        }

        const { error } = await supabase
          .from("price_snapshots")
          .update({
            ebay_sold_avg:   ebay.avg ?? 0,
            ebay_sold_low:   ebay.low,
            ebay_sold_high:  ebay.high,
            ebay_sold_count: ebay.count,
          })
          .eq("id", existingSnap.id);

        if (error) throw new Error(`Snapshot update failed for ${card.name}: ${error.message}`);

        await checkAndCreateAlerts(
          card.id, card.name,
          prevMap.get(card.id) ?? null,
          existingSnap.tcgplayer_market,
          ALERT_THRESHOLD,
          pendingEmailAlerts
        );

        console.log(`  ✓ ${cardLabel}`);
        return cardLabel;
      }));

      for (const r of chunkResults) {
        if (r.status === 'fulfilled') {
          if (r.value === 'skipped') { results.skipped++; }
          else { results.updated++; lastCard = r.value; }
        } else {
          console.error(`  FAILED: ${String(r.reason)}`);
          results.failed++;
        }
      }
    }

    // ── 6. Send status email ──
    results.alerts = pendingEmailAlerts.length;
    await sendStatusEmail(
      results,
      pendingEmailAlerts,
      {
        batchSize:    batch.length,
        remaining:    remaining - batch.length,
        total,
        withSnapshot,
      },
      lastCard,
    );

    console.log(`Batch complete:`, results);

    return new Response(
      JSON.stringify({
        message:       "eBay batch complete",
        checked_at:    new Date().toISOString(),
        batch_size:    batch.length,
        remaining:     remaining - batch.length,
        with_snapshot: withSnapshot,
        last_card:     lastCard,
        total,
        ...results,
      }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (err) {
    console.error("Fatal error:", err);
    await sendFailureEmail(err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
