// Unassessed URLs Controller for PrivacyGuard backend

const db = require("../utils/db");

/**
 * Report an unassessed URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const reportUnassessed = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL is required",
      });
    }

    // Check if URL already has an assessment
    const existingAssessment = await db.getAssessment(url);

    if (existingAssessment) {
      // URL already has an assessment, no need to add to queue
      return res.status(200).json({
        status: "success",
        message: "URL already has an assessment",
      });
    }

    // Add URL to unassessed queue
    await db.addToUnassessedQueue(url);

    return res.status(200).json({
      status: "success",
      message: "URL added to unassessed queue",
    });
  } catch (error) {
    console.error("Error reporting unassessed URL:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to report unassessed URL",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get unassessed URLs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUnassessedUrls = async (req, res) => {
  try {
    const { status, limit } = req.query;

    // Get unassessed URLs from database
    const unassessedUrls = await db.getUnassessedUrls(
      status,
      limit ? parseInt(limit) : undefined
    );

    return res.status(200).json({
      status: "success",
      count: unassessedUrls.length,
      urls: unassessedUrls,
    });
  } catch (error) {
    console.error("Error getting unassessed URLs:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to get unassessed URLs",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update status of an unassessed URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateUnassessedStatus = async (req, res) => {
  try {
    const { url } = req.params;
    const { status } = req.body;

    if (!url || !status) {
      return res.status(400).json({
        status: "error",
        message: "URL and status are required",
      });
    }

    // Validate status
    const validStatuses = ["Pending", "Processing", "Completed", "Failed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: "error",
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Update status
    const updatedEntry = await db.updateUnassessedStatus(url, status);

    // Create audit log entry
    await db.createAuditLog({
      action: "unassessed_status_updated",
      user_id: req.session?.user?.id || null,
      details: {
        url,
        status,
      },
    });

    return res.status(200).json({
      status: "success",
      url: updatedEntry,
    });
  } catch (error) {
    console.error("Error updating unassessed URL status:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to update unassessed URL status",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete an unassessed URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteUnassessedUrl = async (req, res) => {
  try {
    const { url } = req.params;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL parameter is required",
      });
    }

    // Remove URL from unassessed queue
    await db.removeFromUnassessedQueue(url);

    // Create audit log entry
    await db.createAuditLog({
      action: "unassessed_url_deleted",
      user_id: req.session?.user?.id || null,
      details: { url },
    });

    return res.status(200).json({
      status: "success",
      message: "URL removed from unassessed queue",
    });
  } catch (error) {
    console.error("Error deleting unassessed URL:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to delete unassessed URL",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Process an unassessed URL (trigger assessment)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processUnassessedUrl = async (req, res) => {
  try {
    const { url } = req.params;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL parameter is required",
      });
    }

    // Update status to Processing
    await db.updateUnassessedStatus(url, "Processing");

    // Create audit log entry
    await db.createAuditLog({
      action: "unassessed_url_processing",
      user_id: req.session?.user?.id || null,
      details: { url },
    });

    return res.status(200).json({
      status: "success",
      message: "URL processing started",
      url,
    });
  } catch (error) {
    console.error("Error processing unassessed URL:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to process unassessed URL",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update suggested policy URLs for an unassessed URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateSuggestedPolicyUrls = async (req, res) => {
  try {
    const { url } = req.params;
    const { policyUrls } = req.body;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL parameter is required",
      });
    }

    if (!Array.isArray(policyUrls)) {
      return res.status(400).json({
        status: "error",
        message: "policyUrls must be an array of strings",
      });
    }

    // Validate that all URLs are strings
    for (const policyUrl of policyUrls) {
      if (typeof policyUrl !== "string") {
        return res.status(400).json({
          status: "error",
          message: "All policy URLs must be strings",
        });
      }
    }

    // Update suggested policy URLs
    const updatedEntry = await db.updateSuggestedPolicyUrls(url, policyUrls);

    // Create audit log entry
    await db.createAuditLog({
      action: "suggested_policy_urls_updated",
      user_id: req.session?.user?.id || null,
      details: {
        url,
        policyUrls,
      },
    });

    return res.status(200).json({
      status: "success",
      url: updatedEntry,
    });
  } catch (error) {
    console.error("Error updating suggested policy URLs:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to update suggested policy URLs",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  reportUnassessed,
  getUnassessedUrls,
  updateUnassessedStatus,
  deleteUnassessedUrl,
  processUnassessedUrl,
  updateSuggestedPolicyUrls,
};
