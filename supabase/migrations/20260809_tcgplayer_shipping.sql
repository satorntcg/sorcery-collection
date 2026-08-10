-- Add shipping cost tracking to TCGPlayer listings, mirroring ebay_listings.shipping_cost /
-- sold_shipping. Default is $5.00 (vs eBay's $0 default) per user request. net_listed is a
-- generated column and Postgres won't let us ALTER its expression in place, so it's dropped
-- and re-added with shipping subtracted.

-- Drop all three views up front (not just the ones net_listed cascades to) so every
-- CREATE below is a fresh CREATE VIEW — CREATE OR REPLACE VIEW only allows appending
-- columns at the end, and shipping_cost needs to slot in earlier than that.
DROP VIEW IF EXISTS public.v_tcgplayer_pnl;
DROP VIEW IF EXISTS public.v_tcgplayer_active;
DROP VIEW IF EXISTS public.v_tcgplayer_sold;

ALTER TABLE public.tcgplayer_listings ADD COLUMN shipping_cost numeric(10,2) DEFAULT 5.00 NOT NULL;
ALTER TABLE public.tcgplayer_listings ADD COLUMN sold_shipping numeric(10,2);

ALTER TABLE public.tcgplayer_listings DROP COLUMN net_listed;
ALTER TABLE public.tcgplayer_listings ADD COLUMN net_listed numeric(10,2) GENERATED ALWAYS AS (round(((listed_price - (listed_price * 0.1025)) - shipping_cost), 2)) STORED;

-- ── Recreate the views dropped above ─────────────────────────────────────

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
  GROUP BY tl.id, tl.title, tl.card_id, tl.listed_price, tl.shipping_cost, tl.condition, tl.quantity, tl.notes, tl.tcgplayer_url, tl.listed_at, tl.status, tl.cost_basis, tl.tcg_fee, tl.net_listed, c.name, c.set_name, c.rarity, c.foil, lp.tcgplayer_market;

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
  GROUP BY tl.id, tl.title, tl.listed_price, tl.shipping_cost, tl.quantity, tl.sold_price, tl.sold_shipping, tl.sold_fee, tl.cost_basis, tl.net_profit, tl.sold_at, tl.listed_at, tl.condition, tl.notes, tl.tcgplayer_url, tl.card_id, c.name, c.set_name, c.rarity, c.foil
  ORDER BY tl.sold_at DESC;

CREATE OR REPLACE VIEW public.v_tcgplayer_pnl AS
 SELECT COALESCE(sum(sold_price) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_revenue,
    COALESCE(sum(sold_fee) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_tcg_fees,
    COALESCE(sum(sold_shipping) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_shipping_paid,
    COALESCE(sum(cost_basis) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_cogs,
    COALESCE(sum(net_profit) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_net_profit,
    count(*) FILTER (WHERE (status = 'active'::text)) AS active_listings_count,
    COALESCE(sum(listed_price) FILTER (WHERE (status = 'active'::text)), (0)::numeric) AS active_listings_gmv,
    COALESCE(sum(net_listed) FILTER (WHERE (status = 'active'::text)), (0)::numeric) AS active_listings_net_if_sold,
    count(*) FILTER (WHERE (status = 'sold'::text)) AS total_sold,
    count(*) AS total_listings
   FROM tcgplayer_listings;

GRANT ALL ON TABLE public.v_tcgplayer_active TO anon;
GRANT ALL ON TABLE public.v_tcgplayer_active TO authenticated;
GRANT ALL ON TABLE public.v_tcgplayer_active TO service_role;
GRANT ALL ON TABLE public.v_tcgplayer_sold TO anon;
GRANT ALL ON TABLE public.v_tcgplayer_sold TO authenticated;
GRANT ALL ON TABLE public.v_tcgplayer_sold TO service_role;
GRANT ALL ON TABLE public.v_tcgplayer_pnl TO anon;
GRANT ALL ON TABLE public.v_tcgplayer_pnl TO authenticated;
GRANT ALL ON TABLE public.v_tcgplayer_pnl TO service_role;
