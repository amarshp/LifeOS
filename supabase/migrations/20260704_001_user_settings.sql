-- LifeOS: server-backed user settings + single-timer enforcement.
-- Client settings were AsyncStorage-only, so DB triggers and edge functions
-- could not see them. This table is the server-readable source of truth for
-- settings that must be enforced below the UI. First such setting:
-- allow_parallel_timers (default OFF → one running timer, atomic switches).

-- ============================================================
-- USER SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_settings (
    user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    allow_parallel_timers  boolean NOT NULL DEFAULT false,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settings"
    ON user_settings FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON user_settings;
CREATE TRIGGER trg_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RUNNING-TIMER CAP: 1 by default, 2 when parallel timers are enabled.
-- (Missing settings row = default OFF.)
-- ============================================================
CREATE OR REPLACE FUNCTION check_max_running_timers()
RETURNS TRIGGER AS $$
DECLARE
    v_max int;
BEGIN
    IF NEW.is_running = true THEN
        SELECT CASE WHEN COALESCE(
            (SELECT allow_parallel_timers FROM user_settings WHERE user_id = NEW.user_id),
            false) THEN 2 ELSE 1 END
        INTO v_max;
        IF (SELECT count(*) FROM time_entries
            WHERE user_id = NEW.user_id AND is_running = true AND deleted_at IS NULL AND id != NEW.id) >= v_max THEN
            RAISE EXCEPTION 'Maximum % running timer% allowed', v_max, CASE WHEN v_max = 1 THEN '' ELSE 's' END;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- VOICE PATH: "parallel …"/"also …" falls back to a normal switch
-- when parallel timers are disabled (keyword still recognized so the
-- spoken command never errors — it just starts the activity cleanly).
-- Only the action-parse + stop-everything block changes; the rest of
-- _voice_track_core is identical to 20260615_001.
-- ============================================================
CREATE OR REPLACE FUNCTION _voice_track_core(
    p_user_id    uuid,
    p_command_id uuid,
    p_title      text,
    p_at         timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_raw        text := coalesce(trim(p_title), '');
    v_lower      text := lower(v_raw);
    v_action     text := 'start';
    v_title      text := v_raw;
    v_cat        uuid;
    v_tag        text;
    v_existing   time_entries%ROWTYPE;
    v_match      time_entries%ROWTYPE;
    v_new_id     uuid;
    v_tags       text[] := ARRAY['review'];
    v_parallel_ok boolean;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'no user';
    END IF;

    -- Idempotency: same command already applied -> return its state unchanged.
    IF p_command_id IS NOT NULL THEN
        SELECT * INTO v_existing FROM time_entries
        WHERE user_id = p_user_id AND command_id = p_command_id AND deleted_at IS NULL
        LIMIT 1;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'action', 'idempotent', 'entry_id', v_existing.id, 'title', v_existing.title,
                'category_id', v_existing.category_id,
                'start_time', to_char(v_existing.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'is_running', v_existing.is_running
            );
        END IF;
    END IF;

    -- Parse leading action keyword.
    IF v_lower LIKE 'stop %' OR v_lower = 'stop' THEN
        v_action := 'stop'; v_title := trim(substring(v_raw FROM 6));
    ELSIF v_lower LIKE 'end %' THEN
        v_action := 'stop'; v_title := trim(substring(v_raw FROM 5));
    ELSIF v_lower LIKE 'parallel %' THEN
        v_action := 'parallel'; v_title := trim(substring(v_raw FROM 10));
    ELSIF v_lower LIKE 'also %' THEN
        v_action := 'parallel'; v_title := trim(substring(v_raw FROM 6));
    END IF;

    -- Parallel timers disabled -> a parallel request is just a switch.
    IF v_action = 'parallel' THEN
        SELECT COALESCE(
            (SELECT allow_parallel_timers FROM user_settings WHERE user_id = p_user_id),
            false) INTO v_parallel_ok;
        IF NOT v_parallel_ok THEN
            v_action := 'start';
        END IF;
    END IF;

    -- STOP: match a running entry by title, else by inferred category, else current.
    IF v_action = 'stop' THEN
        SELECT * INTO v_match FROM time_entries
        WHERE user_id = p_user_id AND is_running = true AND deleted_at IS NULL
          AND lower(title) = lower(v_title)
        ORDER BY start_time DESC LIMIT 1;

        IF NOT FOUND AND v_title <> '' THEN
            -- inferred category fallback
            SELECT id INTO v_cat FROM categories
            WHERE user_id = p_user_id AND deleted_at IS NULL
              AND lower(v_title) ~ ('\m' || lower(name) || '\M')
            ORDER BY sort_order LIMIT 1;
            IF v_cat IS NOT NULL THEN
                SELECT * INTO v_match FROM time_entries
                WHERE user_id = p_user_id AND is_running = true AND deleted_at IS NULL
                  AND category_id = v_cat
                ORDER BY start_time DESC LIMIT 1;
            END IF;
        END IF;

        IF NOT FOUND AND v_title = '' THEN
            SELECT * INTO v_match FROM time_entries
            WHERE user_id = p_user_id AND is_running = true AND deleted_at IS NULL
            ORDER BY start_time DESC LIMIT 1;
        END IF;

        IF FOUND THEN
            UPDATE time_entries SET is_running = false, end_time = p_at, updated_at = now()
            WHERE id = v_match.id;
        END IF;

        RETURN jsonb_build_object('action', 'stop', 'entry_id', v_match.id, 'title', v_match.title,
            'category_id', v_match.category_id, 'is_running', false);
    END IF;

    -- START/PARALLEL: resolve category + optional tag from the (cleaned) title.
    -- tag match first (gives tag + its category), then category name, then default.
    SELECT name, category_id INTO v_tag, v_cat FROM tags
    WHERE user_id = p_user_id AND deleted_at IS NULL
      AND lower(v_title) ~ ('\m' || lower(name) || '\M')
    LIMIT 1;

    IF v_cat IS NOT NULL THEN
        v_tags := ARRAY['review', v_tag];
    ELSE
        SELECT id INTO v_cat FROM categories
        WHERE user_id = p_user_id AND deleted_at IS NULL
          AND lower(v_title) ~ ('\m' || lower(name) || '\M')
        ORDER BY sort_order LIMIT 1;
    END IF;

    IF v_cat IS NULL THEN
        SELECT id INTO v_cat FROM categories
        WHERE user_id = p_user_id AND deleted_at IS NULL
          AND lower(name) IN ('misc', 'inbox', 'other')
        ORDER BY sort_order LIMIT 1;
    END IF;
    IF v_cat IS NULL THEN
        SELECT id INTO v_cat FROM categories
        WHERE user_id = p_user_id AND deleted_at IS NULL
        ORDER BY sort_order LIMIT 1;
    END IF;
    IF v_cat IS NULL THEN
        RAISE EXCEPTION 'no category available';
    END IF;

    -- start stops everything; parallel leaves others running
    IF v_action = 'start' THEN
        UPDATE time_entries SET is_running = false, end_time = p_at, updated_at = now()
        WHERE user_id = p_user_id AND is_running = true AND deleted_at IS NULL;
    END IF;

    INSERT INTO time_entries (user_id, category_id, title, start_time, is_running, tags, command_id)
    VALUES (p_user_id, v_cat, v_title, p_at, true, v_tags, p_command_id)
    ON CONFLICT (user_id, command_id) WHERE command_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_new_id;

    -- If conflict (race), fetch the existing row.
    IF v_new_id IS NULL AND p_command_id IS NOT NULL THEN
        SELECT id INTO v_new_id FROM time_entries
        WHERE user_id = p_user_id AND command_id = p_command_id LIMIT 1;
    END IF;

    RETURN jsonb_build_object(
        'action', v_action, 'entry_id', v_new_id, 'title', v_title, 'category_id', v_cat,
        'tags', to_jsonb(v_tags),
        'start_time', to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'is_running', true
    );
END;
$$;
