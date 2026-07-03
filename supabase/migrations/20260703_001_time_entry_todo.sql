-- LifeOS: link live tracking to backlog tasks.
--
-- A time entry can carry the task it works on (picked in the start/log sheet,
-- inherited from a planned block, or set by the AI agent). Stopping/completing
-- a linked entry auto-completes the todo (service layer + plan-chat edge fn).
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS todo_id uuid REFERENCES todos(id);
