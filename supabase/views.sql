-- View definitions for sorcery-tcg-app
-- NOTE: public pages (/, /cards, /cards/:id) use the anon key and need SELECT policies
-- on the `cards` and `price_snapshots` tables (or on this view via a SECURITY DEFINER function).
-- Quick fix — run once in the SQL editor if not already present:
--   ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "public read" ON public.cards FOR SELECT USING (true);
--   ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "public read" ON public.price_snapshots FOR SELECT USING (true);
-- Run each CREATE OR REPLACE VIEW in the Supabase SQL editor to update.

CREATE OR REPLACE VIEW public.v_active_alerts AS
 SELECT pa.id,
    pa.card_id,
    c.name AS card_name,
    c.set_name,
    c.rarity,
    c.foil,
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
  GROUP BY b.id, b.name, b.set_name, b.box_type, b.purchase_price, b.pack_count, b.pack_msrp, b.purchased_at, b.opened_at, b.seller, b.notes
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
  GROUP BY el.id, el.title, el.card_id, el.listed_price, el.shipping_cost, el.condition, el.notes, el.ebay_url, el.listed_at, el.status, el.cost_basis, c.name, c.set_name, c.rarity, c.foil, lp.tcgplayer_market;

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
  GROUP BY el.id, el.title, el.listed_price, el.shipping_cost, el.sold_price, el.sold_shipping, el.sold_ebay_fee, el.cost_basis, el.net_profit, el.sold_at, el.listed_at, el.condition, el.notes, el.ebay_url, el.card_id, c.name, c.set_name, c.rarity, c.foil
  ORDER BY el.sold_at DESC;

CREATE OR REPLACE VIEW public.v_global_pnl AS
 SELECT COALESCE(sum(sold_price) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_revenue,
    COALESCE(sum(sold_ebay_fee) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_ebay_fees,
    COALESCE(sum(sold_shipping) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_shipping_paid,
    COALESCE(sum(cost_basis) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_cogs,
    COALESCE(sum(net_profit) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_net_profit,
    count(*) FILTER (WHERE (status = 'active'::text)) AS active_listings_count,
    COALESCE(sum(listed_price) FILTER (WHERE (status = 'active'::text)), (0)::numeric) AS active_listings_gmv,
    COALESCE(sum(net_listed) FILTER (WHERE (status = 'active'::text)), (0)::numeric) AS active_listings_net_if_sold,
    count(*) FILTER (WHERE (status = 'sold'::text)) AS total_sold,
    count(*) AS total_listings
   FROM ebay_listings;

CREATE OR REPLACE VIEW public.v_inventory_dashboard AS
 SELECT DISTINCT ON (c.id) c.id,
    c.name,
    c.set_name,
    c.set_code,
    c.rarity,
    c.condition,
    c.foil,
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

CREATE OR REPLACE VIEW public.v_latest_prices AS
 SELECT DISTINCT ON (c.id) c.id AS card_id,
    c.name,
    c.set_name,
    c.rarity,
    c.foil,
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

-- Gap is calculated on (listed_price - shipping_cost) vs tcgplayer_market so that
-- the $5 shipping charge is not counted against the card price comparison.
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
  GROUP BY pk.id, pk.box_id, pk.pack_number, pk.opened_at, pk.notes, b.name, b.set_name, b.purchase_price, b.pack_count
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
  GROUP BY yo.id, yo.title, yo.youtube_url, yo.filmed_at, yo.notes, b.id, b.name, b.set_name, b.pack_count, b.pack_msrp, b.purchase_price
  ORDER BY yo.filmed_at DESC;
