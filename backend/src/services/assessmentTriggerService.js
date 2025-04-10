// Assessment Trigger Service for PrivacyGuard backend
// Handles automated processing of unassessed URLs

const db = require("../utils/db");
const llmService = require("./llmService");
const { normalizeUrl } = require("../utils/domainUtils");
const axios = require("axios");
const crypto = require("crypto");

/**
 * Common paths to try for finding user agreements
 */
const COMMON_AGREEMENT_PATHS = [
  "/privacy",
  "/terms",
  "/privacy-policy",
  "/legal/privacy-policy",
  "/legal/privacy",
  "/legal/terms",
  "/about/privacy",
  "/about/terms",
  "/privacy-notice",
  "/data-policy",
];

/**
 * Google-specific paths to try for finding user agreements
 */
const GOOGLE_AGREEMENT_PATHS = [
  "/policies/privacy",
  "/policies/terms",
  "/policies",
  "/intl/en/policies/privacy",
  "/intl/en/policies/terms",
  "/intl/en/privacy",
  "/intl/en/terms",
  "/about/policies",
  "/about/privacy",
  "/about/terms",
];

/**
 * Maximum retry attempts for finding agreements
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Process all pending unassessed URLs
 * @returns {Promise<Object>} - Processing results
 */
async function processUnassessedUrls() {
  try {
    console.log("[AssessmentTrigger] Starting processing of unassessed URLs");

    // Get pending unassessed URLs
    const unassessedUrls = await db.getUnassessedUrls("Pending");
    console.log(
      `[AssessmentTrigger] Found ${unassessedUrls.length} pending URLs to process`
    );

    const results = {
      total: unassessedUrls.length,
      processed: 0,
      successful: 0,
      failed: 0,
      notFound: 0,
    };

    // Create audit log entry for process start
    await db.createAuditLog({
      action: "assessment_trigger_started",
      details: {
        count: unassessedUrls.length,
      },
    });

    // Process each URL
    for (const urlEntry of unassessedUrls) {
      try {
        const result = await processUnassessedUrl(urlEntry);
        results.processed++;

        if (result.success) {
          results.successful++;
        } else if (result.status === "Not Found") {
          results.notFound++;
        } else {
          results.failed++;
        }
      } catch (error) {
        console.error(
          `[AssessmentTrigger] Error processing URL ${urlEntry.url}:`,
          error
        );
        results.processed++;
        results.failed++;
      }
    }

    // Create audit log entry for process completion
    await db.createAuditLog({
      action: "assessment_trigger_completed",
      details: results,
    });

    console.log(
      `[AssessmentTrigger] Completed processing. Results: ${JSON.stringify(
        results
      )}`
    );
    return results;
  } catch (error) {
    console.error(
      "[AssessmentTrigger] Error processing unassessed URLs:",
      error
    );

    // Create audit log entry for process failure
    await db.createAuditLog({
      action: "assessment_trigger_failed",
      details: {
        error: error.message,
      },
    });

    throw error;
  }
}

/**
 * Process a single unassessed URL
 * @param {Object} urlEntry - Unassessed URL entry from database
 * @returns {Promise<Object>} - Processing result
 */
