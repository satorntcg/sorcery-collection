-- Multi-game support: a `games` table + `game_id` on the two root entities
-- (`cards`, `boxes`). Everything else (price_snapshots, ebay_listings,
-- tcgplayer_listings, packs, pack_cards, youtube_openings, ...) is scoped
-- transitively through card_id/box_id, so it needs no game_id column of its
-- own — only the views that surface card/box fields need game_id added to
-- their SELECT list so the frontend can filter by it.
--
-- `cards.rarity` moves from the Sorcery-only `card_rarity` enum to `text`,
-- since rarity vocabulary is completely different per game (confirmed via
-- Riftbound: common/uncommon/rare/epic/overnumbered vs. Sorcery's
-- ordinary/exceptional/elite/unique). `cards.card_type` was already `text`.
-- `condition` stays the shared `card_condition` enum — grading terminology
-- is a universal TCG standard, not game-specific.

-- ── games table ────────────────────────────────────────────────────────

CREATE TABLE public.games (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.games OWNER TO postgres;

COMMENT ON TABLE public.games IS 'Games tracked by the app (Sorcery, Riftbound, ...). Root FK target for cards.game_id / boxes.game_id.';

CREATE TRIGGER trg_games_updated_at BEFORE UPDATE ON public.games FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_only ON public.games USING ((auth.role() = 'authenticated'::text));

GRANT ALL ON TABLE public.games TO anon;
GRANT ALL ON TABLE public.games TO authenticated;
GRANT ALL ON TABLE public.games TO service_role;

INSERT INTO public.games (name, slug, sort_order) VALUES
    ('Sorcery TCG', 'sorcery', 1),
    ('Riftbound', 'riftbound', 2);

-- ── game_id on cards / boxes ──────────────────────────────────────────

ALTER TABLE public.cards ADD COLUMN game_id uuid REFERENCES public.games(id);
UPDATE public.cards SET game_id = (SELECT id FROM public.games WHERE slug = 'sorcery') WHERE game_id IS NULL;
ALTER TABLE public.cards ALTER COLUMN game_id SET NOT NULL;
CREATE INDEX cards_game_id_idx ON public.cards USING btree (game_id);

ALTER TABLE public.boxes ADD COLUMN game_id uuid REFERENCES public.games(id);
UPDATE public.boxes SET game_id = (SELECT id FROM public.games WHERE slug = 'sorcery') WHERE game_id IS NULL;
ALTER TABLE public.boxes ALTER COLUMN game_id SET NOT NULL;
CREATE INDEX boxes_game_id_idx ON public.boxes USING btree (game_id);

-- ── cards.rarity: enum → text ─────────────────────────────────────────
-- Postgres refuses to ALTER COLUMN TYPE while any view depends on that
-- column (checked against views as they currently exist, not what the rest
-- of this script recreates them as) — so every view touching cards.rarity
-- must be dropped first. CASCADE + IF EXISTS makes the order harmless: it's
-- safe to list a view that's already gone via an earlier CASCADE.

DROP VIEW IF EXISTS public.v_active_alerts CASCADE;
DROP VIEW IF EXISTS public.v_box_pnl CASCADE;
DROP VIEW IF EXISTS public.v_ebay_active CASCADE;
DROP VIEW IF EXISTS public.v_ebay_sold CASCADE;
DROP VIEW IF EXISTS public.v_tcgplayer_active CASCADE;
DROP VIEW IF EXISTS public.v_tcgplayer_sold CASCADE;
DROP VIEW IF EXISTS public.v_inventory_dashboard CASCADE;
DROP VIEW IF EXISTS public.v_latest_prices CASCADE;
DROP VIEW IF EXISTS public.v_listing_price_alerts CASCADE;
DROP VIEW IF EXISTS public.v_pack_pnl CASCADE;
DROP VIEW IF EXISTS public.v_price_gainers_losers CASCADE;
DROP VIEW IF EXISTS public.v_price_highs CASCADE;
DROP VIEW IF EXISTS public.v_price_history CASCADE;
DROP VIEW IF EXISTS public.v_stale_listings CASCADE;
DROP VIEW IF EXISTS public.v_unrealized_gain_alerts CASCADE;
DROP VIEW IF EXISTS public.v_youtube_opening_summary CASCADE;

ALTER TABLE public.cards ALTER COLUMN rarity TYPE text USING rarity::text;
DROP TYPE public.card_rarity;

-- ── Views: recreate with game_id added so the frontend can filter by
-- active game ───────────────────────────────────────────────────────────
-- (Re-running the exact CREATE OR REPLACE VIEW bodies from supabase/views.sql
-- with `c.game_id` / `b.game_id` added to the SELECT list, and to GROUP BY
-- where the view aggregates. v_global_pnl / v_tcgplayer_pnl / v_combined_pnl
-- are intentionally left untouched — they stay all-games-combined, and
-- weren't dropped above since they don't reference cards.rarity.)
--
-- v_latest_prices goes first — several other views below (v_box_pnl,
-- v_ebay_active, v_tcgplayer_active, v_inventory_dashboard,
-- v_listing_price_alerts, v_pack_pnl, v_stale_listings,
-- v_unrealized_gain_alerts, v_youtube_opening_summary) JOIN against it, and
-- it was just dropped above, so it must exist again before they're recreated.

CREATE OR REPLACE VIEW public.v_latest_prices AS
 SELECT DISTINCT ON (c.id) c.id AS card_id,
    c.name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    c.tcgplayer_id,
    ps.tcgplayer_market,
    ps.tcgplayer_low,
    ps.ebay_sold_avg,
    ps.ebay_sold_low,
    ps.ebay_sold_high,
    ps.ebay_sold_count,
    ps.checked_at,
        CASE
            WHEN ((b.purchase_price IS NOT NULL) AND (b.pack_count > 0)) THEN round(((b.purchase_price / (b.pack_count)::numeric) / 15.0), 4)
            ELSE NULL::numeric
        END AS cost_basis,
    ps.tcgplayer_market AS tcg_market_price
   FROM ((((cards c
     LEFT JOIN pack_cards pc ON ((pc.card_id = c.id)))
     LEFT JOIN packs pk ON ((pk.id = pc.pack_id)))
     LEFT JOIN boxes b ON ((b.id = pk.box_id)))
     LEFT JOIN price_snapshots ps ON ((ps.card_id = c.id)))
  ORDER BY c.id, ps.checked_at DESC;

CREATE OR REPLACE VIEW public.v_active_alerts AS
 SELECT pa.id,
    pa.card_id,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    pa.alert_type,
    pa.old_price,
    pa.new_price,
    pa.pct_change,
    pa.message,
    pa.dismissed,
    pa.created_at
   FROM (price_alerts pa
     JOIN cards c ON ((c.id = pa.card_id)))
  WHERE ((pa.dismissed = false) AND (pa.alert_type = ANY (ARRAY['price_spike'::alert_type, 'price_drop'::alert_type])))
  ORDER BY pa.created_at DESC;

CREATE OR REPLACE VIEW public.v_box_pnl AS
 SELECT b.id,
    b.name,
    b.set_name,
    b.box_type,
    b.purchase_price,
    b.pack_count,
    b.pack_msrp,
    b.purchased_at,
    b.opened_at,
    b.seller,
    b.notes,
    b.game_id,
    count(DISTINCT pk.id) AS packs_opened,
    count(pc.id) AS cards_pulled,
    count(DISTINCT pc.card_id) AS distinct_cards_pulled,
    (COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + ((count(DISTINCT pk.id))::numeric * 1.00)) AS cards_market_value,
        CASE
            WHEN ((b.purchase_price IS NOT NULL) AND (b.pack_count > 0)) THEN round(((b.purchase_price / (b.pack_count)::numeric) / 15.0), 4)
            ELSE NULL::numeric
        END AS cost_per_card,
    ((COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + ((count(DISTINCT pk.id))::numeric * 1.00)) - COALESCE(b.purchase_price, (0)::numeric)) AS gross_pnl,
        CASE
            WHEN (COALESCE(b.purchase_price, (0)::numeric) > (0)::numeric) THEN round(((((COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + ((count(DISTINCT pk.id))::numeric * 1.00)) - b.purchase_price) / b.purchase_price) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS roi_pct
   FROM (((boxes b
     LEFT JOIN packs pk ON ((pk.box_id = b.id)))
     LEFT JOIN pack_cards pc ON ((pc.pack_id = pk.id)))
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = pc.card_id)))
  GROUP BY b.id, b.name, b.set_name, b.box_type, b.purchase_price, b.pack_count, b.pack_msrp, b.purchased_at, b.opened_at, b.seller, b.notes, b.game_id
  ORDER BY b.purchased_at DESC;

CREATE OR REPLACE VIEW public.v_ebay_active AS
 SELECT el.id,
    el.title,
    el.card_id,
    el.listed_price,
    el.shipping_cost,
    el.condition,
    el.notes,
    el.ebay_url,
    el.listed_at,
    el.status,
    el.cost_basis,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
    COALESCE(c.game_id, max(c2.game_id::text)::uuid) AS game_id,
    lp.tcgplayer_market AS tcg_market_price,
    string_agg((c2.name ||
        CASE
            WHEN (elc.quantity > 1) THEN (' ×'::text || elc.quantity)
            ELSE ''::text
        END), ', '::text ORDER BY c2.name) AS all_card_names,
    COALESCE(sum(elc.quantity), (0)::bigint) AS card_count
   FROM ((((ebay_listings el
     LEFT JOIN cards c ON ((c.id = el.card_id)))
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = el.card_id)))
     LEFT JOIN ebay_listing_cards elc ON ((elc.listing_id = el.id)))
     LEFT JOIN cards c2 ON ((c2.id = elc.card_id)))
  WHERE (el.status = 'active'::text)
  GROUP BY el.id, el.title, el.card_id, el.listed_price, el.shipping_cost, el.condition, el.notes, el.ebay_url, el.listed_at, el.status, el.cost_basis, c.name, c.set_name, c.rarity, c.foil, c.game_id, lp.tcgplayer_market;

