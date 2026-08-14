-- Fix two cost-basis correctness bugs found while reviewing TCGPlayer/eBay P&L:
--
-- 1. v_latest_prices.cost_basis previously ignored cards.cost_basis (the
--    manually-entered value used for cards not linked to a tracked box) --
--    it only ever computed box.purchase_price / pack_count / 15. Any card
--    added standalone with a manual cost basis silently showed/used a NULL
--    cost basis everywhere (Inventory dashboard, unrealized P&L, listing
--    creation previews, Listing Suggestions).
-- 2. The old view joined pack_cards/packs/boxes inline with price_snapshots
--    in a single FROM clause, which cross-multiplies rows before the
--    DISTINCT ON collapses them -- for a card pulled across multiple boxes,
--    this picked one arbitrary box's per-card cost rather than a
--    quantity-weighted average across all of them.
--
-- Also: cost_basis is no longer captured on ebay_listings/tcgplayer_listings
-- at listing-creation time (see Ebaylistings.jsx / Tcgplayerlistings.jsx /
-- Listingsuggestions.jsx) -- it's computed live from linked cards for the
-- "est. profit" preview and only frozen into the row once a listing is
-- actually marked sold, so it keeps reading this view for an accurate,
-- current number right up until the sale.

CREATE OR REPLACE VIEW public.v_latest_prices AS
 WITH latest_snapshot AS (
         SELECT DISTINCT ON (ps.card_id) ps.card_id,
            ps.tcgplayer_market,
            ps.tcgplayer_low,
            ps.ebay_sold_avg,
            ps.ebay_sold_low,
            ps.ebay_sold_high,
            ps.ebay_sold_count,
            ps.checked_at
           FROM price_snapshots ps
          ORDER BY ps.card_id, ps.checked_at DESC
        ), box_cost AS (
         SELECT pc.card_id,
            round((sum((b.purchase_price / (b.pack_count)::numeric / 15.0) * (pc.quantity)::numeric) / sum(pc.quantity)), 4) AS avg_cost_basis
           FROM ((pack_cards pc
             JOIN packs pk ON ((pk.id = pc.pack_id)))
             JOIN boxes b ON ((b.id = pk.box_id)))
          WHERE ((b.purchase_price IS NOT NULL) AND (b.pack_count > 0))
          GROUP BY pc.card_id
        )
 SELECT c.id AS card_id,
    c.name,
    c.set_name,
    c.rarity,
    c.foil,
    c.game_id,
    c.tcgplayer_id,
    ls.tcgplayer_market,
    ls.tcgplayer_low,
    ls.ebay_sold_avg,
    ls.ebay_sold_low,
    ls.ebay_sold_high,
    ls.ebay_sold_count,
    ls.checked_at,
    COALESCE(bc.avg_cost_basis, c.cost_basis) AS cost_basis,
    ls.tcgplayer_market AS tcg_market_price
   FROM ((cards c
     LEFT JOIN latest_snapshot ls ON ((ls.card_id = c.id)))
     LEFT JOIN box_cost bc ON ((bc.card_id = c.id)));