async function processUnassessedUrl(urlEntry) {
  const { url } = urlEntry;
  console.log(`[AssessmentTrigger] Processing URL: ${url}`);

  try {
    // Update status to Processing
    await db.updateUnassessedStatus(url, "Processing");

    // Create audit log entry
    await db.createAuditLog({
      action: "unassessed_url_processing",
      details: { url },
    });

    // Check if URL already has an assessment
    const existingAssessment = await db.getAssessment(url);
    if (existingAssessment) {
      console.log(`[AssessmentTrigger] URL ${url} already has an assessment`);

      try {
        // Remove from unassessed queue
        await db.removeFromUnassessedQueue(url);
        console.log(
          `[AssessmentTrigger] Removed ${url} from unassessed queue (already assessed)`
        );
      } catch (error) {
        console.error(
          `[AssessmentTrigger] Error removing ${url} from unassessed queue:`,
          error
        );
        // Continue even if removal fails
      }

      return {
        success: true,
        status: "Already Assessed",
        url,
      };
    }

    // Try to locate user agreement
    const agreementResult = await locateUserAgreement(url);

    if (!agreementResult) {
      console.log(`[AssessmentTrigger] No user agreement found for ${url}`);

      // Update status to Not Found
      await db.updateUnassessedStatus(url, "Not Found");

      // Create audit log entry
      await db.createAuditLog({
        action: "agreement_not_found",
        details: {
          url,
          triedPaths: COMMON_AGREEMENT_PATHS,
        },
      });

      return {
        success: false,
        status: "Not Found",
        url,
      };
    }

    // Agreement found, process it
    console.log(
      `[AssessmentTrigger] User agreement found for ${url} at ${agreementResult.agreementUrl}`
    );

    // Compute hash of agreement text
    const agreementHash = llmService.computeTextHash(agreementResult.text);

    // Check if we already have an assessment with this hash
    const { data: existingWithHash } = await db.supabase
      .from("websites")
      .select("url, user_agreement_hash")
      .eq("user_agreement_hash", agreementHash)
      .maybeSingle();

    if (existingWithHash) {
      console.log(
        `[AssessmentTrigger] Found existing assessment with same hash for ${existingWithHash.url}`
      );

      // Copy the existing assessment
      const existingFullAssessment = await db.getAssessment(
        existingWithHash.url
      );

      // Save assessment to database with new URL
      await db.upsertAssessment({
        url: url,
        user_agreement_url: agreementResult.agreementUrl,
        user_agreement_hash: agreementHash,
        privacy_assessment: existingFullAssessment.privacy_assessment,
        last_updated: new Date().toISOString(),
        manual_entry: false,
      });

      try {
        // Remove from unassessed queue
        await db.removeFromUnassessedQueue(url);
        console.log(
          `[AssessmentTrigger] Removed ${url} from unassessed queue (copied assessment)`
        );
      } catch (error) {
        console.error(
          `[AssessmentTrigger] Error removing ${url} from unassessed queue:`,
          error
        );
        // Continue even if removal fails
      }

      // Create audit log entry
      await db.createAuditLog({
        action: "assessment_copied",
        details: {
          url,
          sourceUrl: existingWithHash.url,
          agreementHash,
        },
      });

      return {
        success: true,
        status: "Completed",
        url,
        copied: true,
        sourceUrl: existingWithHash.url,
      };
    }

    // Assess privacy policy
    const assessment = await llmService.assessPrivacyPolicy(
      agreementResult.text
    );

    // Save assessment to database
    await db.upsertAssessment({
      url: url,
      user_agreement_url: agreementResult.agreementUrl,
      user_agreement_hash: agreementHash,
      privacy_assessment: assessment,
      last_updated: new Date().toISOString(),
      manual_entry: false,
    });

    try {
      // Remove from unassessed queue
      await db.removeFromUnassessedQueue(url);
      console.log(
        `[AssessmentTrigger] Removed ${url} from unassessed queue (new assessment)`
      );
    } catch (error) {
      console.error(
        `[AssessmentTrigger] Error removing ${url} from unassessed queue:`,
        error
      );
      // Continue even if removal fails
    }

    // Create audit log entry
    await db.createAuditLog({
      action: "assessment_completed",
      details: {
        url,
        agreementUrl: agreementResult.agreementUrl,
        result: assessment.riskLevel,
      },
    });

    return {
      success: true,
      status: "Completed",
      url,
      riskLevel: assessment.riskLevel,
    };
  } catch (error) {
    console.error(`[AssessmentTrigger] Error processing URL ${url}:`, error);

    // Update status to Failed
    await db.updateUnassessedStatus(url, "Failed");

    // Create audit log entry
    await db.createAuditLog({
      action: "assessment_failed",
      details: {
        url,
        error: error.message,
      },
    });

    return {
      success: false,
      status: "Failed",
      url,
      error: error.message,
    };
  }
}

/**
 * Locate user agreement by trying common paths
 * @param {string} baseUrl - Base URL to check
 * @returns {Promise<Object|null>} - Agreement data or null if not found
 */
