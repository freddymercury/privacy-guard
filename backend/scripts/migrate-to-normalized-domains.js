#!/usr/bin/env node

/**
 * Data Migration Script for PrivacyGuard
 *
 * This script migrates existing data to use normalized domains:
 * 1. Fetches all records from the websites table
 * 2. Normalizes each URL
 * 3. Groups assessments by normalized URL
 * 4. Keeps the most recent assessment for each normalized URL
 * 5. Updates the database with the normalized URLs
 *
 * Similarly, it updates the unassessed_urls table to use normalized URLs and removes duplicates.
 *
 * Usage: node migrate-to-normalized-domains.js
 */

// Load environment variables
require("dotenv").config({ path: "../.env" });

const { normalizeUrl } = require("../src/utils/domainUtils");
const db = require("../src/utils/db");

async function migrateWebsites() {
  console.log("Starting migration of websites table...");

  try {
    // Fetch all records from the websites table
    const { data: websites, error } = await db.supabase
      .from("websites")
      .select("*");

    if (error) {
      throw error;
    }

    console.log(`Found ${websites.length} records in websites table`);

    // Group assessments by normalized URL
    const groupedByNormalizedUrl = {};

    for (const website of websites) {
      const originalUrl = website.url;
      const normalizedUrl = normalizeUrl(originalUrl);

      console.log(`Original URL: ${originalUrl}, Normalized: ${normalizedUrl}`);

      if (!groupedByNormalizedUrl[normalizedUrl]) {
        groupedByNormalizedUrl[normalizedUrl] = [];
      }

      groupedByNormalizedUrl[normalizedUrl].push(website);
    }

    // Process each group
    for (const [normalizedUrl, group] of Object.entries(
      groupedByNormalizedUrl
    )) {
      if (group.length === 1) {
        // Only one record for this normalized URL
        const website = group[0];

        if (website.url !== normalizedUrl) {
          // Update the URL to the normalized form
          console.log(`Updating URL: ${website.url} -> ${normalizedUrl}`);

          const { error: updateError } = await db.supabase
            .from("websites")
            .update({ url: normalizedUrl })
            .eq("id", website.id);

          if (updateError) {
            console.error(`Error updating website ${website.id}:`, updateError);
          }
        }
      } else {
        // Multiple records for this normalized URL
        console.log(`Found ${group.length} records for ${normalizedUrl}`);

        // Sort by last_updated (newest first)
        group.sort(
          (a, b) => new Date(b.last_updated) - new Date(a.last_updated)
        );

        // Keep the most recent assessment
        const mostRecent = group[0];

        // Update the URL to the normalized form if needed
        if (mostRecent.url !== normalizedUrl) {
          console.log(
            `Updating most recent record: ${mostRecent.url} -> ${normalizedUrl}`
          );

          const { error: updateError } = await db.supabase
            .from("websites")
            .update({ url: normalizedUrl })
            .eq("id", mostRecent.id);

          if (updateError) {
            console.error(
              `Error updating website ${mostRecent.id}:`,
              updateError
            );
          }
        }

        // Delete the older records
        for (let i = 1; i < group.length; i++) {
          console.log(
            `Deleting older record: ${group[i].url} (ID: ${group[i].id})`
          );

          const { error: deleteError } = await db.supabase
            .from("websites")
            .delete()
            .eq("id", group[i].id);

          if (deleteError) {
            console.error(
              `Error deleting website ${group[i].id}:`,
              deleteError
            );
          }
        }
      }
    }

    console.log("Websites table migration completed");
  } catch (error) {
    console.error("Error migrating websites table:", error);
  }
}

async function migrateUnassessedUrls() {
  console.log("Starting migration of unassessed_urls table...");

  try {
    // Fetch all records from the unassessed_urls table
    const { data: unassessedUrls, error } = await db.supabase
      .from("unassessed_urls")
      .select("*");

    if (error) {
      throw error;
    }

    console.log(
      `Found ${unassessedUrls.length} records in unassessed_urls table`
    );

    // Group by normalized URL
    const groupedByNormalizedUrl = {};

    for (const entry of unassessedUrls) {
      const originalUrl = entry.url;
      const normalizedUrl = normalizeUrl(originalUrl);

      console.log(`Original URL: ${originalUrl}, Normalized: ${normalizedUrl}`);

      if (!groupedByNormalizedUrl[normalizedUrl]) {
        groupedByNormalizedUrl[normalizedUrl] = [];
      }

      groupedByNormalizedUrl[normalizedUrl].push(entry);
    }

    // Process each group
    for (const [normalizedUrl, group] of Object.entries(
      groupedByNormalizedUrl
    )) {
      if (group.length === 1) {
        // Only one record for this normalized URL
        const entry = group[0];

        if (entry.url !== normalizedUrl) {
          // Update the URL to the normalized form
          console.log(`Updating URL: ${entry.url} -> ${normalizedUrl}`);

          const { error: updateError } = await db.supabase
            .from("unassessed_urls")
            .update({ url: normalizedUrl })
            .eq("id", entry.id);

          if (updateError) {
            console.error(
              `Error updating unassessed URL ${entry.id}:`,
              updateError
            );
          }
        }
      } else {
        // Multiple records for this normalized URL
        console.log(`Found ${group.length} records for ${normalizedUrl}`);

        // Sort by first_recorded (oldest first)
        group.sort(
          (a, b) => new Date(a.first_recorded) - new Date(b.first_recorded)
        );

        // Keep the oldest entry
        const oldest = group[0];

        // Update the URL to the normalized form if needed
        if (oldest.url !== normalizedUrl) {
          console.log(
            `Updating oldest record: ${oldest.url} -> ${normalizedUrl}`
          );

          const { error: updateError } = await db.supabase
            .from("unassessed_urls")
            .update({ url: normalizedUrl })
            .eq("id", oldest.id);

          if (updateError) {
            console.error(
              `Error updating unassessed URL ${oldest.id}:`,
              updateError
            );
          }
        }

        // Delete the newer records
        for (let i = 1; i < group.length; i++) {
          console.log(
            `Deleting newer record: ${group[i].url} (ID: ${group[i].id})`
          );

          const { error: deleteError } = await db.supabase
            .from("unassessed_urls")
            .delete()
            .eq("id", group[i].id);

          if (deleteError) {
            console.error(
              `Error deleting unassessed URL ${group[i].id}:`,
              deleteError
            );
          }
        }
      }
    }

    console.log("Unassessed URLs table migration completed");
  } catch (error) {
    console.error("Error migrating unassessed_urls table:", error);
  }
}

async function main() {
  console.log("Starting domain normalization migration...");

  try {
    await migrateWebsites();
    await migrateUnassessedUrls();

    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit(0);
  }
}

main();
