// ============================================================
// Edge Function: daily_price_check v13
// eBay prices ONLY — TCGPlayer handled by Google Apps Script
// Processes BATCH_SIZE cards per run, skips cards already
// checked today. Run every 30 min via pg_cron.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const EBAY_APP_ID     = Deno.env.get("EBAY_APP_ID")!;
const EBAY_CERT_ID    = Deno.env.get("EBAY_CERT_ID")!;
const ALERT_THRESHOLD = parseFloat(Deno.env.get("ALERT_PCT_THRESHOLD") ?? "15");
const RESEND_API_KEY  = Deno.env.get("RESEND_API_KEY")!;
const ALERT_EMAIL_TO  = Deno.env.get("ALERT_EMAIL_TO") ?? "satorntcg@gmail.com";
const ALERT_EMAIL_FROM = "Sorcery TCG Manager <alerts@satorntcg.com>";
const BATCH_SIZE      = parseInt(Deno.env.get("BATCH_SIZE") ?? "50");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
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
// eBay Browse API — foil-aware search
// ─────────────────────────────────────────
async function fetchEbayPrices(
  cardName: string,
  foil: boolean,
  token: string,
): Promise<{ avg: number | null; low: number | null; high: number | null; count: number }> {
  const foilTag    = foil ? " foil" : " non-foil";
  const searchFn   = async (q: string, limit: number) => {
    const url = "https://api.ebay.com/buy/browse/v1/item_summary/search" +
      `?q=${encodeURIComponent(q)}&filter=buyingOptions:{FIXED_PRICE}&sort=price&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        "Authorization":           `Bearer ${token}`,
        "Content-Type":            "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    if (!res.ok) return [];
    return (await res.json())?.itemSummaries ?? [];
  };

  // Post-filter: keep only items whose title matches foil intent.
  // For non-foil cards, drop any listing with "foil" in the title.
  // For foil cards, drop any listing that lacks "foil" in the title — but only
  // if doing so still leaves at least 3 results (avoids over-filtering rare cards).
  const titleFilter = (rawItems: Record<string, unknown>[]) => {
    const filtered = rawItems.filter((item) => {
      const title = ((item.title as string) ?? '').toLowerCase();
      return foil ? title.includes('foil') : !title.includes('foil');
    });
    return (foil && filtered.length < 3) ? rawItems : filtered;
  };

  try {
    // 1. Foil-qualified search
    let items = titleFilter(await searchFn(`"${cardName}"${foilTag} Sorcery TCG`, 50));
    // 2. Broader foil-qualified fallback
    if (!items.length) items = titleFilter(await searchFn(`${cardName}${foilTag} Sorcery card`, 20));
    // 3. Last-resort fallback — keep foil qualifier via negative keyword for non-foil cards
    if (!items.length) {
      const fallbackQ = foil
        ? `"${cardName}" Sorcery TCG`
        : `"${cardName}" Sorcery TCG -foil`;
      items = titleFilter(await searchFn(fallbackQ, 30));
    }
    if (!items.length) return { avg: null, low: null, high: null, count: 0 };

    let prices: number[] = items
      .map((item: Record<string, unknown>) =>
        parseFloat(((item.price as Record<string, unknown>)?.value as string) ?? "0"))
      .filter((p: number) => p > 0 && p < 50000);

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
    card_id: cardId, alert_type: alertType,
    old_price: prevTcgPrice, new_price: newTcgPrice,
    pct_change: Math.round(pct * 100) / 100, message,
  });
  if (error) { console.error("Alert insert failed:", error); return; }

  pendingEmailAlerts.push({ cardName, alertType, oldPrice: prevTcgPrice, newPrice: newTcgPrice, pctChange: Math.round(pct * 100) / 100, message });
}

// ─────────────────────────────────────────
// Status email (always sent after batch)
// ─────────────────────────────────────────
async function sendStatusEmail(
  results: { updated: number; created: number; failed: number; alerts: number },
  alerts: AlertRecord[],
  batchInfo: { batchSize: number; remaining: number; total: number },
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
      <div><div style="font-size:22px;font-weight:300;color:#4CAF6E;">${results.updated}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5A5448;margin-top:4px;">Updated</div></div>
      <div><div style="font-size:22px;font-weight:300;color:#9A9080;">${results.created}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5A5448;margin-top:4px;">New snaps</div></div>
      <div><div style="font-size:22px;font-weight:300;color:${results.failed > 0 ? '#C94C4C' : '#9A9080'};">${results.failed}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5A5448;margin-top:4px;">Failed</div></div>
      <div><div style="font-size:22px;font-weight:300;color:${alerts.length > 0 ? '#C9A84C' : '#9A9080'};">${alerts.length}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5A5448;margin-top:4px;">Alerts</div></div>
    </div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid #2A2520;font-size:12px;color:#5A5448;text-align:center;">
      Batch: ${batchInfo.batchSize} cards · ${batchInfo.remaining} remaining of ${batchInfo.total} total
      ${allDone ? ' · <span style="color:#4CAF6E;">All cards checked ✓</span>' : ''}
    </div>
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
  <div style="background:#161411;border:1px solid rgba(201,168,76,0.1);border-radius:10px;padding:16px;margin-bottom:24px;text-align:center;color:#5A5448;font-size:13px;">No price alerts this batch</div>`}

  <div style="border-top:1px solid rgba(201,168,76,0.15);padding-top:16px;">
    <p style="font-size:12px;color:#5A5448;margin:0;">eBay prices only · TCGPlayer via Google Apps Script · Alert threshold: ≥${ALERT_THRESHOLD}% · Foil-aware search v13</p>
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
// Main handler
// ─────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  console.log(`Starting eBay price check v13 — batch size: ${BATCH_SIZE} — ${new Date().toISOString()}`);

  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // ── 1. Find cards that don't yet have eBay data today ──
    console.log("Step 1: Finding cards needing eBay check today...");
    const { data: checkedIds } = await supabase
      .from("price_snapshots")
      .select("card_id")
      .gte("checked_at", todayStart.toISOString())
      .not("ebay_sold_avg", "is", null);

    const alreadyHasEbay = new Set((checkedIds ?? []).map(s => s.card_id));

    const { data: allCards, error: cardsError } = await supabase
      .from("cards")
      .select("id, name, set_name, foil, tcgplayer_id")
      .order("name");

    if (cardsError) throw cardsError;

    const needsCheck = (allCards ?? []).filter(c => !alreadyHasEbay.has(c.id));
    const batch      = needsCheck.slice(0, BATCH_SIZE);
    const remaining  = needsCheck.length;
    const total      = allCards?.length ?? 0;

    console.log(`Cards total: ${total} | need eBay check: ${remaining} | this batch: ${batch.length}`);

    if (!batch.length) {
      console.log("All cards have eBay prices today — nothing to do");
      return new Response(
        JSON.stringify({ message: "All cards checked today.", total, remaining: 0 }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // ── 2. Load YESTERDAY's prices for alert comparison ──
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

    // Dedupe to one per card (most recent yesterday snapshot)
    const prevMap = new Map<string, number>();
    for (const s of (prevSnaps ?? [])) {
      if (!prevMap.has(s.card_id)) prevMap.set(s.card_id, s.tcgplayer_market as number);
    }

    // ── 3. Get eBay token ──
    console.log("Step 3: Getting eBay token...");
    const ebayToken = await getEbayToken();
    console.log("eBay token OK");

    // ── 4. Process batch ──
    const results = { updated: 0, created: 0, failed: 0, alerts: 0 };
    const pendingEmailAlerts: AlertRecord[] = [];

    for (const card of batch as Card[]) {
      console.log(`Processing: ${card.name}${card.foil ? ' (Foil)' : ''}`);
      try {
        await new Promise(r => setTimeout(r, 300));

        // Pass foil flag so search is foil-aware
        const ebay = await fetchEbayPrices(card.name, card.foil ?? false, ebayToken);
        console.log(`  eBay: avg=$${ebay.avg} count=${ebay.count}`);

        const { data: existingSnap } = await supabase
          .from("price_snapshots")
          .select("id, tcgplayer_market")
          .eq("card_id", card.id)
          .gte("checked_at", todayStart.toISOString())
          .maybeSingle();

        if (existingSnap) {
          const { error } = await supabase
            .from("price_snapshots")
            .update({
              ebay_sold_avg:   ebay.avg ?? 0,
              ebay_sold_low:   ebay.low,
              ebay_sold_high:  ebay.high,
              ebay_sold_count: ebay.count,
            })
            .eq("id", existingSnap.id);

          if (error) { console.error(`  Snapshot update failed: ${error.message}`); results.failed++; continue; }

          // Compare yesterday's price to today's for alerts
          await checkAndCreateAlerts(
            card.id, card.name,
            prevMap.get(card.id) ?? null,
            existingSnap.tcgplayer_market,
            ALERT_THRESHOLD,
            pendingEmailAlerts
          );

          results.updated++;
          console.log(`  ✓ updated snapshot`);
        } else {
          console.log(`  → no snapshot today for ${card.name} — skipping (Apps Script will create)`);
        }
      } catch (err) {
        console.error(`  FAILED: ${card.name} — ${String(err)}`);
        results.failed++;
      }
    }

    // ── 5. Send status email ──
    results.alerts = pendingEmailAlerts.length;
    await sendStatusEmail(results, pendingEmailAlerts, {
      batchSize: batch.length,
      remaining: remaining - batch.length,
      total,
    });

    console.log(`Batch complete:`, results);

    return new Response(
      JSON.stringify({
        message:    "eBay batch complete",
        checked_at: new Date().toISOString(),
        batch_size: batch.length,
        remaining:  remaining - batch.length,
        total,
        ...results,
      }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (err) {
    console.error("Fatal error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});