CREATE OR REPLACE VIEW public.v_ebay_sold AS
 SELECT el.id,
    el.title,
    el.listed_price,
    el.shipping_cost,
    el.sold_price,
    el.sold_shipping,
    el.sold_ebay_fee,
    el.cost_basis,
    el.net_profit,
    el.sold_at,
    el.listed_at,
    el.condition,
    el.notes,
    el.ebay_url,
    el.card_id,
    (EXTRACT(day FROM (el.sold_at - el.listed_at)))::integer AS days_to_sell,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
    COALESCE(c.game_id, max(lc_cards.game_id::text)::uuid) AS game_id,
    COALESCE(string_agg(DISTINCT lc_cards.name, ', '::text ORDER BY lc_cards.name) FILTER (WHERE (lc_cards.name IS NOT NULL)), c.name) AS all_card_names,
    COALESCE(count(DISTINCT elc.card_id) FILTER (WHERE (elc.card_id IS NOT NULL)), (
        CASE
            WHEN (el.card_id IS NOT NULL) THEN 1
            ELSE 0
        END)::bigint) AS card_count
   FROM (((ebay_listings el
     LEFT JOIN cards c ON ((c.id = el.card_id)))
     LEFT JOIN ebay_listing_cards elc ON ((elc.listing_id = el.id)))
     LEFT JOIN cards lc_cards ON ((lc_cards.id = elc.card_id)))
  WHERE (el.status = 'sold'::text)
  GROUP BY el.id, el.title, el.listed_price, el.shipping_cost, el.sold_price, el.sold_shipping, el.sold_ebay_fee, el.cost_basis, el.net_profit, el.sold_at, el.listed_at, el.condition, el.notes, el.ebay_url, el.card_id, c.name, c.set_name, c.rarity, c.foil, c.game_id
  ORDER BY el.sold_at DESC;

