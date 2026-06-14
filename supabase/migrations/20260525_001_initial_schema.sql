-- LifeOS Phase 1: Initial Schema
-- Tables: categories, tags, weekly_template_blocks, calendar_blocks, time_entries

-- ============================================================
-- CATEGORIES
-- ============================================================
CREATE TABLE categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name        text NOT NULL,
    color       text NOT NULL DEFAULT '#6366F1',
    icon        text,
    sort_order  int NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE INDEX idx_categories_user ON categories (user_id) WHERE deleted_at IS NULL;

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own categories"
    ON categories FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TAGS (scoped to categories)
-- ============================================================
CREATE TABLE tags (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category_id  uuid NOT NULL REFERENCES categories(id),
    name         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,

    CONSTRAINT unique_tag_per_category UNIQUE (category_id, name)
);

CREATE INDEX idx_tags_category ON tags (category_id) WHERE deleted_at IS NULL;

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tags"
    ON tags FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- WEEKLY TEMPLATE BLOCKS
-- ============================================================
CREATE TABLE weekly_template_blocks (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category_id  uuid NOT NULL REFERENCES categories(id),
    title        text NOT NULL,
    day_of_week  int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Monday, 6=Sunday
    start_time   time NOT NULL,
    end_time     time NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,

    CONSTRAINT valid_template_time CHECK (end_time > start_time)
);

CREATE INDEX idx_template_blocks_user ON weekly_template_blocks (user_id) WHERE deleted_at IS NULL;

ALTER TABLE weekly_template_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own template blocks"
    ON weekly_template_blocks FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- CALENDAR BLOCKS (the "plan" side)
-- ============================================================
CREATE TABLE calendar_blocks (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    template_block_id  uuid REFERENCES weekly_template_blocks(id),
    category_id        uuid NOT NULL REFERENCES categories(id),
    title              text NOT NULL,
    date               date NOT NULL,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz NOT NULL,
    source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('template', 'manual', 'google_calendar')),
    recurrence         text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekdays', 'mwf', 'weekly', 'custom')),
    recurrence_days    int[],  -- for 'custom': array of day_of_week values (0=Mon, 6=Sun)
    recurrence_end     date,   -- optional end date for recurring blocks
    tags               text[] NOT NULL DEFAULT '{}',
    notes              text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,

    CONSTRAINT valid_block_time CHECK (end_time > start_time)
);

CREATE INDEX idx_calendar_blocks_day ON calendar_blocks (user_id, date) WHERE deleted_at IS NULL;

ALTER TABLE calendar_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own calendar blocks"
    ON calendar_blocks FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- TIME ENTRIES (the "actual" side)
-- Max 2 running entries per user (enforced at app level).
-- ============================================================
CREATE TABLE time_entries (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category_id        uuid NOT NULL REFERENCES categories(id),
    calendar_block_id  uuid REFERENCES calendar_blocks(id),
    title              text NOT NULL,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz,
    is_running         boolean NOT NULL DEFAULT false,
    tags               text[] NOT NULL DEFAULT '{}',
    notes              text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz
);

CREATE INDEX idx_time_entries_day ON time_entries (user_id, start_time) WHERE deleted_at IS NULL;
CREATE INDEX idx_time_entries_running ON time_entries (user_id) WHERE is_running = true AND deleted_at IS NULL;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own time entries"
    ON time_entries FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Enforce max 2 running timers per user
CREATE OR REPLACE FUNCTION check_max_running_timers()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_running = true THEN
        IF (SELECT count(*) FROM time_entries
            WHERE user_id = NEW.user_id AND is_running = true AND deleted_at IS NULL AND id != NEW.id) >= 2 THEN
            RAISE EXCEPTION 'Maximum 2 parallel timers allowed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_max_running_timers
    BEFORE INSERT OR UPDATE ON time_entries
    FOR EACH ROW EXECUTE FUNCTION check_max_running_timers();

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON weekly_template_blocks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON calendar_blocks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON time_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED DEFAULT CATEGORIES
-- ============================================================
-- Run after first user sign-up via a Supabase function or client-side init.
-- Example defaults:
--   Deep Work  #6366F1  brain
--   Study      #8B5CF6  book
--   Admin      #F59E0B  tray.full
--   Gym        #10B981  figure.walk
--   Break      #94A3B8  cup.and.saucer
--   Commute    #64748B  car
