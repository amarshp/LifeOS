-- Voice vocabulary: names of people/places/projects the user actually says.
-- Fed to the transcription model as a bias prompt and to the enricher as
-- known entities, so "Samkeet" stops coming out as "some keet".

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS stt_vocabulary text[] NOT NULL DEFAULT '{}';