CREATE OR REPLACE VIEW public.v_tcgplayer_active AS
 SELECT tl.id,
    tl.title,
    tl.card_id,
    tl.listed_price,
    tl.shipping_cost,
    tl.condition,
    tl.quantity,
    tl.notes,
    tl.tcgplayer_url,
    tl.listed_at,
    tl.status,
    tl.cost_basis,
    tl.tcg_fee,
    tl.net_listed,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
    COALESCE(c.game_id, max(c2.game_id::text)::uuid) AS game_id,
    lp.tcgplayer_market AS tcg_market_price,
    string_agg((c2.name ||
        CASE
            WHEN (tlc.quantity > 1) THEN (' ×'::text || tlc.quantity)
            ELSE ''::text
        END), ', '::text ORDER BY c2.name) AS all_card_names,
    COALESCE(sum(tlc.quantity), (0)::bigint) AS card_count
   FROM ((((tcgplayer_listings tl
     LEFT JOIN cards c ON ((c.id = tl.card_id)))
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = tl.card_id)))
     LEFT JOIN tcgplayer_listing_cards tlc ON ((tlc.listing_id = tl.id)))
     LEFT JOIN cards c2 ON ((c2.id = tlc.card_id)))
  WHERE (tl.status = 'active'::text)
  GROUP BY tl.id, tl.title, tl.card_id, tl.listed_price, tl.shipping_cost, tl.condition, tl.quantity, tl.notes, tl.tcgplayer_url, tl.listed_at, tl.status, tl.cost_basis, tl.tcg_fee, tl.net_listed, c.name, c.set_name, c.rarity, c.foil, c.game_id, lp.tcgplayer_market;

