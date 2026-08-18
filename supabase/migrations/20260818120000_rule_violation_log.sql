-- Log every rule-violation detection into brain_runs (same audit trail the
-- cron/app_open triggers already write to) — makes the trigger's decision
-- inspectable via REST without needing DB/docker access, and matches the
-- existing "every run is logged, acted or stayed silent" philosophy.
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
        INSERT INTO brain_runs (user_id, trigger, summary)
        VALUES (NEW.user_id, 'rule_violation', v_message);

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
