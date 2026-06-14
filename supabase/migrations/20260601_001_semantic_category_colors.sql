-- Reassign default category colors to semantically matched chalk pastels.
-- Deep Work and Study were near-identical purples; Break and Commute were
-- both warm beige/taupe. Each category now has a distinct semantic tone.
UPDATE categories SET color = '#9B8EC0' WHERE name = 'Deep Work';   -- muted indigo  (depth, focus)
UPDATE categories SET color = '#8BB4CC' WHERE name = 'Study';       -- cornflower    (calm, academic)
UPDATE categories SET color = '#CCAA6B' WHERE name = 'Admin';       -- warm amber    (tasks, paperwork)
UPDATE categories SET color = '#8FBF8A' WHERE name = 'Gym';         -- leaf green    (energy, physical)
UPDATE categories SET color = '#CCA8A8' WHERE name = 'Break';       -- dusty rose    (rest, downtime)
UPDATE categories SET color = '#8AAFAF' WHERE name = 'Commute';     -- steel teal    (transit, in-between)

-- Update seed function for future signups
CREATE OR REPLACE FUNCTION seed_default_categories(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO categories (user_id, name, color, icon, sort_order)
    VALUES
        (p_user_id, 'Deep Work', '#9B8EC0', 'brain',           0),
        (p_user_id, 'Study',     '#8BB4CC', 'book',            1),
        (p_user_id, 'Admin',     '#CCAA6B', 'tray.full',       2),
        (p_user_id, 'Gym',       '#8FBF8A', 'figure.walk',     3),
        (p_user_id, 'Break',     '#CCA8A8', 'cup.and.saucer',  4),
        (p_user_id, 'Commute',   '#8AAFAF', 'car',             5)
    ON CONFLICT DO NOTHING;
END;
$$;
