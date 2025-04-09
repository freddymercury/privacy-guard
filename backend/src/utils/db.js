// Database configuration for PrivacyGuard backend

const { createClient } = require("@supabase/supabase-js");
const { normalizeUrl } = require("./domainUtils");

// Import the Supabase client (real or mocked by Jest)
const supabase = require("./supabaseClient");

/**
 * Database helper functions
 */

/**
 * Get assessment for a URL
 * @param {string} url - The URL to get assessment for
 * @returns {Promise<Object|null>} - Assessment data or null if not found
 */
const getAssessment = async (url) => {
  // Normalize the URL to get the base domain
  const normalizedUrl = normalizeUrl(url);
  console.log(
    `[DB] Getting assessment for URL: ${url}, Normalized: ${normalizedUrl}`
  );

  const { data, error } = await supabase
    .from("websites")
    .select("*")
    .eq("url", normalizedUrl)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // PGRST116 is the error code for "no rows returned"
      return null;
    }
    throw error;
  }

  return data;
};

/**
 * Create or update assessment for a URL
 * @param {Object} assessment - Assessment data
 * @returns {Promise<Object>} - Updated assessment data
 */
const upsertAssessment = async (assessment) => {
  // Normalize the URL in the assessment
  const originalUrl = assessment.url;
  const normalizedUrl = normalizeUrl(originalUrl);

  console.log(
    `[DB] Upserting assessment for URL: ${originalUrl}, Normalized: ${normalizedUrl}`
  );

  // Create a new assessment object with the normalized URL
  const normalizedAssessment = {
    ...assessment,
    url: normalizedUrl,
  };

  const { data, error } = await supabase
    .from("websites")
    .upsert(normalizedAssessment)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Add URL to unassessed queue
 * @param {string} url - The URL to add to queue
 * @returns {Promise<Object>} - Created queue entry
 */
const addToUnassessedQueue = async (url) => {
  // Normalize the URL
  const normalizedUrl = normalizeUrl(url);
  console.log(
    `[DB] Adding URL to unassessed queue: ${url}, Normalized: ${normalizedUrl}`
  );

  // Check if normalized URL already exists in queue
  const { data: existing } = await supabase
    .from("unassessed_urls")
    .select("url")
    .eq("url", normalizedUrl)
    .single();

  if (existing) {
    console.log(
      `[DB] URL already exists in unassessed queue: ${normalizedUrl}`
    );
    return existing;
  }

  // Add new entry to queue with normalized URL
  const { data, error } = await supabase
    .from("unassessed_urls")
    .insert({
      url: normalizedUrl,
      first_recorded: new Date().toISOString(),
      status: "Pending",
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Get unassessed URLs from queue
 * @param {string} status - Filter by status (optional)
 * @param {number} limit - Maximum number of results (optional)
 * @returns {Promise<Array>} - Array of unassessed URLs
 */
const getUnassessedUrls = async (status = null, limit = 100) => {
  let query = supabase
    .from("unassessed_urls")
    .select("*")
    .order("first_recorded", { ascending: true })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Update status of unassessed URL
 * @param {string} url - The URL to update
 * @param {string} status - New status
 * @returns {Promise<Object>} - Updated queue entry
 */
const updateUnassessedStatus = async (url, status) => {
  // Normalize the URL
  const normalizedUrl = normalizeUrl(url);
  console.log(
    `[DB] Updating unassessed URL status: ${url}, Normalized: ${normalizedUrl}, Status: ${status}`
  );

  const { data, error } = await supabase
    .from("unassessed_urls")
    .update({ status })
    .eq("url", normalizedUrl)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Remove URL from unassessed queue
 * @param {string} url - The URL to remove
 * @returns {Promise<void>}
 */
const removeFromUnassessedQueue = async (url) => {
  try {
    // Normalize the URL
    const normalizedUrl = normalizeUrl(url);
    console.log(
      `[DB] Removing URL from unassessed queue: ${url}, Normalized: ${normalizedUrl}`
    );

    // First check if the URL exists in the queue
    const { data: existingEntry, error: checkError } = await supabase
      .from("unassessed_urls")
      .select("url")
      .eq("url", normalizedUrl)
      .single();

    if (checkError) {
      if (checkError.code === "PGRST116") {
        // Entry doesn't exist, which is fine for removal.
        console.log(`[DB] URL not found in queue, nothing to remove: ${normalizedUrl}`);
        return; // Exit gracefully
      } else {
        // For any other error during the check, re-throw it.
        console.error(`[DB] Error checking existence for ${normalizedUrl}:`, checkError);
        throw checkError; 
      }
    }

    if (!existingEntry) {
      console.log(`[DB] URL not found in unassessed queue: ${normalizedUrl}`);
      return;
    }

    // Delete the entry
    const { error: deleteError } = await supabase
      .from("unassessed_urls")
      .delete()
      .eq("url", normalizedUrl);

    if (deleteError) {
      console.error(
        `[DB] Error deleting URL from unassessed queue: ${normalizedUrl}`,
        deleteError
      );
      throw deleteError;
    }

    console.log(
      `[DB] Successfully removed URL from unassessed queue: ${normalizedUrl}`
    );
  } catch (error) {
    console.error(
      `[DB] Error in removeFromUnassessedQueue for URL ${url}:`,
      error
    );
    throw error;
  }
};

/**
 * Get user by username
 * @param {string} username - Username to look up
 * @returns {Promise<Object|null>} - User data or null if not found
 */
const getUserByUsername = async (username) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("username", username)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw error;
  }

  return data;
};

/**
 * Create audit log entry
 * @param {Object} logEntry - Audit log entry data
 * @returns {Promise<Object>} - Created log entry
 */
const createAuditLog = async (logEntry) => {
  const { data, error } = await supabase
    .from("audit_logs")
    .insert({
      ...logEntry,
      timestamp: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
};

/**
 * Update suggested policy URLs for an unassessed URL
 * @param {string} url - The URL to update
 * @param {string[]} policyUrls - Array of suggested policy URLs
 * @returns {Promise<Object>} - Updated queue entry
 */
const updateSuggestedPolicyUrls = async (url, policyUrls) => {
  // Normalize the URL
  const normalizedUrl = normalizeUrl(url);
  console.log(
    `[DB] Updating suggested policy URLs for: ${url}, Normalized: ${normalizedUrl}`
  );

  const { data, error } = await supabase
    .from("unassessed_urls")
    .update({ suggested_policy_urls: policyUrls })
    .eq("url", normalizedUrl)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
};

module.exports = {
  supabase,
  getAssessment,
  upsertAssessment,
  addToUnassessedQueue,
  getUnassessedUrls,
  updateUnassessedStatus,
  removeFromUnassessedQueue,
  getUserByUsername,
  createAuditLog,
  updateSuggestedPolicyUrls,
};
