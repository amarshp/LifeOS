-- LifeOS: Todos (backlog of intentions) + steps + recurrence completions.
--
-- Todos are timeless intentions (priority + deadline), NOT scheduled blocks.
-- On a given day the planner (manual or AI/voice) pulls open todos into that
-- day's `daily_plan_items` (and they materialize into `calendar_blocks`), which
-- is how a todo enters the plan / Day / Week views. The bridge is a nullable
-- `todo_id` on `daily_plan_items` and `calendar_blocks`.
--
-- Recurrence is modeled as a single rolling row: a recurring todo carries the
-- recurrence rule + `next_due`; completing it writes a `todo_completions` row
-- (history / streaks) and advances `next_due` to the next occurrence (done in
-- the service so the rule logic stays shared with calendar_blocks).

-- ============================================================
-- TODOS — backlog of intentions
-- ============================================================
CREATE TABLE IF NOT EXISTS todos (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title            text NOT NULL,
    category_id      uuid REFERENCES categories(id),
    priority         int  NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3), -- 0 none · 1 low · 2 med · 3 high
    deadline         timestamptz,
    notes            text,
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    completed_at     timestamptz,
    recurrence       text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekdays', 'mwf', 'weekly', 'custom')),
    recurrence_days  int[],   -- for 'custom' (0=Mon … 6=Sun, matching calendar_blocks)
    next_due         date,    -- for recurring todos: the next occurrence date
    sort_order       int  NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_todos_open ON todos (user_id) WHERE deleted_at IS NULL AND status = 'open';

ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own todos"
    ON todos FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TODO STEPS — one-level ordered checklist ("phases")
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_steps (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    todo_id     uuid NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    title       text NOT NULL,
    done        boolean NOT NULL DEFAULT false,
    sort_order  int NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_todo_steps_todo ON todo_steps (todo_id) WHERE deleted_at IS NULL;

ALTER TABLE todo_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own todo steps"
    ON todo_steps FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TODO COMPLETIONS — recurrence history (one row per occurrence done)
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_completions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    todo_id       uuid NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    completed_on  date NOT NULL,  -- the OCCURRENCE date being credited (not wall-clock)
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_todo_completions_todo ON todo_completions (todo_id);
-- One credit per occurrence — re-tapping "done" can't inflate streaks (service
-- upserts ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_todo_completion ON todo_completions (todo_id, completed_on);

ALTER TABLE todo_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own todo completions"
    ON todo_completions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- BRIDGES — link a planned item / block back to its todo
-- ============================================================
ALTER TABLE daily_plan_items ADD COLUMN IF NOT EXISTS todo_id uuid REFERENCES todos(id);
ALTER TABLE calendar_blocks  ADD COLUMN IF NOT EXISTS todo_id uuid REFERENCES todos(id);
