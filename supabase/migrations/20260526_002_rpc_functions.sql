-- LifeOS Phase 1: RPC Functions
-- Atomic timer operations + default category seeding

-- ============================================================
-- ATOMIC STOP PREVIOUS + START NEW TIMER
-- Single-tap ▶ behavior: stops any running timer, starts new one
-- Returns the new time_entry ID
-- ============================================================
CREATE OR REPLACE FUNCTION start_timer_stop_previous(
    p_category_id uuid,
    p_title text,
    p_tags text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_new_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Stop all currently running timers for this user
    UPDATE time_entries
    SET is_running = false,
        end_time = now(),
        updated_at = now()
    WHERE user_id = v_user_id
      AND is_running = true
      AND deleted_at IS NULL;

    -- Start new timer
    INSERT INTO time_entries (user_id, category_id, title, start_time, is_running, tags)
    VALUES (v_user_id, p_category_id, p_title, now(), true, p_tags)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

-- ============================================================
-- STOP A SPECIFIC TIMER
-- ============================================================
CREATE OR REPLACE FUNCTION stop_timer(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    UPDATE time_entries
    SET is_running = false,
        end_time = now(),
        updated_at = now()
    WHERE id = p_entry_id
      AND user_id = v_user_id
      AND is_running = true
      AND deleted_at IS NULL;
END;
$$;

-- ============================================================
-- SEED DEFAULT CATEGORIES FOR A NEW USER
-- Called after sign-up (via client or trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION seed_default_categories(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO categories (user_id, name, color, icon, sort_order)
    VALUES
        (p_user_id, 'Deep Work', '#6366F1', 'brain',           0),
        (p_user_id, 'Study',     '#8B5CF6', 'book',            1),
        (p_user_id, 'Admin',     '#F59E0B', 'tray.full',       2),
        (p_user_id, 'Gym',       '#10B981', 'figure.walk',     3),
        (p_user_id, 'Break',     '#94A3B8', 'cup.and.saucer',  4),
        (p_user_id, 'Commute',   '#64748B', 'car',             5)
    ON CONFLICT DO NOTHING;
END;
$$;

-- ============================================================
-- AUTO-SEED CATEGORIES ON NEW USER SIGN-UP
-- Trigger on auth.users table
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM seed_default_categories(NEW.id);
    RETURN NEW;
END;
$$;

-- Only create this trigger if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
    ) THEN
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION handle_new_user();
    END IF;
END;
$$;

-- ============================================================
-- GRANT EXECUTE TO AUTHENTICATED USERS
-- ============================================================
GRANT EXECUTE ON FUNCTION start_timer_stop_previous(uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION stop_timer(uuid) TO authenticated;