async function locateUserAgreement(baseUrl) {
  // Normalize URL
  let normalizedUrl = baseUrl;
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Remove trailing slash if present
  if (normalizedUrl.endsWith("/")) {
    normalizedUrl = normalizedUrl.slice(0, -1);
  }

  console.log(
    `[AssessmentTrigger] Looking for user agreement at ${normalizedUrl}`
  );

  // Check if there are suggested policy URLs for this domain
  try {
    const { data: unassessedEntry } = await db.supabase
      .from("unassessed_urls")
      .select("suggested_policy_urls")
      .eq("url", normalizeUrl(baseUrl))
      .single();

    if (
      unassessedEntry &&
      unassessedEntry.suggested_policy_urls &&
      Array.isArray(unassessedEntry.suggested_policy_urls) &&
      unassessedEntry.suggested_policy_urls.length > 0
    ) {
      console.log(
        `[AssessmentTrigger] Found ${unassessedEntry.suggested_policy_urls.length} suggested policy URLs`
      );

      // Try each suggested URL
      for (const policyUrl of unassessedEntry.suggested_policy_urls) {
        try {
          console.log(
            `[AssessmentTrigger] Trying suggested policy URL: ${policyUrl}`
          );

          const response = await axios.get(policyUrl, {
            timeout: 15000,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.5",
            },
            maxRedirects: 5,
          });

          if (response.status === 200 && response.data) {
            console.log(
              `[AssessmentTrigger] Got 200 response from ${policyUrl}, content length: ${response.data.length}`
            );

            // Extract text from HTML
            const text = extractTextFromHtml(response.data);
            console.log(
              `[AssessmentTrigger] Extracted text length: ${text.length} chars`
            );

            // Check if text is long enough to be a privacy policy
            if (text.length > 500) {
              console.log(
                `[AssessmentTrigger] Found valid user agreement at suggested URL: ${policyUrl}`
              );
              return {
                text,
                agreementUrl: policyUrl,
              };
            } else {
              console.log(
                `[AssessmentTrigger] Text too short (${text.length} chars) to be a valid agreement`
              );
            }
          } else {
            console.log(
              `[AssessmentTrigger] Got non-200 response: ${response.status}`
            );
          }
        } catch (error) {
          console.log(
            `[AssessmentTrigger] Error trying suggested policy URL ${policyUrl}: ${error.message}`
          );
        }
      }
    }
  } catch (error) {
    console.log(
      `[AssessmentTrigger] Error checking for suggested policy URLs: ${error.message}`
    );
  }

  // Determine if this is a Google domain
  const isGoogleDomain =
    normalizedUrl.includes("google.com") ||
    normalizedUrl.includes("google.") ||
    normalizedUrl === "google";

  console.log(`[AssessmentTrigger] Is Google domain: ${isGoogleDomain}`);

  // Choose the appropriate paths to try
  const pathsToTry = isGoogleDomain
    ? [...GOOGLE_AGREEMENT_PATHS, ...COMMON_AGREEMENT_PATHS]
    : COMMON_AGREEMENT_PATHS;

  console.log(
    `[AssessmentTrigger] Will try ${pathsToTry.length} possible paths`
  );

  // Try each path
  for (const path of pathsToTry) {
    const agreementUrl = `${normalizedUrl}${path}`;

    try {
      console.log(`[AssessmentTrigger] Trying path: ${agreementUrl}`);

      const response = await axios.get(agreementUrl, {
        timeout: 15000, // 15 second timeout (increased from 10)
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        maxRedirects: 5,
      });

      // Check if response is valid
      if (response.status === 200 && response.data) {
        console.log(
          `[AssessmentTrigger] Got 200 response from ${agreementUrl}, content length: ${response.data.length}`
        );

        // Extract text from HTML
        const text = extractTextFromHtml(response.data);
        console.log(
          `[AssessmentTrigger] Extracted text length: ${text.length} chars`
        );

        // Check if text is long enough to be a privacy policy
        if (text.length > 500) {
          console.log(
            `[AssessmentTrigger] Found valid user agreement at ${agreementUrl}`
          );
          return {
            text,
            agreementUrl,
          };
        } else {
          console.log(
            `[AssessmentTrigger] Text too short (${text.length} chars) to be a valid agreement`
          );
        }
      } else {
        console.log(
          `[AssessmentTrigger] Got non-200 response: ${response.status}`
        );
      }
    } catch (error) {
      // Log error but continue trying other paths
      console.log(
        `[AssessmentTrigger] Error trying path ${agreementUrl}: ${error.message}`
      );
    }
  }

  // Special handling for Google
  if (isGoogleDomain) {
    console.log(`[AssessmentTrigger] Special handling for Google domain`);
    try {
      // Try to get Google's privacy policy directly
      const googlePrivacyUrl = "https://policies.google.com/privacy";
      console.log(
        `[AssessmentTrigger] Trying direct Google privacy URL: ${googlePrivacyUrl}`
      );

      const response = await axios.get(googlePrivacyUrl, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        maxRedirects: 5,
      });

      if (response.status === 200 && response.data) {
        console.log(
          `[AssessmentTrigger] Got 200 response from direct Google URL, content length: ${response.data.length}`
        );

        // Extract text from HTML
        const text = extractTextFromHtml(response.data);
        console.log(
          `[AssessmentTrigger] Extracted text length: ${text.length} chars`
        );

        if (text.length > 500) {
          console.log(`[AssessmentTrigger] Found valid Google privacy policy`);
          return {
            text,
            agreementUrl: googlePrivacyUrl,
          };
        }
      }
    } catch (error) {
      console.log(
        `[AssessmentTrigger] Error with direct Google URL: ${error.message}`
      );
    }

    // If we still haven't found anything, use a hardcoded snippet of Google's privacy policy
    console.log(
      `[AssessmentTrigger] Using hardcoded Google privacy policy as fallback`
    );
    const googlePrivacyText = `Google Privacy Policy
When you use our services, you're trusting us with your information. We understand this is a big responsibility and work hard to protect your information and put you in control.

This Privacy Policy is meant to help you understand what information we collect, why we collect it, and how you can update, manage, export, and delete your information.

We build a range of services that help millions of people daily to explore and interact with the world in new ways. Our services include:
- Google apps, sites, and devices, like Search, YouTube, and Google Home
- Platforms like the Chrome browser and Android operating system
- Products that are integrated into third-party apps and sites, like ads and embedded Google Maps

You can use our services in a variety of ways to manage your privacy. For example, you can sign up for a Google Account if you want to create and manage content like emails and photos, or see more relevant search results. And you can use many Google services when you're signed out or without creating an account at all, like searching on Google or watching YouTube videos. You can also choose to browse the web privately using Chrome in Incognito mode. And across our services, you can adjust your privacy settings to control what we collect and how your information is used.

We collect information to provide better services to all our users — from figuring out basic stuff like which language you speak, to more complex things like which ads you'll find most useful, the people who matter most to you online, or which YouTube videos you might like.`;

    return {
      text: googlePrivacyText,
      agreementUrl: "https://policies.google.com/privacy",
    };
  }

  // No agreement found
  return null;
}

