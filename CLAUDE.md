# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server (default http://localhost:5173)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the built bundle locally
- No test, lint, or typecheck scripts are configured.

Env vars (required, loaded by Vite at startup — `src/lib/supabase.js` throws if missing):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Architecture

Pure client-side SPA: Vite + React 18 + react-router-dom v6, talking directly to a Supabase project. There is no backend in this repo — all persistence, auth, realtime, and the scheduled price check live in Supabase (Postgres tables, views, and an Edge Function).

### Entry and routing

`src/main.jsx` mounts `<BrowserRouter>` → `App`. `src/App.jsx` is the canonical app shell: it checks the Supabase session, renders `<Login />` when unauthenticated, and otherwise renders `<Sidebar>` plus a `<Routes>` block. Each top-level route maps 1:1 to a file in `src/pages/`:

| Route | File | Purpose |
|---|---|---|
| `/` | `Dashboard.jsx` | Portfolio overview, metrics |
| `/inventory` | `Inventory.jsx` | Card list with inline edit |
| `/alerts` | `Alerts.jsx` | Price alert review + dismiss |
| `/listings` | `Ebaylistings.jsx` | eBay listing CRUD (2-step modal) |
| `/suggestions` | `Listingsuggestions.jsx` | AI-powered lot grouping + eBay creation |
| `/boxes` | `Boxes.jsx` | Sealed product P&L |
| `/market` | `Market.jsx` | Manual price-check trigger |
| `/youtube` | `YouTube.jsx` | Pack opening tracker + shareable summary cards |
| `/import` | `Import.jsx` | Google Sheets bulk import |
| `/settings` | `Settings.jsx` | `check_schedule` settings row |

**Dead file:** `src/pages/Listings.jsx` is an older, simpler listing view that is no longer imported. The active file is `src/pages/Ebaylistings.jsx`. Do not edit `Listings.jsx`.

### Supabase as the data layer

`src/lib/supabase.js` exports a single shared `supabase` client. Pages call it directly with `supabase.from(...)` — there is no repository/service abstraction. When changing data flow, grep page files for the relevant table/view name.

Tables referenced by the UI (verify column existence against the actual Supabase project before assuming):
- `cards` — primary inventory: `name, set_name, set_code, rarity, condition, foil, quantity_owned, quantity_listed, quantity_available, active_listing_count, cost_basis, image_url, tcgplayer_id, notes`
- `price_snapshots` — historical TCGPlayer + eBay prices per card
- `price_alerts` — generated alerts: `alert_type, message, old_price, new_price, your_list_price, pct_change, dismissed`
- `ebay_listings` — user's outbound listings: `card_id, title, listed_price, shipping_cost, sold_price, ebay_fees, net_proceeds, status, notes, cost_basis`
- `ebay_listing_cards` — junction table for multi-card listings: `listing_id, card_id, price`
- `boxes` + `box_cards` — sealed product purchases and the cards pulled from them (for P&L)
- `packs` — individual packs within a box: `id, box_id, pack_number`
- `pack_cards` — cards recorded within each pack: `pack_id, card_id, quantity`
- `youtube_openings` — video opening records: `id, title, box_id, youtube_url, filmed_at`
- `youtube_opening_packs` — junction: which packs appear in a given opening: `opening_id, pack_id`
- `check_schedule` — single-row settings table: `frequency, run_at_hour, alert_pct_up, alert_pct_down`

Enums used in inserts (must match the DB):
- rarity: `ordinary | exceptional | elite | unique`
- condition: `near_mint | lightly_played | moderately_played | heavily_played | damaged`
- box_type: `booster_box | single_booster | prerelease_kit | bundle | other`
- listing status: `active | sold | ended | cancelled`

