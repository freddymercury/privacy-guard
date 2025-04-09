// PrivacyGuard Popup Script

// Import utility functions
import { getNormalizedDomain, normalizeUrl } from "./utils.js";

// Check if URL is valid for assessment
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "http:" || urlObj.protocol === "https:";
  } catch (e) {
    return false;
  }
}

// Update the assessment display
function updateAssessmentDisplay(status, message) {
  const riskIndicator = document.getElementById("risk-indicator");
  const riskText = document.getElementById("risk-text");
  const assessmentDetails = document.getElementById("assessment-details");

  // Remove all classes and add the new one
  riskIndicator.className = "risk-indicator " + status;

  // Update indicator content based on status
  switch (status) {
    case "high":
      riskIndicator.textContent = "!";
      break;
    case "medium":
      riskIndicator.textContent = "!";
      break;
    case "low":
      riskIndicator.textContent = "✓";
      break;
    case "unknown":
      riskIndicator.textContent = "?";
      break;
    case "inactive":
      riskIndicator.textContent = "OFF";
      break;
    case "invalid":
      riskIndicator.textContent = "-";
      break;
    case "error":
      riskIndicator.textContent = "X";
      break;
  }

  // Update risk text
  riskText.textContent = message;

  // Clear assessment details
  assessmentDetails.style.display = "none";
  assessmentDetails.innerHTML = "";
}

// Format category name for display
function formatCategoryName(category) {
  if (!category) return "";
  return category
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

// Display assessment data
function displayAssessment(assessment) {
  // Handle different possible structures of the risk level
  let riskLevel;
  if (typeof assessment.riskLevel === "string") {
    riskLevel = assessment.riskLevel.toLowerCase();
  } else if (
    assessment.riskLevel &&
    typeof assessment.riskLevel === "object" &&
    assessment.riskLevel.risk
  ) {
    riskLevel =
      typeof assessment.riskLevel.risk === "string"
        ? assessment.riskLevel.risk.toLowerCase()
        : "unknown";
  } else {
    console.error(
      `[PrivacyGuard] Unexpected overall risk level structure:`,
      assessment.riskLevel
    );
    riskLevel = "unknown";
  }

  const categories = assessment.categories || {};

  // Update indicator and text
  let riskMessage;
  switch (riskLevel) {
    case "high":
      riskMessage = "High Risk";
      break;
    case "medium":
      riskMessage = "Medium Risk";
      break;
    case "low":
      riskMessage = "Low Risk";
      break;
    default:
      riskMessage = "Unknown Risk";
      break;
  }

  updateAssessmentDisplay(riskLevel, riskMessage);

  // Display category details
  const assessmentDetails = document.getElementById("assessment-details");
  assessmentDetails.style.display = "block";
  assessmentDetails.innerHTML = "<h3>Risk Categories</h3>";

  const categoryList = document.createElement("div");

  // Add each category
  for (const [category, value] of Object.entries(categories)) {
    const categoryItem = document.createElement("div");
    categoryItem.className = "risk-category";

    // Add risk level class based on category risk
    if (value && value.risk) {
      categoryItem.classList.add(`risk-${value.risk.toLowerCase()}`);
    } else {
      categoryItem.classList.add("risk-unknown");
    }

    const formattedCategory = formatCategoryName(category);
    // Use value.risk if available, otherwise show "undefined"
    const riskLevel = value && value.risk ? value.risk : "undefined";
    categoryItem.textContent = `${formattedCategory}: ${riskLevel}`;

    categoryList.appendChild(categoryItem);
  }

  assessmentDetails.appendChild(categoryList);
}

// Export functions for testing
export {
  isValidUrl,
  updateAssessmentDisplay,
  displayAssessment,
  formatCategoryName,
  checkPrivacyAssessment,
};

// Main initialization
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", async () => {
    // Get DOM elements
    const currentUrlElement = document.getElementById("current-url");
    const riskIndicator = document.getElementById("risk-indicator");
    const riskText = document.getElementById("risk-text");
    const assessmentDetails = document.getElementById("assessment-details");
    const refreshBtn = document.getElementById("refresh-btn");
    const activeToggle = document.getElementById("active-toggle");

    // Get current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    const currentUrl = currentTab.url;

    // Display current URL
    currentUrlElement.textContent = currentUrl;

    // Check if URL is valid for assessment
    if (!isValidUrl(currentUrl)) {
      updateAssessmentDisplay("invalid", "This page cannot be assessed");
      return;
    }

    // Get domain from URL
    const fullHostname = new URL(currentUrl).hostname;
    const domain = getNormalizedDomain(fullHostname);
    console.log(
      `[PrivacyGuard] URL: ${currentUrl}, Hostname: ${fullHostname}, Normalized Domain: ${domain}`
    );

    // Load plugin state from storage
    const storageData = await chrome.storage.local.get(["pluginActive"]);
    const pluginActive = storageData.pluginActive !== false; // Default to true
    activeToggle.checked = pluginActive;

    // If plugin is not active, show inactive state
    if (!pluginActive) {
      updateAssessmentDisplay("inactive", "Plugin is inactive");
      return;
    }

    // Load assessment data from storage
    const assessmentData = await chrome.storage.local.get([domain]);

    if (assessmentData[domain]) {
      // Display assessment data
      displayAssessment(assessmentData[domain]);
    } else {
      // No assessment available
      updateAssessmentDisplay("unknown", "No assessment available");
    }

    // Event Listeners

    // Refresh button
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.textContent = "Refreshing...";
      refreshBtn.disabled = true;

      try {
        // Force a new assessment check
        await checkPrivacyAssessment(currentUrl, currentTab.id);

        // Reload assessment data from storage
        const newAssessmentData = await chrome.storage.local.get([domain]);

        if (newAssessmentData[domain]) {
          // Display updated assessment data
          displayAssessment(newAssessmentData[domain]);
        } else {
          // Still no assessment available
          updateAssessmentDisplay("unknown", "No assessment available");
        }
      } catch (error) {
        console.error("Error refreshing assessment:", error);
        updateAssessmentDisplay("error", "Error refreshing assessment");
      } finally {
        refreshBtn.textContent = "Refresh Assessment";
        refreshBtn.disabled = false;
      }
    });

    // Active toggle
    activeToggle.addEventListener("change", async () => {
      const isActive = activeToggle.checked;

      // Save plugin state to storage
      await chrome.storage.local.set({ pluginActive: isActive });

      if (isActive) {
        try {
          // If turning on, check for assessment
          const assessment = await checkPrivacyAssessment(
            currentUrl,
            currentTab.id
          );

          // Reload assessment data from storage
          const newAssessmentData = await chrome.storage.local.get([domain]);

          if (newAssessmentData[domain]) {
            // Display assessment data
            displayAssessment(newAssessmentData[domain]);
          } else {
            // No assessment available
            updateAssessmentDisplay("unknown", "No assessment available");
          }
        } catch (error) {
          console.error("Error activating plugin:", error);
          updateAssessmentDisplay("error", "Error activating plugin");
        }
      } else {
        // If turning off, show inactive state
        updateAssessmentDisplay("inactive", "Plugin is inactive");
      }
    });
  });
}

