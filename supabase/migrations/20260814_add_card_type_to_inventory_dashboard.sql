-- v_inventory_dashboard never exposed cards.card_type, even though it's a real column
-- (see the note on the cards table in schema.sql). Listingsuggestions.jsx selects
-- card_type from this view to find each game's "pooled special" card type (e.g.
-- Sorcery's site cards) -- surfaced as "column v_inventory_dashboard.card_type does
-- not exist" when the page tried to load.
--
-- Postgres requires CREATE OR REPLACE VIEW to keep existing output columns in the
-- same order/position, so the new column is appended at the end of the SELECT list.
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
    el.lowest_listed_price,
    c.card_type
   FROM ((cards c
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = c.id)))
     LEFT JOIN ( SELECT ebay_listings.card_id,
            count(*) AS active_listing_count,
            min(ebay_listings.listed_price) AS lowest_listed_price
           FROM ebay_listings
          WHERE (ebay_listings.status = 'active'::text)
          GROUP BY ebay_listings.card_id) el ON ((el.card_id = c.id)))
  ORDER BY c.id, c.name;
