# Supabase Project Files

Keep database schema, views, policies, functions, and seed data here so frontend changes can be reviewed alongside database changes.

Layout:

- `migrations/` - ordered SQL migration files (`YYYYMMDD_description.sql`), applied once, in order. This is the real change history — never edit an existing one after it's been applied; add a new dated file instead.
- `snapshots/` - full point-in-time dumps of current state, regenerated/overwritten wholesale for review context. Not applied directly, and not ordered relative to each other.
  - `schema.sql` - full schema snapshot.
  - `views.sql` - current definitions for all app-facing views.
  - `policies.sql` - row-level security policies (currently a placeholder — most RLS policies are defined inline in their originating migration instead).
- `functions/` - Supabase Edge Function source.

The frontend currently reads these app-facing views:

- `v_inventory_dashboard`
- `v_latest_prices`
- `v_active_alerts`
- `v_ebay_active`
- `v_ebay_sold`
- `v_global_pnl`
- `v_ebay_pnl_by_game`
- `v_tcgplayer_active`
- `v_tcgplayer_sold`
- `v_tcgplayer_pnl`
- `v_tcgplayer_pnl_by_game`
- `v_combined_pnl`
- `v_box_pnl`
- `v_price_gainers_losers`
- `v_listing_price_alerts`
- `v_stale_listings`
- `v_youtube_opening_summary`

Changes land as timestamped files in `migrations/` (paste/run in the Supabase SQL editor — this project doesn't use `supabase db push`); update `snapshots/schema.sql` and `snapshots/views.sql` afterward so they stay a faithful reference of current state.
