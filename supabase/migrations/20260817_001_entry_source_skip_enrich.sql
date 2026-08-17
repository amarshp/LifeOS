-- LifeOS: track WHO created a time_entries/todos row (manual app entry, the
-- agent, or voice/Siri) so enrich-capture can skip agent-created rows — the
-- agent already writes clean titles via its own prompt, so re-classifying
-- them is a wasted OpenAI call, not a correctness fix.

ALTER TABLE time_entries ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'agent', 'voice'));
ALTER TABLE todos ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'agent', 'voice'));

-- Voice/Siri captures stamp source='voice' (still enriched — that's the whole
-- point of enrich-capture, per its own header comment).
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

    -- start stops everything; parallel leaves others running.
    -- Sub-minute switched-away timers are mis-speak dust: delete, don't keep.
    IF v_action = 'start' THEN
        DELETE FROM time_entries
        WHERE user_id = p_user_id AND is_running = true AND deleted_at IS NULL
          AND p_at - start_time < interval '60 seconds';
        UPDATE time_entries SET is_running = false, end_time = p_at, updated_at = now()
        WHERE user_id = p_user_id AND is_running = true AND deleted_at IS NULL;
    END IF;

    INSERT INTO time_entries (user_id, category_id, title, start_time, is_running, tags, command_id, source)
    VALUES (p_user_id, v_cat, v_title, p_at, true, v_tags, p_command_id, 'voice')
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

-- Skip the enrich webhook entirely for agent-created rows — they're already
-- clean, so calling out would just burn an OpenAI call for nothing.
CREATE OR REPLACE FUNCTION notify_enrich()
RETURNS TRIGGER AS $$
DECLARE
    v_url text;
    v_key text;
BEGIN
    IF NEW.source = 'agent' THEN
        RETURN NEW;
    END IF;
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'enrich_url';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'enrich_key';
    IF v_url IS NULL OR v_key IS NULL THEN
        RETURN NEW; -- not wired yet — captures proceed untouched
    END IF;
    PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-enrich-key', v_key),
        body := jsonb_build_object('table', TG_TABLE_NAME, 'id', NEW.id, 'title', NEW.title)
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW; -- enrichment must never break a capture
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions, net;
