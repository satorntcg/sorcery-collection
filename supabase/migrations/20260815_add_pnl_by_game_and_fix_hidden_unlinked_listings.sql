-- Two related game_id problems on the eBay/TCGPlayer listing pages:
--
-- 1) v_ebay_active/v_ebay_sold/v_tcgplayer_active/v_tcgplayer_sold compute
--    game_id as COALESCE(linked card's game_id, linked lot cards' game_id) --
--    it's NULL for any listing that was never linked to a card (no card_id,
--    no junction rows). Ebaylistings.jsx/Tcgplayerlistings.jsx/Sales.jsx all
--    query these views with `.eq('game_id', activeGame.id)`, and NULL never
--    equals anything in SQL, so every unlinked listing silently vanished --
--    not just from P&L totals, from the Active/Sold tables themselves. In
--    production this hid 59 of 100 sold eBay listings and made the
--    "Show Unlinked Cards" toggle dead (the rows it's meant to surface never
--    reached the client to begin with). Fixed app-side: those queries now
--    match `game_id = <active game> OR game_id IS NULL`, so unlinked
--    listings stay visible under every game until they're linked.
--
-- 2) v_global_pnl/v_tcgplayer_pnl (the "Total revenue"/"Net profit"/Business
--    P&L numbers on these two pages) aggregate the *entire* ebay_listings/
--    tcgplayer_listings tables with no game_id at all, so those numbers
--    never changed when switching games. That's intentional for
--    v_combined_pnl's use on the Dashboard (whole-account "Business net
--    profit"), so v_global_pnl/v_tcgplayer_pnl are left as-is. These two new
--    views give Ebaylistings.jsx/Tcgplayerlistings.jsx a proper per-game
--    equivalent instead, using the same COALESCE game_id derivation as the
--    active/sold views. A listing with no linkable card_id/lot cards has no
--    game to attribute revenue to, so (per point 1) it's visible everywhere
--    but only counted here once it's linked.

CREATE OR REPLACE VIEW public.v_ebay_pnl_by_game AS
 WITH listing_game AS (
   SELECT el.id,
      el.status,
      el.sold_price,
      el.sold_ebay_fee,
      el.sold_shipping,
      el.cost_basis,
      el.net_profit,
      el.listed_price,
      el.net_listed,
      COALESCE(c.game_id, max(c2.game_id::text)::uuid) AS game_id
     FROM (((ebay_listings el
       LEFT JOIN cards c ON ((c.id = el.card_id)))
       LEFT JOIN ebay_listing_cards elc ON ((elc.listing_id = el.id)))
       LEFT JOIN cards c2 ON ((c2.id = elc.card_id)))
    GROUP BY el.id, el.status, el.sold_price, el.sold_ebay_fee, el.sold_shipping, el.cost_basis, el.net_profit, el.listed_price, el.net_listed, c.game_id
 )
 SELECT game_id,
    COALESCE(sum(sold_price) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_revenue,
    COALESCE(sum(sold_ebay_fee) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_ebay_fees,
    COALESCE(sum(sold_shipping) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_shipping_paid,
    COALESCE(sum(cost_basis) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_cogs,
    COALESCE(sum(net_profit) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_net_profit,
    count(*) FILTER (WHERE (status = 'active'::text)) AS active_listings_count,
    COALESCE(sum(listed_price) FILTER (WHERE (status = 'active'::text)), (0)::numeric) AS active_listings_gmv,
    COALESCE(sum(net_listed) FILTER (WHERE (status = 'active'::text)), (0)::numeric) AS active_listings_net_if_sold,
    count(*) FILTER (WHERE (status = 'sold'::text)) AS total_sold,
    count(*) AS total_listings
   FROM listing_game
  WHERE (game_id IS NOT NULL)
  GROUP BY game_id;

CREATE OR REPLACE VIEW public.v_tcgplayer_pnl_by_game AS
 WITH listing_game AS (
   SELECT tl.id,
      tl.status,
      tl.sold_price,
      tl.sold_fee,
      tl.sold_shipping,
      tl.cost_basis,
      tl.net_profit,
      tl.listed_price,
      tl.net_listed,
      COALESCE(c.game_id, max(c2.game_id::text)::uuid) AS game_id
     FROM (((tcgplayer_listings tl
       LEFT JOIN cards c ON ((c.id = tl.card_id)))
       LEFT JOIN tcgplayer_listing_cards tlc ON ((tlc.listing_id = tl.id)))
       LEFT JOIN cards c2 ON ((c2.id = tlc.card_id)))
    GROUP BY tl.id, tl.status, tl.sold_price, tl.sold_fee, tl.sold_shipping, tl.cost_basis, tl.net_profit, tl.listed_price, tl.net_listed, c.game_id
 )
 SELECT game_id,
    COALESCE(sum(sold_price) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_revenue,
    COALESCE(sum(sold_fee) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_tcg_fees,
    COALESCE(sum(sold_shipping) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_shipping_paid,
    COALESCE(sum(cost_basis) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_cogs,
    COALESCE(sum(net_profit) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_net_profit,
    count(*) FILTER (WHERE (status = 'active'::text)) AS active_listings_count,
    COALESCE(sum(listed_price) FILTER (WHERE (status = 'active'::text)), (0)::numeric) AS active_listings_gmv,
    COALESCE(sum(net_listed) FILTER (WHERE (status = 'active'::text)), (0)::numeric) AS active_listings_net_if_sold,
    count(*) FILTER (WHERE (status = 'sold'::text)) AS total_sold,
    count(*) AS total_listings
   FROM listing_game
  WHERE (game_id IS NOT NULL)
  GROUP BY game_id;
