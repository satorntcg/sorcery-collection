-- v_ebay_active/v_ebay_sold/v_tcgplayer_active/v_tcgplayer_sold never exposed a
-- correct "how many physical cards does this listing represent" figure, even
-- though the app has always needed one and computes it client-side in several
-- places (e.g. Ebaylistings.jsx/Tcgplayerlistings.jsx quantity_owned/quantity_listed
-- adjustments: listingQty * (lc.quantity ?? 1) per junction row).
--
-- A listing's real physical count is el.quantity/tl.quantity (the "how many of
-- this identical bundle sold" multiplier entered in the Create/Edit modal) times
-- the sum of ebay_listing_cards.quantity/tcgplayer_listing_cards.quantity across
-- its junction rows (each card's per-lot count) -- or just the multiplier alone
-- for a listing tied directly to one card_id with no junction rows.
--
-- Neither existing column gave that: `quantity` on v_ebay_active/v_ebay_sold was
-- never selected at all (so `l.quantity` was always undefined -> the UI's `?? 1`
-- fallback silently showed "1" for every eBay listing regardless of its real
-- quantity or lot size), and `card_count` on every one of these views is a
-- COUNT(DISTINCT card_id) -- it undercounts whenever a junction row's own
-- `quantity` is > 1 (confirmed in production data: several TCGPlayer lots have
-- individual cards logged at quantity 2/3 within the lot). Discovered via the
-- new Sales.jsx page, which surfaced "cards sold" totals that didn't match the
-- underlying listings once multi-card lots were counted correctly.
--
-- Fix: add `total_quantity` = multiplier * COALESCE(sum(junction quantity), 1)
-- to all four views. Existing `quantity`/`card_count` columns are left as-is
-- (card_count is still correct for its one real use: "does this lot have more
-- than one distinct card, so the per-card breakdown should render").

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
    COALESCE(sum(elc.quantity), (0)::bigint) AS card_count,
    (el.quantity * COALESCE(sum(elc.quantity), 1)) AS total_quantity
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
        END)::bigint) AS card_count,
    (el.quantity * COALESCE(sum(elc.quantity), 1)) AS total_quantity
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
    COALESCE(sum(tlc.quantity), (0)::bigint) AS card_count,
    (tl.quantity * COALESCE(sum(tlc.quantity), 1)) AS total_quantity
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
        END)::bigint) AS card_count,
    (tl.quantity * COALESCE(sum(tlc.quantity), 1)) AS total_quantity
   FROM (((tcgplayer_listings tl
     LEFT JOIN cards c ON ((c.id = tl.card_id)))
     LEFT JOIN tcgplayer_listing_cards tlc ON ((tlc.listing_id = tl.id)))
     LEFT JOIN cards lc_cards ON ((lc_cards.id = tlc.card_id)))
  WHERE (tl.status = 'sold'::text)
  GROUP BY tl.id, tl.title, tl.listed_price, tl.shipping_cost, tl.quantity, tl.sold_price, tl.sold_shipping, tl.sold_fee, tl.cost_basis, tl.net_profit, tl.sold_at, tl.listed_at, tl.condition, tl.notes, tl.tcgplayer_url, tl.card_id, c.name, c.set_name, c.rarity, c.foil, c.game_id
  ORDER BY tl.sold_at DESC;
