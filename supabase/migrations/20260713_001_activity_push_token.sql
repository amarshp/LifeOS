-- Live Activity UPDATE pushes: each running entry's card registers a per-
-- activity APNs token; the brain refreshes the card's "Next: …" subtitle on
-- its half-hourly tick even while the app is closed.

ALTER TABLE time_entries
    ADD COLUMN IF NOT EXISTS activity_push_token text;
