-- Data backfill, not a schema change. Root cause: Boxes.jsx's box-row "Mark
-- opened" button / "Opened" badge was keyed off (!opened_at && !packs_opened),
-- so as soon as a box had ANY pack logged, the row silently switched to showing
-- the green "Opened" badge -- even though boxes.opened_at itself was never set.
-- That permanently hid the only UI path to set it (the button no longer renders
-- once packs_opened > 0), so a box could have every pack logged, with pull data
-- fully recorded, and still be invisible to Box EV / Boxes P&L (both of which
-- filter on boxes.opened_at, not packs_opened) -- with no way to fix it from the
-- UI. Fixed in src/pages/Boxes.jsx (badge now checks opened_at only, and logging
-- a pull auto-sets opened_at if it's still null).
--
-- This backfills the 12 boxes already caught by it, using the first pack's
-- opened_at as the best available proxy for when the box was actually opened.
UPDATE public.boxes b
SET opened_at = sub.first_pack_opened_at
FROM (
  SELECT box_id, min(opened_at) AS first_pack_opened_at
  FROM public.packs
  GROUP BY box_id
) sub
WHERE b.id = sub.box_id
  AND b.opened_at IS NULL;
