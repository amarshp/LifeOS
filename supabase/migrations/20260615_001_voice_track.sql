-- LifeOS: no-app-open voice/shortcut tracking (Correct V1)
-- Adds: per-device voice credential, idempotency column, and a security-definer
-- core that parses + categorizes + writes a time entry. Two callers:
--   * Edge Function `voice-track` (service role) -> voice_track_admin(user_id, ...)
--   * RN fallback drain (authenticated)          -> track_from_voice(...)
-- Both funnel into _voice_track_core, which is idempotent on (user_id, command_id).

-- ============================================================
-- DEVICE VOICE CREDENTIALS (API-key style: store only the hash)
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_credentials (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id    text NOT NULL UNIQUE,
    secret_hash  text NOT NULL,                 -- sha256(raw secret), hex
    revoked      boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE voice_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own voice credentials"
    ON voice_credentials FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- IDEMPOTENCY: each voice command carries a client UUID
-- ============================================================
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS command_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_entries_user_command
    ON time_entries (user_id, command_id) WHERE command_id IS NOT NULL;

-- ============================================================
-- CORE: parse + categorize + write (idempotent). No public grant.
-- Action is derived from a leading keyword in the spoken title.
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

-- Authenticated callers (RN fallback) act as themselves.
CREATE OR REPLACE FUNCTION track_from_voice(
    p_command_id uuid,
    p_title      text,
    p_at         timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    RETURN _voice_track_core(auth.uid(), p_command_id, p_title, p_at);
END;
$$;

-- Service-role caller (Edge Function) acts for a verified user_id.
CREATE OR REPLACE FUNCTION voice_track_admin(
    p_user_id    uuid,
    p_command_id uuid,
    p_title      text,
    p_at         timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN _voice_track_core(p_user_id, p_command_id, p_title, p_at);
END;
$$;

-- Grants: core + admin are NOT for end users; only the self-variant is.
REVOKE ALL ON FUNCTION _voice_track_core(uuid, uuid, text, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION voice_track_admin(uuid, uuid, text, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION voice_track_admin(uuid, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION track_from_voice(uuid, text, timestamptz) TO authenticated;

-- ============================================================
-- DEVICE CREDENTIAL REGISTRATION (DB mints secret + stores its hash)
-- RN calls this on login; the raw secret is returned ONCE and stored on-device
-- (shared file for the native intent). No crypto needed on the RN side.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION register_voice_credential(p_device_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user   uuid;
    v_device text;
    v_secret text;
    v_hash   text;
BEGIN
    v_user := auth.uid();
    IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    v_device := coalesce(nullif(p_device_id, ''), encode(gen_random_bytes(8), 'hex'));
    v_secret := encode(gen_random_bytes(32), 'hex');
    v_hash   := encode(digest(v_secret, 'sha256'), 'hex');

    INSERT INTO voice_credentials (user_id, device_id, secret_hash, revoked, updated_at)
    VALUES (v_user, v_device, v_hash, false, now())
    ON CONFLICT (device_id) DO UPDATE
        SET secret_hash = excluded.secret_hash,
            user_id     = excluded.user_id,
            revoked     = false,
            updated_at  = now()
        WHERE voice_credentials.user_id = v_user;

    RETURN jsonb_build_object('device_id', v_device, 'secret', v_secret);
END;
$$;

CREATE OR REPLACE FUNCTION revoke_voice_credential(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    UPDATE voice_credentials SET revoked = true, updated_at = now()
    WHERE device_id = p_device_id AND user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION register_voice_credential(text) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_voice_credential(text) TO authenticated;
