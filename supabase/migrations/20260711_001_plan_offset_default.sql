-- Plan-block reminder default: one ping 5 minutes before (user feedback —
-- the extra 15-minute ping is noise). Users who explicitly picked another
-- preset keep it; only rows still on the old default move.

ALTER TABLE user_settings
    ALTER COLUMN notif_plan_offsets_min SET DEFAULT '{5}';

UPDATE user_settings
    SET notif_plan_offsets_min = '{5}'
    WHERE notif_plan_offsets_min = '{15,5}';
