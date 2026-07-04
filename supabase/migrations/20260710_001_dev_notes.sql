-- LifeOS: dev notes — bugs and improvement ideas the user voices to the agent.
-- The agent logs them (log_feedback tool); Claude Code reads them when the
-- user says "go through my dev notes". Closes the feedback loop between
-- using the app and improving it.

CREATE TABLE IF NOT EXISTS dev_notes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind        text NOT NULL DEFAULT 'bug' CHECK (kind IN ('bug', 'idea')),
    title       text NOT NULL,
    detail      text,
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_notes_open
    ON dev_notes (user_id, created_at DESC) WHERE status = 'open';

ALTER TABLE dev_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own dev notes"
    ON dev_notes FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_dev_notes_updated_at ON dev_notes;
CREATE TRIGGER trg_dev_notes_updated_at
    BEFORE UPDATE ON dev_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
