-- TCGplayer order capture (Phase 1 of the Gmail-based order sync — TCGplayer's API
-- program is closed to new access, so orders are parsed from sale-notification emails
-- instead). Tables were already created directly via the SQL editor and are live/populated;
-- this migration brings them under version control without disrupting existing data.
--
-- card_name_raw is matched verbatim against cards.name, including a literal " (Foil)"
-- suffix for foil printings (foil printings are their own row in `cards`, not a
-- boolean-only distinction) — do not strip "(Foil)" before matching.

CREATE TABLE IF NOT EXISTS public.tcgplayer_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    order_number text NOT NULL,
    order_total numeric(10,2),
    ship_by date,
    status text DEFAULT 'new'::text NOT NULL,
    gmail_message_id text,
    manage_order_url text,
    ordered_at timestamp with time zone,
    shipped_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tcgplayer_orders_order_number_key UNIQUE (order_number),
    CONSTRAINT tcgplayer_orders_status_check CHECK ((status = ANY (ARRAY['new'::text, 'shipped'::text])))
);

ALTER TABLE public.tcgplayer_orders OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.tcgplayer_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    order_id uuid REFERENCES public.tcgplayer_orders(id) ON DELETE CASCADE,
    card_id uuid REFERENCES public.cards(id) ON DELETE SET NULL,
    card_name_raw text NOT NULL,
    condition text,
    foil boolean DEFAULT false NOT NULL,
    quantity integer DEFAULT 1 NOT NULL
);

ALTER TABLE public.tcgplayer_order_items OWNER TO postgres;

CREATE INDEX IF NOT EXISTS tcgplayer_order_items_order_id_idx ON public.tcgplayer_order_items USING btree (order_id);
CREATE INDEX IF NOT EXISTS tcgplayer_orders_status_idx ON public.tcgplayer_orders USING btree (status);

ALTER TABLE public.tcgplayer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgplayer_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_only ON public.tcgplayer_orders USING ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_only ON public.tcgplayer_order_items USING ((auth.role() = 'authenticated'::text));

GRANT ALL ON TABLE public.tcgplayer_orders TO anon;
GRANT ALL ON TABLE public.tcgplayer_orders TO authenticated;
GRANT ALL ON TABLE public.tcgplayer_orders TO service_role;
GRANT ALL ON TABLE public.tcgplayer_order_items TO anon;
GRANT ALL ON TABLE public.tcgplayer_order_items TO authenticated;
GRANT ALL ON TABLE public.tcgplayer_order_items TO service_role;