CREATE OR REPLACE VIEW public.v_tcgplayer_sold AS
 SELECT tl.id,
    tl.title,
    tl.listed_price,
    tl.shipping_cost,
    tl.quantity,
    tl.sold_price,
    tl.sold_shipping,
    tl.sold_fee,
    tl.cost_basis,
    tl.net_profit,
    tl.sold_at,
    tl.listed_at,
    tl.condition,
    tl.notes,
    tl.tcgplayer_url,
    tl.card_id,
    (EXTRACT(day FROM (tl.sold_at - tl.listed_at)))::integer AS days_to_sell,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
    COALESCE(c.game_id, max(lc_cards.game_id::text)::uuid) AS game_id,
    COALESCE(string_agg(DISTINCT lc_cards.name, ', '::text ORDER BY lc_cards.name) FILTER (WHERE (lc_cards.name IS NOT NULL)), c.name) AS all_card_names,
    COALESCE(count(DISTINCT tlc.card_id) FILTER (WHERE (tlc.card_id IS NOT NULL)), (
        CASE
            WHEN (tl.card_id IS NOT NULL) THEN 1
            ELSE 0
        END)::bigint) AS card_count
   FROM (((tcgplayer_listings tl
     LEFT JOIN cards c ON ((c.id = tl.card_id)))
     LEFT JOIN tcgplayer_listing_cards tlc ON ((tlc.listing_id = tl.id)))
     LEFT JOIN cards lc_cards ON ((lc_cards.id = tlc.card_id)))
  WHERE (tl.status = 'sold'::text)
  GROUP BY tl.id, tl.title, tl.listed_price, tl.shipping_cost, tl.quantity, tl.sold_price, tl.sold_shipping, tl.sold_fee, tl.cost_basis, tl.net_profit, tl.sold_at, tl.listed_at, tl.condition, tl.notes, tl.tcgplayer_url, tl.card_id, c.name, c.set_name, c.rarity, c.foil, c.game_id
  ORDER BY tl.sold_at DESC;

