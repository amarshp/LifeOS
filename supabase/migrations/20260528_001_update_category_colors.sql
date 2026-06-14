-- Update category colors to chalk pastels matching the premium design
UPDATE categories SET color = '#A99BC0' WHERE name = 'Deep Work';
UPDATE categories SET color = '#C2AEDA' WHERE name = 'Study';
UPDATE categories SET color = '#E5CC98' WHERE name = 'Admin';
UPDATE categories SET color = '#A5C2A3' WHERE name = 'Gym';
UPDATE categories SET color = '#C9C5B9' WHERE name = 'Break';
UPDATE categories SET color = '#BBA999' WHERE name = 'Commute';

-- Update the seed function to use new colors for future signups
CREATE OR REPLACE FUNCTION seed_default_categories(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO categories (user_id, name, color, icon, sort_order)
    VALUES
        (p_user_id, 'Deep Work', '#A99BC0', 'brain',           0),
        (p_user_id, 'Study',     '#C2AEDA', 'book',            1),
        (p_user_id, 'Admin',     '#E5CC98', 'tray.full',       2),
        (p_user_id, 'Gym',       '#A5C2A3', 'figure.walk',     3),
        (p_user_id, 'Break',     '#C9C5B9', 'cup.and.saucer',  4),
        (p_user_id, 'Commute',   '#BBA999', 'car',             5)
    ON CONFLICT DO NOTHING;
END;
$$;
