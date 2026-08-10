-- Cross-channel P&L view. v_global_pnl (eBay) and v_tcgplayer_pnl (TCGPlayer) were each
-- being netted against the *full* box spend independently on their own listings pages,
-- which double-counted: a card sold on TCGPlayer still counted as "unsold inventory" on
-- the eBay page's business-profit math, and vice versa. Combine both channels' revenue/
-- fees/COGS here so "business profit" (revenue − fees − box costs) can be computed once,
-- against combined COGS, instead of once per channel.
--
-- Both source views are unaggregated single-row queries (no GROUP BY), so the cross join
-- below always yields exactly one row.

CREATE OR REPLACE VIEW public.v_combined_pnl AS
 SELECT
    (eb.total_revenue + tc.total_revenue) AS total_revenue,
    eb.total_ebay_fees,
    tc.total_tcg_fees,
    (eb.total_ebay_fees + tc.total_tcg_fees) AS total_fees,
    (eb.total_shipping_paid + tc.total_shipping_paid) AS total_shipping_paid,
    (eb.total_cogs + tc.total_cogs) AS total_cogs,
    (eb.total_net_profit + tc.total_net_profit) AS total_net_profit,
    (eb.active_listings_count + tc.active_listings_count) AS active_listings_count,
    (eb.active_listings_gmv + tc.active_listings_gmv) AS active_listings_gmv,
    (eb.active_listings_net_if_sold + tc.active_listings_net_if_sold) AS active_listings_net_if_sold,
    (eb.total_sold + tc.total_sold) AS total_sold,
    (eb.total_listings + tc.total_listings) AS total_listings
   FROM public.v_global_pnl eb, public.v_tcgplayer_pnl tc;

GRANT ALL ON TABLE public.v_combined_pnl TO anon;
GRANT ALL ON TABLE public.v_combined_pnl TO authenticated;
GRANT ALL ON TABLE public.v_combined_pnl TO service_role;
