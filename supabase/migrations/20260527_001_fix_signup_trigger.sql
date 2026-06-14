-- Drop the auth.users trigger that causes 500 on signup
-- Category seeding is now handled client-side after signup/signin
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Grant execute on seed_default_categories so client can call it via RPC
GRANT EXECUTE ON FUNCTION seed_default_categories(uuid) TO authenticated;
