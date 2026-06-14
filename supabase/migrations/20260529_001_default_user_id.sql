-- Add default auth.uid() to user_id columns so client inserts don't need to pass it
ALTER TABLE calendar_blocks ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE time_entries ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE tags ALTER COLUMN user_id SET DEFAULT auth.uid();
