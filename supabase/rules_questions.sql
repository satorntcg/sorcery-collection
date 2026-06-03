-- FAQ tracking + answer caching for RulesChat
-- Run this in the Supabase SQL editor once.

CREATE TABLE IF NOT EXISTS public.rules_questions (
  id            BIGSERIAL   PRIMARY KEY,
  question      TEXT        NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'sorcery',
  count         INT         NOT NULL DEFAULT 1,
  last_asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cached_answer TEXT,
  cached_at     TIMESTAMPTZ,
  UNIQUE (question, source)
);

-- Add cache columns if the table was created before this migration.
ALTER TABLE public.rules_questions
  ADD COLUMN IF NOT EXISTS cached_answer TEXT,
  ADD COLUMN IF NOT EXISTS cached_at     TIMESTAMPTZ;

-- Atomic upsert-and-increment. Stores the answer on first call;
-- subsequent calls increment count without overwriting the cached answer.
CREATE OR REPLACE FUNCTION public.log_rules_question(q TEXT, src TEXT, answer TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.rules_questions (question, source, count, last_asked_at, cached_answer, cached_at)
  VALUES (q, src, 1, NOW(), answer, CASE WHEN answer IS NOT NULL THEN NOW() ELSE NULL END)
  ON CONFLICT (question, source)
  DO UPDATE SET
    count         = rules_questions.count + 1,
    last_asked_at = NOW(),
    cached_answer = COALESCE(answer, rules_questions.cached_answer),
    cached_at     = CASE WHEN answer IS NOT NULL THEN NOW() ELSE rules_questions.cached_at END;
END;
$$;

-- RLS: allow anyone to read (for the FAQ display and cache lookup).
ALTER TABLE public.rules_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow public read"
  ON public.rules_questions FOR SELECT
  USING (true);

-- The RPC runs as SECURITY DEFINER (owner), so it bypasses RLS for writes.
-- No INSERT/UPDATE policy needed on the table itself.
