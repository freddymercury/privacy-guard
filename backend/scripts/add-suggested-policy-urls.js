#!/usr/bin/env node

/**
 * Database Migration Script for PrivacyGuard
 *
 * This script adds the suggested_policy_urls column to the unassessed_urls table.
 *
 * Usage: node add-suggested-policy-urls.js
 */

// Load environment variables
require("dotenv").config({ path: "../.env" });

const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials. Please check your .env file.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addSuggestedPolicyUrlsColumn() {
  console.log("Starting migration to add suggested_policy_urls column...");

  try {
    // Check if the column already exists
    const { data: columns, error: columnsError } = await supabase.rpc(
      "get_columns_info",
      { table_name: "unassessed_urls" }
    );

    if (columnsError) {
      throw new Error(`Error checking columns: ${columnsError.message}`);
    }

    const hasColumn = columns.some(
      (col) => col.column_name === "suggested_policy_urls"
    );

    if (hasColumn) {
      console.log(
        "Column suggested_policy_urls already exists. Skipping migration."
      );
      return;
    }

    // Add the column
    const { error } = await supabase.rpc("run_sql", {
      sql: "ALTER TABLE unassessed_urls ADD COLUMN IF NOT EXISTS suggested_policy_urls JSONB DEFAULT '[]'::jsonb",
    });

    if (error) {
      throw new Error(`Error adding column: ${error.message}`);
    }

    console.log(
      "Successfully added suggested_policy_urls column to unassessed_urls table"
    );
  } catch (error) {
    console.error("Migration failed:", error);
  }
}

async function main() {
  try {
    await addSuggestedPolicyUrlsColumn();
    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit(0);
  }
}

main();