// Update the extension badge based on risk level
function updateBadge(tabId, riskLevel) {
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
    console.error(`[PrivacyGuard] Unexpected risk level structure:`, riskLevel);
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

// Query the service layer for privacy assessment (similar to background.js)
async function checkPrivacyAssessment(url, tabId) {
  const API_BASE_URL = "http://localhost:3000/api"; // Should match background.js

  try {
    // Extract domain from URL for assessment lookup
    const fullHostname = new URL(url).hostname;
    const domain = getNormalizedDomain(fullHostname);
    console.log(
      `[PrivacyGuard] Checking assessment for domain: ${fullHostname}, Normalized: ${domain}`
    );

    // Query the backend service
    console.log(
      `[PrivacyGuard] Fetching from: ${API_BASE_URL}/assessment?url=${encodeURIComponent(
        domain
      )}`
    );
    const response = await fetch(
      `${API_BASE_URL}/assessment?url=${encodeURIComponent(domain)}`
    );
    const data = await response.json();
    console.log(`[PrivacyGuard] Assessment API response:`, data);

    if (data.status === "success") {
      if (data.assessment) {
        console.log(
          `[PrivacyGuard] Assessment found with risk level: ${data.assessment.riskLevel}`
        );
        // Assessment exists, update badge and store data
        updateBadge(tabId, data.assessment.riskLevel);

        // Store assessment data for popup
        await chrome.storage.local.set({ [domain]: data.assessment });
        console.log(`[PrivacyGuard] Assessment stored in local storage`);
        return data.assessment;
      } else {
        console.log(
          `[PrivacyGuard] No assessment available for ${domain}, reporting as unassessed`
        );
        // No assessment available
        updateBadge(tabId, "unknown");

        // Report URL for future assessment
        console.log(`[PrivacyGuard] Reporting ${domain} as unassessed`);
        const reportResponse = await fetch(
          `${API_BASE_URL}/report-unassessed`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ url: domain }),
          }
        );
        const reportData = await reportResponse.json();
        console.log(`[PrivacyGuard] Report unassessed response:`, reportData);

        // Immediately trigger assessment for this URL
        try {
          console.log(
            `[PrivacyGuard] Triggering immediate assessment for ${domain}`
          );
          const triggerResponse = await fetch(
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
            `[PrivacyGuard] Trigger assessment response:`,
            triggerData
          );

          if (triggerData.status === "success" && triggerData.assessment) {
            console.log(
              `[PrivacyGuard] Immediate assessment successful with risk level: ${triggerData.assessment.riskLevel}`
            );
            // Update badge and store data with the new assessment
            updateBadge(tabId, triggerData.assessment.riskLevel);
            await chrome.storage.local.set({
              [domain]: triggerData.assessment,
            });
            console.log(
              `[PrivacyGuard] Immediate assessment stored in local storage`
            );
            return triggerData.assessment;
          } else {
            console.log(
              `[PrivacyGuard] Immediate assessment did not return an assessment object`
            );
          }
        } catch (triggerError) {
          console.error(
            "[PrivacyGuard] Error triggering assessment:",
            triggerError
          );
        }

        return null;
      }
    } else {
      console.error(`[PrivacyGuard] Error in API response:`, data);
      // Error in API response
      updateBadge(tabId, "error");
      return null;
    }
  } catch (error) {
    console.error("[PrivacyGuard] Error checking privacy assessment:", error);
    updateBadge(tabId, "error");
    return null;
  }
}
