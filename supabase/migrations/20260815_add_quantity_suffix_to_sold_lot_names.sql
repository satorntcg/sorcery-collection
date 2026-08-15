-- v_ebay_sold/v_tcgplayer_sold's `all_card_names` lists the cards in a sold lot
-- but, unlike v_ebay_active/v_tcgplayer_active, never appended each card's
-- quantity ("×N") -- so a sold lot with per-card quantities (e.g. Legion of
-- Gall ×2, Sphere of Animosity ×2, Toolbox ×3) showed as three bare names on
-- the Sold tab, with no way to see the 2/2/3 split without querying
-- ebay_listing_cards/tcgplayer_listing_cards directly. That split is exactly
-- what 20260815_fix_listing_total_quantity.sql's new `total_quantity` sums up,
-- so the Sold tab's per-listing total (Qty column) was fixed but the per-card
-- breakdown next to it stayed silently incomplete.
--
-- Fix: append the same ' ×N' suffix the active views already use, when a
-- card's lot quantity is > 1. Confirmed via a duplicate-row check
-- (no (listing_id, card_id) pair appears more than once in either junction
-- table in production) that dropping the `DISTINCT` used previously is safe
-- and lets ORDER BY reference the same display expression as the active
-- views do, rather than fighting Postgres's "ORDER BY must match the
-- DISTINCT argument" rule.

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
    COALESCE(string_agg((lc_cards.name ||
        CASE
            WHEN (elc.quantity > 1) THEN (' ×'::text || elc.quantity)
            ELSE ''::text
        END), ', '::text ORDER BY lc_cards.name) FILTER (WHERE (lc_cards.name IS NOT NULL)), c.name) AS all_card_names,
    COALESCE(count(DISTINCT elc.card_id) FILTER (WHERE (elc.card_id IS NOT NULL)), (
        CASE
            WHEN (el.card_id IS NOT NULL) THEN 1
            ELSE 0
        END)::bigint) AS card_count,
    (el.quantity * COALESCE(sum(elc.quantity), 1)) AS total_quantity
   FROM (((ebay_listings el
     LEFT JOIN cards c ON ((c.id = el.card_id)))
     LEFT JOIN ebay_listing_cards elc ON ((elc.listing_id = el.id)))
     LEFT JOIN cards lc_cards ON ((lc_cards.id = elc.card_id)))
  WHERE (el.status = 'sold'::text)
  GROUP BY el.id, el.title, el.listed_price, el.shipping_cost, el.sold_price, el.sold_shipping, el.sold_ebay_fee, el.cost_basis, el.net_profit, el.sold_at, el.listed_at, el.condition, el.notes, el.ebay_url, el.card_id, c.name, c.set_name, c.rarity, c.foil, c.game_id
  ORDER BY el.sold_at DESC;

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
    COALESCE(string_agg((lc_cards.name ||
        CASE
            WHEN (tlc.quantity > 1) THEN (' ×'::text || tlc.quantity)
            ELSE ''::text
        END), ', '::text ORDER BY lc_cards.name) FILTER (WHERE (lc_cards.name IS NOT NULL)), c.name) AS all_card_names,
    COALESCE(count(DISTINCT tlc.card_id) FILTER (WHERE (tlc.card_id IS NOT NULL)), (
        CASE
            WHEN (tl.card_id IS NOT NULL) THEN 1
            ELSE 0
        END)::bigint) AS card_count,
    (tl.quantity * COALESCE(sum(tlc.quantity), 1)) AS total_quantity
   FROM (((tcgplayer_listings tl
     LEFT JOIN cards c ON ((c.id = tl.card_id)))
     LEFT JOIN tcgplayer_listing_cards tlc ON ((tlc.listing_id = tl.id)))
     LEFT JOIN cards lc_cards ON ((lc_cards.id = tlc.card_id)))
  WHERE (tl.status = 'sold'::text)
  GROUP BY tl.id, tl.title, tl.listed_price, tl.shipping_cost, tl.quantity, tl.sold_price, tl.sold_shipping, tl.sold_fee, tl.cost_basis, tl.net_profit, tl.sold_at, tl.listed_at, tl.condition, tl.notes, tl.tcgplayer_url, tl.card_id, c.name, c.set_name, c.rarity, c.foil, c.game_id
  ORDER BY tl.sold_at DESC;
