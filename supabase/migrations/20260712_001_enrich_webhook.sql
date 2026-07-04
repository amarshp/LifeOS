-- LifeOS: capture auto-enrichment wiring.
-- Every INSERT into time_entries / todos fires a webhook (pg_net) to the
-- enrich-capture edge function, which cleans the title + classifies via a
-- small model. Async: capture never waits on it; a dead webhook changes
-- nothing. URL + key live in Vault (setup_enrich_webhook, run once at deploy).

CREATE OR REPLACE FUNCTION notify_enrich()
RETURNS TRIGGER AS $$
DECLARE
    v_url text;
    v_key text;
BEGIN
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

DROP TRIGGER IF EXISTS trg_enrich_time_entries ON time_entries;
CREATE TRIGGER trg_enrich_time_entries
    AFTER INSERT ON time_entries
    FOR EACH ROW EXECUTE FUNCTION notify_enrich();

DROP TRIGGER IF EXISTS trg_enrich_todos ON todos;
CREATE TRIGGER trg_enrich_todos
    AFTER INSERT ON todos
    FOR EACH ROW EXECUTE FUNCTION notify_enrich();

-- One-time wiring (service_role only), same pattern as setup_brain_cron.
CREATE OR REPLACE FUNCTION setup_enrich_webhook(p_url text, p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
    DELETE FROM vault.secrets WHERE name IN ('enrich_url', 'enrich_key');
    PERFORM vault.create_secret(p_url, 'enrich_url');
    PERFORM vault.create_secret(p_key, 'enrich_key');
END;
$$;

REVOKE ALL ON FUNCTION setup_enrich_webhook(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION setup_enrich_webhook(text, text) TO service_role;
