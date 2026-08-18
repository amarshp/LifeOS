-- LifeOS: User Plan Preferences (Amarsh, 2026-08-18).
--
-- Three pieces:
-- 1. Office attendance is date-ranged (this month M-Th office + Fri WFH,
--    next month M-F office) — a dedicated table, not a column, since the
--    rule set itself changes over time and is naturally per-weekday rows
--    (same shape as `todos.recurrence_days`: 0=Mon...6=Sun).
-- 2. Holidays are a growing per-user list — dedicated table, same pattern
--    as `todos`.
-- 3. Wake-time tiers + sleep rules are per-user scalars — flat columns on
--    user_settings, matching the existing notif_*/timezone convention
--    (never JSONB for this kind of setting in this codebase).

-- ============================================================
-- OFFICE SCHEDULE RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS office_schedule_rules (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    effective_from date NOT NULL,
    weekday        smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Mon...6=Sun
    mode           text NOT NULL CHECK (mode IN ('office', 'wfh')),
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_office_schedule_rules
    ON office_schedule_rules (user_id, effective_from, weekday);
CREATE INDEX IF NOT EXISTS idx_office_schedule_rules_user
    ON office_schedule_rules (user_id, effective_from DESC);

ALTER TABLE office_schedule_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own office schedule rules"
    ON office_schedule_rules FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- HOLIDAYS
-- ============================================================
CREATE TABLE IF NOT EXISTS holidays (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date       date NOT NULL,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays ON holidays (user_id, date);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own holidays"
    ON holidays FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- WAKE-TIME TIERS + SLEEP RULES (per-user scalars)
-- ============================================================
ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS wake_ideal_time      time,
    ADD COLUMN IF NOT EXISTS wake_acceptable_time time,
    ADD COLUMN IF NOT EXISTS wake_lastresort_time time,
    ADD COLUMN IF NOT EXISTS coffee_cutoff_time   time,
    ADD COLUMN IF NOT EXISTS melatonin_time       time,
    ADD COLUMN IF NOT EXISTS weekend_wake_flex_min int NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS sunlight_after_wake   boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS nap_cap_min           int NOT NULL DEFAULT 20,
    ADD COLUMN IF NOT EXISTS nap_cutoff_time       time NOT NULL DEFAULT '18:00',
    ADD COLUMN IF NOT EXISTS gym_cutoff_time       time NOT NULL DEFAULT '21:00';

-- ============================================================
-- RULE-VIOLATION INSTANT PUSH: fires the moment a timer starts past a
-- cutoff (coffee/nap/gym) — same trigger-on-time_entries shape as the
-- existing check_max_running_timers, but non-blocking (AFTER, not BEFORE)
-- since going over a cutoff is a nudge, not a hard stop. Reuses the
-- pg_net -> brain pipeline already wired for the cron (20260708_001_brain.sql)
-- instead of a new delivery path.
-- ============================================================
CREATE OR REPLACE FUNCTION check_rule_violations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
    v_tz            text;
    v_coffee_cutoff time;
    v_nap_cutoff    time;
    v_gym_cutoff    time;
    v_local_time    time;
    v_title_lower   text;
    v_message       text;
    v_url           text;
    v_key           text;
BEGIN
    -- Only a genuinely NEW running start, not every update to an already-running row.
    IF NEW.is_running IS NOT TRUE THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.is_running IS TRUE THEN RETURN NEW; END IF;

    SELECT timezone, coffee_cutoff_time, nap_cutoff_time, gym_cutoff_time
    INTO v_tz, v_coffee_cutoff, v_nap_cutoff, v_gym_cutoff
    FROM user_settings WHERE user_id = NEW.user_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    v_local_time := (NEW.start_time AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::time;
    v_title_lower := lower(NEW.title);

    IF v_coffee_cutoff IS NOT NULL AND v_title_lower LIKE '%coffee%' AND v_local_time >= v_coffee_cutoff THEN
        v_message := format('Coffee at %s is past your %s cutoff — still time to skip it.',
            to_char(v_local_time, 'HH12:MI AM'), to_char(v_coffee_cutoff, 'HH12:MI AM'));
    ELSIF v_nap_cutoff IS NOT NULL AND v_title_lower LIKE '%nap%' AND v_local_time >= v_nap_cutoff THEN
        v_message := format('Nap starting at %s is past your %s cutoff — keep it short if you go ahead.',
            to_char(v_local_time, 'HH12:MI AM'), to_char(v_nap_cutoff, 'HH12:MI AM'));
    ELSIF v_gym_cutoff IS NOT NULL AND v_title_lower LIKE '%gym%' AND v_local_time >= v_gym_cutoff THEN
        v_message := format('Gym starting at %s is past your %s cutoff — tight on time to eat and digest before bed.',
            to_char(v_local_time, 'HH12:MI AM'), to_char(v_gym_cutoff, 'HH12:MI AM'));
    END IF;

    IF v_message IS NOT NULL THEN
        SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'brain_url';
        SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'brain_cron_key';
        IF v_url IS NOT NULL THEN
            PERFORM net.http_post(
                url := v_url,
                headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_key),
                body := jsonb_build_object('trigger', 'rule_violation', 'user_id', NEW.user_id, 'message', v_message)
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_rule_violations ON time_entries;
CREATE TRIGGER trg_check_rule_violations
    AFTER INSERT OR UPDATE ON time_entries
    FOR EACH ROW EXECUTE FUNCTION check_rule_violations();

-- ============================================================
-- SEED: Amarsh's real account (single-user app — see MEMORY lifeos-accounts).
-- ============================================================
INSERT INTO user_settings (
    user_id, wake_ideal_time, wake_acceptable_time, wake_lastresort_time,
    coffee_cutoff_time, melatonin_time
) VALUES (
    'c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '07:30', '08:30', '09:30', '15:00', '20:30'
)
ON CONFLICT (user_id) DO UPDATE SET
    wake_ideal_time      = EXCLUDED.wake_ideal_time,
    wake_acceptable_time = EXCLUDED.wake_acceptable_time,
    wake_lastresort_time = EXCLUDED.wake_lastresort_time,
    coffee_cutoff_time   = EXCLUDED.coffee_cutoff_time,
    melatonin_time       = EXCLUDED.melatonin_time;

-- This month (Aug 2026): Mon-Thu office, Fri WFH.
INSERT INTO office_schedule_rules (user_id, effective_from, weekday, mode) VALUES
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-08-01', 0, 'office'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-08-01', 1, 'office'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-08-01', 2, 'office'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-08-01', 3, 'office'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-08-01', 4, 'wfh')
ON CONFLICT (user_id, effective_from, weekday) DO NOTHING;

-- From Sep 2026: Mon-Fri office.
INSERT INTO office_schedule_rules (user_id, effective_from, weekday, mode) VALUES
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-09-01', 0, 'office'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-09-01', 1, 'office'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-09-01', 2, 'office'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-09-01', 3, 'office'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-09-01', 4, 'office')
ON CONFLICT (user_id, effective_from, weekday) DO NOTHING;

INSERT INTO holidays (user_id, date, name) VALUES
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-09-14', 'Ganesh Chaturthi'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-10-02', 'Gandhi Jayanti'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-10-20', 'Vijayadasami'),
    ('c65511fc-667f-4f6e-a787-b79fbc3d6a3f', '2026-12-25', 'Christmas Day')
ON CONFLICT (user_id, date) DO NOTHING;