CREATE OR REPLACE VIEW public.v_inventory_dashboard AS
 SELECT DISTINCT ON (c.id) c.id,
    c.name,
    c.set_name,
    c.set_code,
    c.rarity,
    c.condition,
    c.foil,
    c.game_id,
    c.tcgplayer_id,
    c.image_url,
    c.notes,
    c.quantity_owned,
    c.quantity_listed,
    (c.quantity_owned - COALESCE(c.quantity_listed, 0)) AS quantity_available,
    c.created_at,
    c.updated_at,
    lp.tcgplayer_market,
    lp.tcgplayer_low,
    lp.ebay_sold_avg,
    lp.ebay_sold_low,
    lp.ebay_sold_high,
    lp.ebay_sold_count,
    lp.checked_at AS price_checked_at,
    lp.cost_basis,
    round((COALESCE(lp.tcgplayer_market, (0)::numeric) * (c.quantity_owned)::numeric), 2) AS market_value,
        CASE
            WHEN ((lp.tcgplayer_market IS NOT NULL) AND (lp.cost_basis IS NOT NULL)) THEN round((lp.tcgplayer_market - lp.cost_basis), 4)
            ELSE NULL::numeric
        END AS unrealized_pnl_per_card,
        CASE
            WHEN ((lp.tcgplayer_market IS NOT NULL) AND (lp.cost_basis IS NOT NULL)) THEN round(((lp.tcgplayer_market - lp.cost_basis) * (c.quantity_owned)::numeric), 2)
            ELSE NULL::numeric
        END AS unrealized_pnl,
    COALESCE(el.active_listing_count, (0)::bigint) AS active_listing_count,
    el.lowest_listed_price
   FROM ((cards c
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = c.id)))
     LEFT JOIN ( SELECT ebay_listings.card_id,
            count(*) AS active_listing_count,
            min(ebay_listings.listed_price) AS lowest_listed_price
           FROM ebay_listings
          WHERE (ebay_listings.status = 'active'::text)
          GROUP BY ebay_listings.card_id) el ON ((el.card_id = c.id)))
  ORDER BY c.id, c.name;

CREATE OR REPLACE VIEW public.v_listing_price_alerts AS
 WITH listing_prices AS (
         SELECT el_1.id AS listing_id,
            el_1.card_id,
            lp_1.tcgplayer_market,
            NULL::text AS card_breakdown
           FROM (ebay_listings el_1
             JOIN v_latest_prices lp_1 ON ((lp_1.card_id = el_1.card_id)))
          WHERE ((el_1.status = 'active'::text) AND (el_1.card_id IS NOT NULL))
        UNION ALL
         SELECT el_1.id AS listing_id,
            NULL::uuid AS card_id,
            sum((lp_1.tcgplayer_market * (COALESCE(elc.quantity, 1))::numeric)) AS tcgplayer_market,
            string_agg(((((c_1.name ||
                CASE
                    WHEN (elc.quantity > 1) THEN (' ×'::text || elc.quantity)
                    ELSE ''::text
                END) || ' ($'::text) || (round((lp_1.tcgplayer_market)::numeric, 2))::text) || ')'::text), ', '::text ORDER BY c_1.name) AS card_breakdown
           FROM (((ebay_listings el_1
             JOIN ebay_listing_cards elc ON ((elc.listing_id = el_1.id)))
             JOIN v_latest_prices lp_1 ON ((lp_1.card_id = elc.card_id)))
             JOIN cards c_1 ON ((c_1.id = elc.card_id)))
          WHERE ((el_1.status = 'active'::text) AND (el_1.card_id IS NULL))
          GROUP BY el_1.id
        )
 SELECT el.id AS listing_id,
    el.title,
    el.listed_price,
    el.shipping_cost,
    el.ebay_url,
    el.listed_at,
    el.card_id,
    lp.tcgplayer_market,
    lp.card_breakdown,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    c.tcgplayer_id,
    (el.listed_price - COALESCE(el.shipping_cost, 5.00)) AS net_after_shipping,
    ((el.listed_price - COALESCE(el.shipping_cost, 5.00)) - lp.tcgplayer_market) AS price_gap,
    round((((el.listed_price - COALESCE(el.shipping_cost, 5.00) - lp.tcgplayer_market) / NULLIF(lp.tcgplayer_market, (0)::numeric)) * (100)::numeric), 1) AS overpriced_pct,
        CASE
            WHEN ((el.listed_price - COALESCE(el.shipping_cost, 5.00)) > (lp.tcgplayer_market * 1.10)) THEN 'overpriced'::text
            WHEN ((el.listed_price - COALESCE(el.shipping_cost, 5.00)) < (lp.tcgplayer_market * 0.90)) THEN 'underpriced'::text
            ELSE NULL::text
        END AS alert_type
   FROM ((ebay_listings el
     JOIN listing_prices lp ON ((lp.listing_id = el.id)))
     LEFT JOIN cards c ON ((c.id = el.card_id)))
  WHERE ((el.status = 'active'::text) AND (lp.tcgplayer_market IS NOT NULL) AND (lp.tcgplayer_market > (0)::numeric) AND (abs(((el.listed_price - COALESCE(el.shipping_cost, 5.00) - lp.tcgplayer_market) / NULLIF(lp.tcgplayer_market, (0)::numeric))) > 0.10))
  ORDER BY (abs((el.listed_price - COALESCE(el.shipping_cost, 5.00) - lp.tcgplayer_market))) DESC;

