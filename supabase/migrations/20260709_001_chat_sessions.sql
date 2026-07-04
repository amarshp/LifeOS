-- LifeOS: persistent agent chat sessions (ChatGPT-style).
-- A session = one conversation with the Agent: title (first prompt), target
-- plan date, full message list, and the last proposed plan. The Agent screen
-- lists recent sessions to resume; typing fresh starts a new one.

CREATE TABLE IF NOT EXISTS chat_sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title       text NOT NULL,
    date        text NOT NULL,               -- plan target date (YYYY-MM-DD)
    messages    jsonb NOT NULL DEFAULT '[]', -- [{role, content}]
    plan        jsonb,                       -- last ProposedPlan, if any
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_recent
    ON chat_sessions (user_id, updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own chat sessions"
    ON chat_sessions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER trg_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
