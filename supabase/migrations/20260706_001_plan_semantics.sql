-- LifeOS Phase 2: plan + task semantics.
-- Blocks learn how movable they are; todos learn what they mean to the planner.
-- Commitments are todos (kind='commitment'); routines are recurring todos —
-- no separate tables needed for the context snapshot.

ALTER TABLE calendar_blocks
    ADD COLUMN IF NOT EXISTS flexibility text NOT NULL DEFAULT 'flexible'
    CHECK (flexibility IN ('fixed', 'flexible', 'protected'));

ALTER TABLE daily_plan_items
    ADD COLUMN IF NOT EXISTS flexibility text NOT NULL DEFAULT 'flexible'
    CHECK (flexibility IN ('fixed', 'flexible', 'protected'));

ALTER TABLE todos
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'flexible'
    CHECK (kind IN ('commitment', 'flexible', 'reminder', 'someday'));
