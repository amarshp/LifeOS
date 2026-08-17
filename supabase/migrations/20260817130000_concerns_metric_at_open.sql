-- Phase 4 (PLANNING_MODE_SPEC.md §13a.1): closes the feedback loop on brain
-- nudges. Reuses the existing concerns table rather than a new log table —
-- `created_at`/`status`/`resolution`/`updated_at` already exist; this adds
-- only the one number needed to compare "state when it fired" against
-- "state when it cleared".
ALTER TABLE concerns ADD COLUMN IF NOT EXISTS metric_at_open numeric;