CREATE OR REPLACE VIEW public.v_pack_pnl AS
 SELECT pk.id AS pack_id,
    pk.box_id,
    pk.pack_number,
    pk.opened_at,
    pk.notes,
    b.name AS box_name,
    b.set_name,
    b.purchase_price,
    b.pack_count,
    b.game_id,
        CASE
            WHEN ((b.purchase_price IS NOT NULL) AND (b.pack_count > 0)) THEN round((b.purchase_price / (b.pack_count)::numeric), 4)
            ELSE NULL::numeric
        END AS pack_cost,
    count(pc.id) AS cards_pulled,
    (COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + 1.00) AS market_value,
    ((COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + 1.00) -
        CASE
            WHEN ((b.purchase_price IS NOT NULL) AND (b.pack_count > 0)) THEN round((b.purchase_price / (b.pack_count)::numeric), 4)
            ELSE (0)::numeric
        END) AS pack_pnl
   FROM (((packs pk
     JOIN boxes b ON ((b.id = pk.box_id)))
     LEFT JOIN pack_cards pc ON ((pc.pack_id = pk.id)))
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = pc.card_id)))
  GROUP BY pk.id, pk.box_id, pk.pack_number, pk.opened_at, pk.notes, b.name, b.set_name, b.purchase_price, b.pack_count, b.game_id
  ORDER BY pk.opened_at DESC;

CREATE OR REPLACE VIEW public.v_price_gainers_losers AS
 WITH latest AS (
         SELECT DISTINCT ON (price_snapshots.card_id) price_snapshots.card_id,
            price_snapshots.tcgplayer_market,
            price_snapshots.checked_at
           FROM price_snapshots
          WHERE (price_snapshots.tcgplayer_market IS NOT NULL)
          ORDER BY price_snapshots.card_id, price_snapshots.checked_at DESC
        ), week_ago AS (
         SELECT DISTINCT ON (price_snapshots.card_id) price_snapshots.card_id,
            price_snapshots.tcgplayer_market AS price_7d_ago,
            price_snapshots.checked_at AS checked_at_7d
           FROM price_snapshots
          WHERE ((price_snapshots.tcgplayer_market IS NOT NULL) AND (price_snapshots.checked_at <= (now() - '3 days'::interval)))
          ORDER BY price_snapshots.card_id,
            CASE
              WHEN price_snapshots.checked_at <= (now() - '7 days'::interval) THEN 1
              WHEN price_snapshots.checked_at <= (now() - '5 days'::interval) THEN 2
              ELSE 3
            END ASC,
            price_snapshots.checked_at DESC
        )
 SELECT c.id AS card_id,
    c.name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    c.quantity_owned,
    l.tcgplayer_market AS current_price,
    w.price_7d_ago,
    (l.tcgplayer_market - w.price_7d_ago) AS price_change,
    round((((l.tcgplayer_market - w.price_7d_ago) / w.price_7d_ago) * (100)::numeric), 1) AS pct_change,
    w.checked_at_7d AS compared_from,
    l.checked_at AS last_checked
   FROM ((latest l
     JOIN week_ago w ON ((w.card_id = l.card_id)))
     JOIN cards c ON ((c.id = l.card_id)))
  WHERE ((w.price_7d_ago > (0)::numeric) AND (l.tcgplayer_market <> w.price_7d_ago) AND (abs(((l.tcgplayer_market - w.price_7d_ago) / w.price_7d_ago)) >= 0.05) AND (CASE WHEN l.tcgplayer_market > w.price_7d_ago THEN (l.tcgplayer_market - w.price_7d_ago) >= 0.10 ELSE (w.price_7d_ago - l.tcgplayer_market) >= 0.05 END))
  ORDER BY (abs(((l.tcgplayer_market - w.price_7d_ago) / w.price_7d_ago))) DESC;

