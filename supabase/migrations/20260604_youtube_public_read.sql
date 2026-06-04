-- Allow unauthenticated users to read YouTube opening data for the public videos page.
CREATE POLICY youtube_openings_public_read ON public.youtube_openings
  FOR SELECT USING (true);

CREATE POLICY youtube_opening_packs_public_read ON public.youtube_opening_packs
  FOR SELECT USING (true);
