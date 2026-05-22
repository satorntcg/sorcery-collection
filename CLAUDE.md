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

`src/main.jsx` mounts `<BrowserRouter>` → `App`. `App` renders the persistent `<Sidebar>` plus a `<Routes>` block. Each top-level route maps 1:1 to a file in `src/pages/`: Dashboard, Inventory, Alerts, Listings, Boxes, Market, Settings, Import.

### Two parallel App/Sidebar implementations — read carefully

There are duplicate files: `src/App.jsx` + `src/components/Sidebar.jsx` (no auth) and `src/pages/App.jsx` + `src/pages/Sidebar.jsx` (Supabase email/password auth + `Login.jsx` + sign-out button). `src/main.jsx` imports `./App`, so the **no-auth** version under `src/` is what actually runs. The `pages/App.jsx` variant has broken relative imports from its own location (it imports `./lib/supabase` and `./components/Sidebar`) and is effectively dead/WIP code intended to become the auth-gated shell. Before editing the app shell, decide which one is canonical and ask if unclear — don't blindly edit both.

### Supabase as the data layer

`src/lib/supabase.js` exports a single shared `supabase` client. Pages call it directly with `supabase.from(...)` — there is no repository/service abstraction. When changing data flow, expect to grep page files for the relevant table/view name.

Tables referenced by the UI (inferred from queries — verify against the actual Supabase project before assuming a column exists):
- `cards` — primary inventory (name, set_name, set_code, rarity, condition, foil, quantity_owned, cost_basis, image_url, tcgplayer_id, notes)
- `price_snapshots` — historical TCGPlayer + eBay prices per card
- `price_alerts` — generated alerts (alert_type, message, old_price, new_price, your_list_price, pct_change, dismissed)
- `ebay_listings` — user's outbound listings (status, list_price, shipping_cost, sold_price, ebay_fees, net_proceeds)
- `boxes` + `box_cards` — sealed product purchases and the cards pulled from them (for P&L)
- `check_schedule` — single-row settings table (frequency, run_at_hour, alert thresholds)

Enums used in inserts (must match the DB):
- rarity: `ordinary | exceptional | elite | unique`
- condition: `near_mint | lightly_played | moderately_played | heavily_played | damaged`
- box_type: `booster_box | single_booster | prerelease_kit | bundle | other`
- listing status: `active | sold | ended | cancelled`

Views the UI reads from (heavier joins/aggregations live in Postgres, not the client):
- `v_inventory_dashboard` — cards joined with latest prices, market_value, unrealized_pnl
- `v_latest_prices` — most recent price snapshot per card
- `v_active_alerts` — undismissed alerts joined with card info
- `v_box_pnl` — boxes with cards_market_value, gross_pnl

When adding a feature that needs joined data, prefer creating/extending a view over composing joins in JS.

### Realtime

`src/App.jsx` subscribes to `postgres_changes` on `price_alerts` to keep the sidebar badge live. Other pages re-fetch on mount; only the alert badge uses realtime.

### Pricing pipeline

The pricing pipeline runs in Supabase, not the browser. The Market page can manually invoke the Edge Function at `${VITE_SUPABASE_URL}/functions/v1/daily_price_check` (POST, bearer = user session or anon key) to force a price refresh. The schedule that normally runs it is configured via the `check_schedule` row exposed in the Settings page (`frequency`, `run_at_hour` UTC, `alert_pct_up`, `alert_pct_down`, etc.). The Edge Function source is not in this repo.

### Bulk import (Import.jsx)

Imports cards + boxes from a published Google Sheet (`/pub` or `/spreadsheets/d/...` URLs are both parsed). Expects exact tab names `Cards` and `Boxes`. CSV is fetched client-side and parsed with a small hand-rolled parser that handles quoted commas. Rarity/condition/box_type free-text values are normalized through `RARITY_MAP`/`CONDITION_MAP`/`BOX_TYPE_MAP` before insert. Cards are matched for upsert on `(name, set_name, condition)`. Cards reference their originating box via a `box_ref` column in the sheet which is resolved to the inserted box's UUID at import time (this is a sheet-only concept, not a DB column).

### Styling

Single global stylesheet at `src/index.css` defines a CSS-variable design system (gold-on-dark, Cinzel + DM Sans). No CSS-in-JS library, no Tailwind, no per-component CSS. Reuse existing utility classes (`.panel`, `.panel-header`, `.data-table`, `.metric-card`, `.badge badge-<rarity|ok|alert>`, `.btn btn-primary|ghost|danger`, `.form-input`, `.form-select`, `.empty-state`, `.loading`, `.text-success|text-danger|text-gold|text-muted`) rather than introducing new ad-hoc styles. Inline `style={{}}` is used freely for one-offs — match that convention rather than adding new class files.
