-- Category "kind": separate essential (have-to) time from discretionary (chose-to)
-- time so Insights rankings aren't permanently dominated by sleep/food/bath/commute.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'discretionary'
  CHECK (kind IN ('essential', 'discretionary'));

-- Seed existing categories by a name heuristic; everything else stays discretionary.
UPDATE categories
SET kind = 'essential'
WHERE deleted_at IS NULL
  AND lower(name) ~ '(sleep|nap|food|meal|lunch|breakfast|brunch|dinner|snack|bath|shower|skincare|groom|commute|drive|travel|call|chore|errand)';
