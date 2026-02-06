-- Fix users RLS to allow authenticated users to read their own profile
-- This fixes the "Unknown user" issue on hard refresh

-- Allow users to read their own profile by email match
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  USING (auth.jwt() ->> 'email' = email);

-- Allow admins to read all users (for team management)
CREATE POLICY "Admins can read all users"
  ON users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.email = auth.jwt() ->> 'email' 
      AND u.role = 'admin'
    )
  );

-- Allow admins to manage users
CREATE POLICY "Admins can manage users"
  ON users FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.email = auth.jwt() ->> 'email' 
      AND u.role = 'admin'
    )
  );
