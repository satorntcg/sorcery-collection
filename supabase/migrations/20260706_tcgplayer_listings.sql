-- TCGPlayer as a dedicated listing channel, mirroring ebay_listings/ebay_listing_cards.
-- Fee model: 10.25% TCGPlayer marketplace commission only (no shipping/payment-processing
-- fee tracked — TCGPlayer sellers typically fold shipping into the listed price).
-- quantity_listed / quantity_owned on `cards` are shared with eBay listings (same columns),
-- so selling a TCGPlayer listing removes the cards from inventory the same way eBay sales do.

CREATE TABLE public.tcgplayer_listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    card_id uuid REFERENCES public.cards(id) ON DELETE SET NULL,
    title text NOT NULL,
    listed_price numeric(10,2) NOT NULL,
    condition text DEFAULT 'Near Mint'::text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    listed_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    tcgplayer_url text,
    tcg_fee numeric(10,2) GENERATED ALWAYS AS (round((listed_price * 0.1025), 2)) STORED,
    net_listed numeric(10,2) GENERATED ALWAYS AS (round((listed_price - (listed_price * 0.1025)), 2)) STORED,
    status text DEFAULT 'active'::text NOT NULL,
    sold_price numeric(10,2),
    sold_fee numeric(10,2),
    sold_at timestamp with time zone,
    net_profit numeric(10,2),
    cost_basis numeric(10,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tcgplayer_listings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'sold'::text])))
);

ALTER TABLE public.tcgplayer_listings OWNER TO postgres;

CREATE TABLE public.tcgplayer_listing_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    listing_id uuid NOT NULL REFERENCES public.tcgplayer_listings(id) ON DELETE CASCADE,
    card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
    price numeric(10,2),
    quantity integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.tcgplayer_listing_cards OWNER TO postgres;

CREATE INDEX tcgplayer_listings_card_id_idx ON public.tcgplayer_listings USING btree (card_id);
CREATE INDEX tcgplayer_listings_status_idx ON public.tcgplayer_listings USING btree (status);
CREATE INDEX tcgplayer_listings_listed_at_idx ON public.tcgplayer_listings USING btree (listed_at DESC);
CREATE INDEX tcgplayer_listings_sold_at_idx ON public.tcgplayer_listings USING btree (sold_at DESC);
CREATE INDEX tcgplayer_listing_cards_listing_id_idx ON public.tcgplayer_listing_cards USING btree (listing_id);
CREATE INDEX tcgplayer_listing_cards_card_id_idx ON public.tcgplayer_listing_cards USING btree (card_id);

-- Reuses the existing generic set_updated_at() trigger function (already used by
-- cards / check_schedule) rather than defining a per-table copy.
CREATE TRIGGER trg_tcgplayer_listings_updated_at BEFORE UPDATE ON public.tcgplayer_listings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tcgplayer_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgplayer_listing_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_only ON public.tcgplayer_listings USING ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_only ON public.tcgplayer_listing_cards USING ((auth.role() = 'authenticated'::text));

GRANT ALL ON TABLE public.tcgplayer_listings TO anon;
GRANT ALL ON TABLE public.tcgplayer_listings TO authenticated;
GRANT ALL ON TABLE public.tcgplayer_listings TO service_role;
GRANT ALL ON TABLE public.tcgplayer_listing_cards TO anon;
GRANT ALL ON TABLE public.tcgplayer_listing_cards TO authenticated;
GRANT ALL ON TABLE public.tcgplayer_listing_cards TO service_role;

-- ── Views ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_tcgplayer_active AS
 SELECT tl.id,
    tl.title,
    tl.card_id,
    tl.listed_price,
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
  GROUP BY tl.id, tl.title, tl.card_id, tl.listed_price, tl.condition, tl.quantity, tl.notes, tl.tcgplayer_url, tl.listed_at, tl.status, tl.cost_basis, tl.tcg_fee, tl.net_listed, c.name, c.set_name, c.rarity, c.foil, lp.tcgplayer_market;

CREATE OR REPLACE VIEW public.v_tcgplayer_sold AS
 SELECT tl.id,
    tl.title,
    tl.listed_price,
    tl.quantity,
    tl.sold_price,
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
  GROUP BY tl.id, tl.title, tl.listed_price, tl.quantity, tl.sold_price, tl.sold_fee, tl.cost_basis, tl.net_profit, tl.sold_at, tl.listed_at, tl.condition, tl.notes, tl.tcgplayer_url, tl.card_id, c.name, c.set_name, c.rarity, c.foil
  ORDER BY tl.sold_at DESC;

CREATE OR REPLACE VIEW public.v_tcgplayer_pnl AS
 SELECT COALESCE(sum(sold_price) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_revenue,
    COALESCE(sum(sold_fee) FILTER (WHERE (status = 'sold'::text)), (0)::numeric) AS total_tcg_fees,
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