CREATE OR REPLACE VIEW public.v_price_highs AS
 WITH all_time_high AS (
         SELECT price_snapshots.card_id,
            max(price_snapshots.tcgplayer_market) AS ath_price
           FROM price_snapshots
          WHERE (price_snapshots.tcgplayer_market IS NOT NULL)
          GROUP BY price_snapshots.card_id
        ), latest AS (
         SELECT DISTINCT ON (price_snapshots.card_id) price_snapshots.card_id,
            price_snapshots.tcgplayer_market,
            price_snapshots.checked_at
           FROM price_snapshots
          WHERE (price_snapshots.tcgplayer_market IS NOT NULL)
          ORDER BY price_snapshots.card_id, price_snapshots.checked_at DESC
        )
 SELECT c.id AS card_id,
    c.name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    c.quantity_owned,
    l.tcgplayer_market AS current_price,
    a.ath_price,
    round(((l.tcgplayer_market / a.ath_price) * (100)::numeric), 1) AS pct_of_ath,
    l.checked_at AS last_checked
   FROM ((latest l
     JOIN all_time_high a ON ((a.card_id = l.card_id)))
     JOIN cards c ON ((c.id = l.card_id)))
  WHERE ((l.tcgplayer_market >= (a.ath_price * 0.95)) AND (a.ath_price > 1.00))
  ORDER BY a.ath_price DESC;

CREATE OR REPLACE VIEW public.v_price_history AS
 SELECT ps.id,
    ps.card_id,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    ps.tcgplayer_market,
    ps.tcgplayer_low,
    ps.ebay_sold_avg,
    ps.ebay_sold_low,
    ps.ebay_sold_high,
    ps.ebay_sold_count,
    ps.checked_at
   FROM (price_snapshots ps
     JOIN cards c ON ((c.id = ps.card_id)))
  ORDER BY ps.card_id, ps.checked_at DESC;

CREATE OR REPLACE VIEW public.v_stale_listings AS
 SELECT el.id AS listing_id,
    el.title,
    el.listed_price,
    el.shipping_cost,
    el.ebay_url,
    el.listed_at,
    el.card_id,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    c.tcgplayer_id,
    lp.tcgplayer_market,
    (EXTRACT(day FROM (now() - el.listed_at)))::integer AS days_listed,
        CASE
            WHEN (lp.tcgplayer_market IS NOT NULL) THEN round((lp.tcgplayer_market * 0.95), 2)
            ELSE NULL::numeric
        END AS suggested_price
   FROM ((ebay_listings el
     LEFT JOIN cards c ON ((c.id = el.card_id)))
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = el.card_id)))
  WHERE ((el.status = 'active'::text) AND (el.listed_at < (now() - '30 days'::interval)))
  ORDER BY el.listed_at;

