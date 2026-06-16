-- Records when an APNs push-to-start Live Activity was fired for a voice entry.
-- The client uses it to distinguish a voice entry that already has a push-started
-- card (push succeeded) from one that needs a local fallback card (offline/queued
-- path, or push failure) — so opening the app never duplicates the card but a
-- missing card still appears.
alter table public.time_entries
  add column if not exists push_started_at timestamptz;
