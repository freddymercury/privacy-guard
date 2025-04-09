const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  // Allow missing credentials only in test environment
  const isTestEnvironment =
    process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
    
  if (!isTestEnvironment) {
    throw new Error('Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_KEY environment variables.');
  } else {
    // In test environment, mocks will handle functionality. Export placeholder.
    console.warn('Supabase credentials missing, proceeding in test mode. Mocks should be used.');
    module.exports = {}; // Placeholder for tests when no creds
  }
} else {
  const supabase = createClient(supabaseUrl, supabaseKey);
  module.exports = supabase;
} 