-- Found while auditing Box EV: v_box_pnl, v_pack_pnl, and v_youtube_opening_summary
-- all compute a pack/box's card value as sum(lp.tcgplayer_market) across its
-- pack_cards rows, without multiplying by pack_cards.quantity. Boxes.jsx actively
-- lets you record more than one copy of the same card in a single pack
-- (pull-quantity stepper -> pack_cards upsert with quantity > 1), so any pack with
-- a duplicate pull has its market value, P&L, ROI, and "cards pulled" count
-- silently undercounted in these views. BoxEV.jsx's own client-side pull-rate
-- breakdown and best-pack calculations already multiply by quantity correctly,
-- which is what exposed the mismatch against the view-sourced headline totals.
--
-- Fix: multiply each card's market price by its pack_cards.quantity before
-- summing, and sum(quantity) instead of count(*) for "cards pulled" counts.

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
    COALESCE(sum(pc.quantity), (0)::bigint) AS cards_pulled,
    count(DISTINCT pc.card_id) AS distinct_cards_pulled,
    (COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + ((count(DISTINCT pk.id))::numeric * 1.00)) AS cards_market_value,
        CASE
            WHEN ((b.purchase_price IS NOT NULL) AND (b.pack_count > 0)) THEN round(((b.purchase_price / (b.pack_count)::numeric) / 15.0), 4)
            ELSE NULL::numeric
        END AS cost_per_card,
    ((COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + ((count(DISTINCT pk.id))::numeric * 1.00)) - COALESCE(b.purchase_price, (0)::numeric)) AS gross_pnl,
        CASE
            WHEN (COALESCE(b.purchase_price, (0)::numeric) > (0)::numeric) THEN round(((((COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + ((count(DISTINCT pk.id))::numeric * 1.00)) - b.purchase_price) / b.purchase_price) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS roi_pct
   FROM (((boxes b
     LEFT JOIN packs pk ON ((pk.box_id = b.id)))
     LEFT JOIN pack_cards pc ON ((pc.pack_id = pk.id)))
     LEFT JOIN v_latest_prices lp ON ((lp.card_id = pc.card_id)))
  GROUP BY b.id, b.name, b.set_name, b.box_type, b.purchase_price, b.pack_count, b.pack_msrp, b.purchased_at, b.opened_at, b.seller, b.notes, b.game_id
  ORDER BY b.purchased_at DESC;

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
    COALESCE(sum(pc.quantity), (0)::bigint) AS cards_pulled,
    (COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + 1.00) AS market_value,
    ((COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + 1.00) -
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
    COALESCE(sum(pc.quantity), (0)::bigint) AS cards_pulled,
    (COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + ((count(DISTINCT yop.pack_id))::numeric * 1.00)) AS total_tcg_value,
    (COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + ((count(DISTINCT yop.pack_id))::numeric * 1.00)) AS market_value,
    COALESCE(((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric)), (0)::numeric) AS packs_cost,
    ((COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + ((count(DISTINCT yop.pack_id))::numeric * 1.00)) - COALESCE(((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric)), (0)::numeric)) AS opening_pnl,
    max(lp.tcgplayer_market) AS best_card_value,
        CASE
            WHEN (((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric)) > (0)::numeric) THEN round(((((COALESCE(sum((lp.tcgplayer_market * pc.quantity)), (0)::numeric) + ((count(DISTINCT yop.pack_id))::numeric * 1.00)) - ((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric))) / ((count(DISTINCT yop.pack_id))::numeric * COALESCE(b.pack_msrp, (5)::numeric))) * (100)::numeric), 1)
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
