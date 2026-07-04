-- LifeOS Notifications v1 (local-first).
-- scheduled_notifications holds DIRECT reminders (agent tool / manual one-offs).
-- Derived reminders (plan blocks, task deadlines, rituals) are computed on the
-- client from their sources + the preference columns below and scheduled as
-- local notifications — they are not materialized here in v1.
-- user_settings grows server-readable notification preferences so the Phase-4
-- brain and edge functions can respect them later.

-- ============================================================
-- DIRECT REMINDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source      text NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'user', 'system')),
    ref_id      uuid,                       -- optional link (todo/block id)
    fire_at     timestamptz NOT NULL,
    title       text NOT NULL,
    body        text,
    sound       text,                        -- reserved: bundled sound name
    status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fired', 'cancelled')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sched_notif_pending
    ON scheduled_notifications (user_id, fire_at) WHERE status = 'pending';

ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own scheduled notifications"
    ON scheduled_notifications FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_sched_notif_updated_at ON scheduled_notifications;
CREATE TRIGGER trg_sched_notif_updated_at
    BEFORE UPDATE ON scheduled_notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- NOTIFICATION PREFERENCES (server-readable)
-- ============================================================
ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS notif_plan_enabled       boolean  NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notif_plan_offsets_min   int[]    NOT NULL DEFAULT '{15,5}',
    ADD COLUMN IF NOT EXISTS notif_task_enabled       boolean  NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notif_task_offsets_min   int[]    NOT NULL DEFAULT '{60}',
    ADD COLUMN IF NOT EXISTS notif_plan_tomorrow_hhmm text,                -- e.g. '21:30'; null = off
    ADD COLUMN IF NOT EXISTS quiet_hours_start        smallint,            -- local hour 0-23; null = off
    ADD COLUMN IF NOT EXISTS quiet_hours_end          smallint;
