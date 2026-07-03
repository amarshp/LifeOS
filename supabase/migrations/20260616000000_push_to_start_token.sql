-- LifeOS: APNs push-to-start for Live Activities (start while app closed).
-- ActivityKit issues ONE push-to-start token per app (per attributes type), not
-- per activity. RN captures it (expo-live-activity onPushToStartTokenReceived)
-- and stores it on the device's voice_credentials row. An APNs server then sends
-- a `start` push so the Dynamic Island / Lock Screen fires the instant the user
-- speaks, even with the app closed.

ALTER TABLE voice_credentials
    ADD COLUMN IF NOT EXISTS push_to_start_token text;

-- Authenticated RN client stores the token for its own device row.
CREATE OR REPLACE FUNCTION set_push_to_start_token(
    p_device_id text,
    p_token     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    UPDATE voice_credentials
        SET push_to_start_token = p_token, updated_at = now()
        WHERE device_id = p_device_id AND user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION set_push_to_start_token(text, text) TO authenticated;