CREATE OR REPLACE VIEW public.v_unrealized_gain_alerts AS
 SELECT c.id AS card_id,
    c.name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    c.quantity_owned,
    lp.tcgplayer_market AS current_price,
    lp.cost_basis,
    (lp.tcgplayer_market - lp.cost_basis) AS gain_per_card,
    round((((lp.tcgplayer_market - lp.cost_basis) / lp.cost_basis) * (100)::numeric), 1) AS gain_pct,
    round(((lp.tcgplayer_market - lp.cost_basis) * (GREATEST(c.quantity_owned, 1))::numeric), 2) AS total_gain
   FROM (cards c
     JOIN v_latest_prices lp ON ((lp.card_id = c.id)))
  WHERE ((lp.tcgplayer_market IS NOT NULL) AND (lp.cost_basis IS NOT NULL) AND (lp.cost_basis > (0)::numeric) AND (lp.tcgplayer_market > (lp.cost_basis * 1.50)))
  ORDER BY (round((((lp.tcgplayer_market - lp.cost_basis) / lp.cost_basis) * (100)::numeric), 1)) DESC;

CREATE OR REPLACE VIEW public.v_youtube_opening_summary AS
 SELECT yo.id,
    yo.title,
    yo.youtube_url,
    yo.filmed_at,
    yo.notes,
    b.id AS box_id,
    COALESCE(b.name, b.set_name) AS box_name,
    b.set_name,
    b.pack_count,
    b.pack_msrp,
    b.purchase_price AS box_cost,
    b.game_id,
    count(DISTINCT yop.pack_id) AS packs_in_video,
    count(pc.id) AS cards_pulled,
    (COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + ((count(DISTINCT yop.pack_id))::numeric * 1.00)) AS total_tcg_value,
    (COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + ((count(DISTINCT yop.pack_id))::numeric * 1.00)) AS market_value,
    COALESCE(((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric)), (0)::numeric) AS packs_cost,
    ((COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + ((count(DISTINCT yop.pack_id))::numeric * 1.00)) - COALESCE(((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric)), (0)::numeric)) AS opening_pnl,
    max(lp.tcgplayer_market) AS best_card_value,
        CASE
            WHEN (((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric)) > (0)::numeric) THEN round(((((COALESCE(sum(lp.tcgplayer_market), (0)::numeric) + ((count(DISTINCT yop.pack_id))::numeric * 1.00)) - ((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric))) / ((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric))) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS roi_pct
   FROM (((((youtube_openings yo
     LEFT JOIN boxes b ON ((b.id = yo.box_id)))
     LEFT JOIN youtube_opening_packs yop ON ((yop.opening_id = yo.id)))
     LEFT JOIN packs pk ON ((pk.id = yop.pack_id)))
     LEFT JOIN pack_cards pc ON ((pc.pack_id = pk.id)))
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = pc.card_id)))
  GROUP BY yo.id, yo.title, yo.youtube_url, yo.filmed_at, yo.notes, b.id, b.name, b.set_name, b.pack_count, b.pack_msrp, b.purchase_price, b.game_id
  ORDER BY yo.filmed_at DESC;

-- ── Re-grant on every dropped-and-recreated view ───────────────────────
-- DROP VIEW ... CREATE VIEW makes a new object — any explicit grants the
-- old view had (like the ones the 20260706 migration gave v_tcgplayer_active
-- /v_tcgplayer_sold) do NOT carry over. Re-granting unconditionally here is
-- cheap insurance against silently losing anon/authenticated read access.

GRANT ALL ON TABLE public.v_active_alerts            TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_box_pnl                   TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_ebay_active               TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_ebay_sold                 TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_tcgplayer_active          TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_tcgplayer_sold            TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_inventory_dashboard       TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_latest_prices             TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_listing_price_alerts      TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_pack_pnl                  TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_price_gainers_losers      TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_price_highs               TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_price_history             TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_stale_listings            TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_unrealized_gain_alerts    TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_youtube_opening_summary   TO anon, authenticated, service_role;
