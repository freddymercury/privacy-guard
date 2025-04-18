// Background script for PrivacyGuard Chrome Plugin

// Import utility functions
import { getNormalizedDomain, normalizeUrl } from "./utils.js";

// Configuration
const API_BASE_URL = "http://localhost:3000/api"; // Change in production

// Listen for tab updates to detect URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only proceed if the URL has changed and loaded completely
  if (changeInfo.status === "complete" && tab.url) {
    // Check if the URL is valid (not chrome:// or other browser URLs)
    if (isValidUrl(tab.url)) {
      // Query the service layer for assessment
      checkPrivacyAssessment(tab.url, tabId);
    }
  }
});

// Check if URL is valid for assessment
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    // Exclude browser internal pages and other non-http(s) protocols
    return urlObj.protocol === "http:" || urlObj.protocol === "https:";
  } catch (e) {
    return false;
  }
}

// Fetch with timeout and retry
async function fetchWithRetry(url, options = {}, retries = 2, timeout = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Clone options to avoid modifying the original object
  const optionsWithSignal = { ...options };
  
  // If options already has a signal, we need to handle it properly
  if (options.signal) {
    const originalSignal = options.signal;
    // Create a handler that aborts the controller if either signal aborts
    const handleAbort = () => controller.abort();
    originalSignal.addEventListener('abort', handleAbort);
    
    // Clean up the event listener when we're done
    const cleanup = () => originalSignal.removeEventListener('abort', handleAbort);
    
    // We'll need to clean up regardless of how this function exits
    try {
      optionsWithSignal.signal = controller.signal;
      const response = await fetch(url, optionsWithSignal);
      clearTimeout(timeoutId);
      cleanup();
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      cleanup();
      throw error;
    }
  } else {
    // Simple case - just use our controller's signal
    optionsWithSignal.signal = controller.signal;
    
    try {
      const response = await fetch(url, optionsWithSignal);
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Log more details about the error
      if (error.name === 'AbortError') {
        console.log(`[PrivacyGuard BG] Request to ${url} timed out after ${timeout}ms`);
      } else if (error instanceof DOMException) {
        console.log(`[PrivacyGuard BG] DOMException in fetch: ${error.name} - ${error.message}`);
      }
      
      if (retries <= 0) throw error;

      console.log(
        `[PrivacyGuard BG] Retrying fetch to ${url}, ${retries} retries left`
      );
      // Wait a bit before retrying (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 1000 * (3 - retries)));
      return fetchWithRetry(url, options, retries - 1, timeout);
    }
  }
}

