-- LifeOS Phase 4: the autonomous brain.
-- Durable unit of accountability = an open CONCERN (evidence, importance,
-- last action, next check, resolution) — not a fire-and-forget notification.
-- Every run is logged (acted or stayed silent, and why) in brain_runs.

-- ============================================================
-- CONCERNS
-- ============================================================
CREATE TABLE IF NOT EXISTS concerns (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    key            text NOT NULL,               -- stable identity, e.g. 'gap:2026-07-04', 'commitment:<todo_id>'
    kind           text NOT NULL,               -- gap · drift · commitment · morning · evening
    title          text NOT NULL,
    detail         text,
    evidence       text,                        -- the numbers behind it, human-readable
    importance     smallint NOT NULL DEFAULT 2, -- 1 low · 2 normal · 3 high
    status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed', 'superseded')),
    resolution     text,
    last_action    text,                        -- what the brain last did about it
    last_action_at timestamptz,
    cooldown_until timestamptz,                 -- stay silent about it until then
    notified_count int NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_concerns_open
    ON concerns (user_id, key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_concerns_user_status
    ON concerns (user_id, status, updated_at DESC);

ALTER TABLE concerns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own concerns"
    ON concerns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own concerns"
    ON concerns FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_concerns_updated_at ON concerns;
CREATE TRIGGER trg_concerns_updated_at
    BEFORE UPDATE ON concerns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- BRAIN RUN LOG (inspectable: why it acted or stayed silent)
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_runs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    trigger     text NOT NULL,                  -- cron · app_open
    summary     text NOT NULL,                  -- decisions, one line per concern
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_runs_user
    ON brain_runs (user_id, created_at DESC);

ALTER TABLE brain_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own brain runs"
    ON brain_runs FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- SETTINGS the brain respects
-- ============================================================
ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS notif_daily_budget int NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

-- ============================================================
-- CRON WIRING (pg_cron + pg_net + Vault).
-- setup_brain_cron() is invoked ONCE at deploy time with the real URL and a
-- random cron key — values live in Vault, never in this file.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION setup_brain_cron(p_url text, p_cron_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, vault, extensions
AS $$
BEGIN
    -- Refresh vault secrets (delete + recreate keeps this idempotent).
    DELETE FROM vault.secrets WHERE name IN ('brain_url', 'brain_cron_key');
    PERFORM vault.create_secret(p_url, 'brain_url');
    PERFORM vault.create_secret(p_cron_key, 'brain_cron_key');

    -- (Re)schedule the half-hourly brain tick.
    PERFORM cron.unschedule('lifeos-brain')
        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lifeos-brain');
    PERFORM cron.schedule(
        'lifeos-brain',
        '*/30 * * * *',
        $job$
        SELECT net.http_post(
            url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'brain_url'),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'brain_cron_key')
            ),
            body := '{"trigger":"cron"}'::jsonb
        );
        $job$
    );
END;
$$;

REVOKE ALL ON FUNCTION setup_brain_cron(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION setup_brain_cron(text, text) TO service_role;