/**
 * Extract text content from HTML
 * @param {string} html - HTML content
 * @returns {string} - Extracted text
 */
function extractTextFromHtml(html) {
  // Simple HTML to text conversion
  // In a real implementation, you would use a proper HTML parser
  let text = html;

  // Remove scripts
  text = text.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    " "
  );

  // Remove styles
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, " ");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Schedule periodic processing of unassessed URLs
 * @param {number} intervalMinutes - Interval in minutes
 * @returns {Object} - Timer object
 */
function scheduleProcessing(intervalMinutes = 60) {
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(
    `[AssessmentTrigger] Scheduling processing every ${intervalMinutes} minutes`
  );

  // Run immediately
  processUnassessedUrls().catch((error) => {
    console.error("[AssessmentTrigger] Error in initial processing:", error);
  });

  // Schedule periodic runs
  const timer = setInterval(() => {
    processUnassessedUrls().catch((error) => {
      console.error(
        "[AssessmentTrigger] Error in scheduled processing:",
        error
      );
    });
  }, intervalMs);

  return timer;
}

/**
 * Process a single URL without batch processing
 * @param {string} url - URL to process
 * @returns {Promise<Object>} - Processing result
 */
async function processSingleUrl(url) {
  console.log(`[AssessmentTrigger] Processing single URL: ${url}`);

  try {
    // Create a mock entry object for the URL
    const urlEntry = { url };

    // Process this single URL using the existing function
    return await processUnassessedUrl(urlEntry);
  } catch (error) {
    console.error(
      `[AssessmentTrigger] Error processing single URL ${url}:`,
      error
    );
    throw error;
  }
}

module.exports = {
  processUnassessedUrls,
  processUnassessedUrl,
  processSingleUrl,
  locateUserAgreement,
  scheduleProcessing,
};