Views the UI reads from (heavier joins/aggregations live in Postgres, not the client):
- `v_inventory_dashboard` — cards joined with latest prices, `market_value`, `unrealized_pnl`, `quantity_listed`, `quantity_available`, `active_listing_count`
- `v_latest_prices` — most recent price snapshot per card
- `v_active_alerts` — undismissed alerts joined with card info
- `v_box_pnl` — boxes with `cards_market_value`, `gross_pnl`
- `v_youtube_opening_summary` — openings joined with pack/card aggregates: `total_tcg_value`, `opening_pnl`, `packs_cost`, `packs_in_video`, `pack_msrp`, `pack_count`, `box_name`, `set_name`
- `v_price_gainers_losers` — 7-day price movers per card: `card_id, name, rarity, foil, current_price, price_7d_ago, pct_change`

When adding a feature that needs joined data, prefer creating/extending a view over composing joins in JS.

### Realtime

`src/App.jsx` subscribes to `postgres_changes` on `price_alerts` to keep the sidebar badge live. Other pages re-fetch on mount; only the alert badge uses realtime.

### Pricing pipeline

The pricing pipeline runs in Supabase, not the browser. The Market page can manually invoke the Edge Function at `${VITE_SUPABASE_URL}/functions/v1/daily_price_check` (POST, bearer = anon key) to force a price refresh. The schedule is configured via the `check_schedule` row in the Settings page. The Edge Function source is not in this repo.

### Listing Suggestions + AI (Listingsuggestions.jsx)

Groups unlisted elite/unique cards into eBay lots using a client-side algorithm (`groupCards`): uniques get solo listings, elite foils and non-foils are packed into lots of ≤ 6 cards targeting ≥ $20 total. After grouping, the "AI analyse lots" button calls the **Anthropic Messages API directly from the browser** (`https://api.anthropic.com/v1/messages`) — this requires an API key to be present in the request headers; that key is currently hardcoded or missing (check the fetch call in `getAISuggestions`). Creating a listing writes to `ebay_listings` and `ebay_listing_cards`, then increments `quantity_listed` on each card.

Fee constants in this file (`EBAY_FEE_PCT = 0.129`, `EBAY_FEE_FLAT = 0.30`, `DEFAULT_SHIP = 5.00`) are shared with `Ebaylistings.jsx` — if you change fee rates, update both files.

### YouTube page (YouTube.jsx)

Tracks pack-by-pack openings filmed for YouTube. An opening links a set of `packs` from a `box` via `youtube_opening_packs`. The detail view fetches `pack_cards` for each pack (one query per pack) then joins against `v_latest_prices` to price each card. The `SummaryCard` component renders a shareable screenshot-ready summary (screenshotted via the browser, not a canvas API). Expects the `packs` table to be pre-populated per box.

### Bulk import (Import.jsx)

Imports cards + boxes from a published Google Sheet (`/pub` or `/spreadsheets/d/...` URLs are both parsed). Expects exact tab names `Cards` and `Boxes`. CSV is fetched client-side and parsed with a small hand-rolled parser that handles quoted commas. Rarity/condition/box_type free-text values are normalized through `RARITY_MAP`/`CONDITION_MAP`/`BOX_TYPE_MAP` before insert. Cards are matched for upsert on `(name, set_name, condition)`. Cards reference their originating box via a `box_ref` column in the sheet which is resolved to the inserted box's UUID at import time (sheet-only concept, not a DB column).

### WeeklyMovers component

`src/components/Weeklymovers.jsx` reads `v_price_gainers_losers` and renders top-5 gainers/losers side by side. It exists but is **not yet wired into Dashboard.jsx** — import and drop in `<WeeklyMovers />` to activate it.

### Styling

Single global stylesheet at `src/index.css` defines a CSS-variable design system (gold-on-dark, Cinzel + DM Sans). No CSS-in-JS library, no Tailwind, no per-component CSS. Reuse existing utility classes: `.panel`, `.panel-header`, `.data-table`, `.metric-card`, `.badge badge-<rarity|ok|alert>`, `.btn btn-primary|ghost|danger`, `.form-input`, `.form-select`, `.empty-state`, `.loading`, `.text-success|text-danger|text-gold|text-muted`. Inline `style={{}}` is used freely for one-offs — match that convention rather than adding new class files.
