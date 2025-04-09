-- Direct SQL migration to add suggested_policy_urls column to unassessed_urls table
-- Run this in the Supabase SQL Editor

-- Add the column if it doesn't exist
ALTER TABLE unassessed_urls 
ADD COLUMN IF NOT EXISTS suggested_policy_urls JSONB DEFAULT '[]'::jsonb;

-- Grant permissions to access the column
GRANT ALL ON unassessed_urls TO authenticated;
GRANT ALL ON unassessed_urls TO anon;
GRANT ALL ON unassessed_urls TO service_role;

-- Refresh the schema cache
NOTIFY pgrst, 'reload schema';
