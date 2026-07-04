-- LifeOS Phase 3: agent memory palette, conversational journal, push transport.
-- Profile facts / routines / preferences are memory rows (kind); commitments
-- are todos (kind='commitment'); recurring todos are the routines' schedule.

-- ============================================================
-- AGENT MEMORIES (inspectable — the user can edit, forget, pin)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_memories (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind              text NOT NULL DEFAULT 'fact' CHECK (kind IN ('profile', 'routine', 'preference', 'fact')),
    content           text NOT NULL,
    source            text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent')),
    pinned            boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_confirmed_at timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_live
    ON agent_memories (user_id) WHERE deleted_at IS NULL;

ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own memories"
    ON agent_memories FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- JOURNAL (one factual+subjective entry per day)
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date        date NOT NULL,
    summary     text NOT NULL,          -- factual timeline summary (agent-written)
    answers     jsonb,                  -- adaptive Q&A of the evening review
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, date)
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own journal"
    ON journal_entries FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_journal_updated_at ON journal_entries;
CREATE TRIGGER trg_journal_updated_at
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- PUSH TOKENS (remote delivery — Notifications v2 transport)
-- ============================================================
CREATE TABLE IF NOT EXISTS push_tokens (
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token       text NOT NULL,
    platform    text NOT NULL DEFAULT 'ios',
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push tokens"
    ON push_tokens FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