// Query the service layer for privacy assessment
async function checkPrivacyAssessment(url, tabId) {
  try {
    // Extract domain from URL for assessment lookup and remove 'www.' prefix
    const fullHostname = new URL(url).hostname;
    const domain = normalizeUrl(url); // Use normalizeUrl to ensure 'www.' is removed
    console.log(
      `[PrivacyGuard BG] Checking assessment for domain: ${fullHostname}, Normalized: ${domain}`
    );

    // Query the backend service
    console.log(
      `[PrivacyGuard BG] Fetching from: ${API_BASE_URL}/assessment?url=${encodeURIComponent(
        domain
      )}`
    );

    const response = await fetchWithRetry(
      `${API_BASE_URL}/assessment?url=${encodeURIComponent(domain)}`
    );

    const data = await response.json();
    console.log(`[PrivacyGuard BG] Assessment API response:`, data);

    // Update the extension icon based on assessment
    if (data.status === "success") {
      if (data.assessment) {
        console.log(
          `[PrivacyGuard BG] Assessment found with risk level: ${data.assessment.riskLevel}`
        );
        // Assessment exists, update icon based on risk level
        updateIcon(tabId, data.assessment.riskLevel);
        // Store assessment data for popup
        chrome.storage.local.set({ [domain]: data.assessment });
        console.log(`[PrivacyGuard BG] Assessment stored in local storage`);
      } else {
        console.log(
          `[PrivacyGuard BG] No assessment available for ${domain}, reporting as unassessed`
        );
        // No assessment available
        updateIcon(tabId, "unknown");
        // Report URL for future assessment
        await reportUnassessedUrl(domain);

        // Immediately trigger assessment for this URL
        try {
          console.log(
            `[PrivacyGuard BG] Triggering immediate assessment for ${domain}`
          );

          const triggerResponse = await fetchWithRetry(
            `${API_BASE_URL}/trigger-assessment/${encodeURIComponent(domain)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
            }
          );

          const triggerData = await triggerResponse.json();
          console.log(
            `[PrivacyGuard BG] Trigger assessment response:`,
            triggerData
          );

          if (triggerData.status === "success" && triggerData.assessment) {
            console.log(
              `[PrivacyGuard BG] Immediate assessment successful with risk level: ${triggerData.assessment.riskLevel}`
            );
            // Update icon based on risk level
            updateIcon(tabId, triggerData.assessment.riskLevel);
            // Store assessment data for popup
            chrome.storage.local.set({ [domain]: triggerData.assessment });
            console.log(
              `[PrivacyGuard BG] Immediate assessment stored in local storage`
            );
          } else {
            console.log(
              `[PrivacyGuard BG] Immediate assessment did not return an assessment object`
            );
          }
        } catch (triggerError) {
          // Provide more detailed error logging
          if (triggerError instanceof DOMException) {
            console.error(
              `[PrivacyGuard BG] Error triggering assessment: DOMException - ${triggerError.name}: ${triggerError.message}`
            );
          } else {
            console.error(
              "[PrivacyGuard BG] Error triggering assessment:",
              triggerError
            );
          }
        }
      }
    } else {
      console.error(`[PrivacyGuard BG] Error in API response:`, data);
      // Error in API response
      updateIcon(tabId, "error");
    }
  } catch (error) {
    console.error(
      "[PrivacyGuard BG] Error checking privacy assessment:",
      error
    );
    updateIcon(tabId, "error");
  }
}

// Update the extension badge based on risk level
function updateIcon(tabId, riskLevel) {
  let badgeText;
  let badgeColor;

  // Normalize riskLevel to handle different possible structures
  let normalizedRiskLevel;
  if (typeof riskLevel === "string") {
    normalizedRiskLevel = riskLevel.toLowerCase();
  } else if (riskLevel && typeof riskLevel === "object" && riskLevel.risk) {
    normalizedRiskLevel =
      typeof riskLevel.risk === "string"
        ? riskLevel.risk.toLowerCase()
        : "unknown";
  } else {
    console.error(
      `[PrivacyGuard BG] Unexpected risk level structure:`,
      riskLevel
    );
    normalizedRiskLevel = "unknown";
  }

  switch (normalizedRiskLevel) {
    case "high":
      badgeText = "H";
      badgeColor = "#e74c3c"; // Red
      break;
    case "medium":
      badgeText = "M";
      badgeColor = "#f39c12"; // Yellow
      break;
    case "low":
      badgeText = "L";
      badgeColor = "#2ecc71"; // Green
      break;
    case "unknown":
      badgeText = "?";
      badgeColor = "#95a5a6"; // Gray
      break;
    case "error":
      badgeText = "!";
      badgeColor = "#e74c3c"; // Red
      break;
    default:
      badgeText = "?";
      badgeColor = "#95a5a6"; // Gray
      break;
  }

  chrome.action.setBadgeText({ tabId, text: badgeText });
  chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
}

// Report unassessed URL to the service layer
async function reportUnassessedUrl(domain) {
  try {
    // Domain should already be normalized at this point, but let's ensure it
    // Use normalizeUrl instead of getNormalizedDomain to ensure 'www.' is removed
    const normalizedDomain = domain; // Already normalized by normalizeUrl in checkPrivacyAssessment
    console.log(
      `[PrivacyGuard BG] Reporting unassessed URL: ${domain}, Normalized: ${normalizedDomain}`
    );

    await fetchWithRetry(`${API_BASE_URL}/report-unassessed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: normalizedDomain }),
    });
  } catch (error) {
    console.error("[PrivacyGuard BG] Error reporting unassessed URL:", error);
    // Continue execution even if reporting fails
  }
}

// Export functions for testing
export {
  isValidUrl,
  checkPrivacyAssessment,
  updateIcon,
  reportUnassessedUrl,
  fetchWithRetry,
};
