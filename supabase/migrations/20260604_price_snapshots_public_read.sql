-- Allow unauthenticated (public) users to read price history.
-- Price data is market information with no sensitivity concerns.
CREATE POLICY price_snapshots_public_read ON public.price_snapshots
  FOR SELECT USING (true);
