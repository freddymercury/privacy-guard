// API Routes for PrivacyGuard backend

const express = require("express");
const router = express.Router();

// Import controllers
const assessmentController = require("../controllers/assessmentController");
const unassessedController = require("../controllers/unassessedController");

/**
 * @route GET /api/assessment
 * @desc Get privacy assessment for a URL
 * @access Public
 */
router.get("/assessment", assessmentController.getAssessment);

/**
 * @route POST /api/report-unassessed
 * @desc Report an unassessed URL
 * @access Public
 */
router.post("/report-unassessed", unassessedController.reportUnassessed);

/**
 * @route POST /api/trigger-assessment/:url
 * @desc Trigger assessment for a specific URL
 * @access Public
 */
router.post("/trigger-assessment/:url", assessmentController.triggerAssessment);

/**
 * @route PUT /api/unassessed/:url/policy-urls
 * @desc Update suggested policy URLs for an unassessed URL
 * @access Private (Admin)
 */
router.put(
  "/unassessed/:url/policy-urls",
  unassessedController.updateSuggestedPolicyUrls
);

/**
 * @route GET /api/health
 * @desc Health check endpoint
 * @access Public
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "PrivacyGuard API is running",
  });
});

module.exports = router;
