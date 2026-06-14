-- LifeOS: Daily planning foundation (BUG/OBJECTIVE #7)
--
-- Extensible architecture for custom + AI-generated day plans. A `daily_plan`
-- holds the provenance of a day's plan (manual / ai / template) and owns a set
-- of `daily_plan_items` (the proposed blocks). Items can be materialized into
-- existing `calendar_blocks` (the live "plan" view) via `calendar_block_id`.
--
-- AI integration (e.g. Claude.ai) is forward-compatible: `source='ai'` plans
-- carry `prompt`, `model`, and free-form `generation_meta` (jsonb) so a future
-- generation pipeline can record exactly how a schedule was produced without a
-- schema change. No UI is wired yet — this is the data + RLS foundation only.

-- ============================================================
-- DAILY PLANS — one plan per (user, date, intent)
-- ============================================================
CREATE TABLE daily_plans (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date             date NOT NULL,
    source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'template')),
    status           text NOT NULL DEFAULT 'draft'  CHECK (status IN ('draft', 'active', 'archived')),
    title            text,
    -- Generation provenance (null for hand-built plans)
    prompt           text,
    model            text,
    generation_meta  jsonb NOT NULL DEFAULT '{}'::jsonb,
    generated_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz
);

-- At most one ACTIVE plan per day; drafts/archived may coexist.
CREATE UNIQUE INDEX uniq_active_daily_plan
    ON daily_plans (user_id, date)
    WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX idx_daily_plans_day ON daily_plans (user_id, date) WHERE deleted_at IS NULL;

ALTER TABLE daily_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own daily plans"
    ON daily_plans FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- DAILY PLAN ITEMS — proposed blocks within a plan
-- ============================================================
CREATE TABLE daily_plan_items (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id            uuid NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
    category_id        uuid REFERENCES categories(id),  -- nullable: AI may propose before mapping
    title              text NOT NULL,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz NOT NULL,
    tags               text[] NOT NULL DEFAULT '{}',
    notes              text,
    sort_order         int NOT NULL DEFAULT 0,
    -- set once the item is committed to the live plan view
    calendar_block_id  uuid REFERENCES calendar_blocks(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,

    CONSTRAINT valid_plan_item_time CHECK (end_time > start_time)
);

CREATE INDEX idx_daily_plan_items_plan ON daily_plan_items (plan_id) WHERE deleted_at IS NULL;

ALTER TABLE daily_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own daily plan items"
    ON daily_plan_items FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
