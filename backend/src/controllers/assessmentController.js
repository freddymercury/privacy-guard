// Assessment Controller for PrivacyGuard backend

const db = require("../utils/db");
const llmService = require("../services/llmService");

/**
 * Get privacy assessment for a URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAssessment = async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL parameter is required",
      });
    }

    // Get assessment from database
    const assessment = await db.getAssessment(url);

    if (assessment) {
      // Assessment exists
      return res.status(200).json({
        status: "success",
        assessment: {
          url: assessment.url,
          riskLevel: assessment.privacy_assessment.riskLevel,
          categories: assessment.privacy_assessment.categories,
          summary: assessment.privacy_assessment.summary,
          lastUpdated: assessment.last_updated,
        },
      });
    } else {
      // No assessment available
      return res.status(200).json({
        status: "success",
        assessment: null,
      });
    }
  } catch (error) {
    console.error("Error getting assessment:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to get assessment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Trigger a new assessment for a URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const triggerAssessment = async (req, res) => {
  try {
    const { url } = req.params;
    const { manualText } = req.body;

    console.log(`[AssessmentController] Triggering assessment for URL: ${url}`);

    if (!url) {
      console.log(`[AssessmentController] Error: URL parameter is missing`);
      return res.status(400).json({
        status: "error",
        message: "URL parameter is required",
      });
    }

    // If manual text is provided, use the original method
    if (manualText) {
      console.log(`[AssessmentController] Using manually provided text`);
      // Use manually provided text
      const agreementData = {
        text: manualText,
        hash: llmService.computeTextHash(manualText),
        url: url,
      };

      // Assess privacy policy
      console.log(
        `[AssessmentController] Assessing privacy policy for ${url} (text length: ${agreementData.text.length} chars)`
      );
      const assessment = await llmService.assessPrivacyPolicy(
        agreementData.text,
        url // Pass the domain/URL for better logging
      );
      console.log(
        `[AssessmentController] Assessment complete with risk level: ${assessment.riskLevel}`
      );

      // Save assessment to database
      console.log(
        `[AssessmentController] Saving assessment to database for URL: ${url}`
      );
      const savedAssessment = await db.upsertAssessment({
        url: url,
        user_agreement_url: agreementData.url,
        user_agreement_hash: agreementData.hash,
        privacy_assessment: assessment,
        last_updated: new Date().toISOString(),
        manual_entry: true,
      });
      console.log(`[AssessmentController] Assessment saved successfully`);

      // Create audit log entry
      const source = req.originalUrl.startsWith("/api/")
        ? "chrome_plugin"
        : "admin_dashboard";
      console.log(
        `[AssessmentController] Creating audit log entry (source: ${source})`
      );
      await db.createAuditLog({
        action: "assessment_triggered",
        user_id: req.session?.user?.id || null,
        details: {
          url,
          manual: true,
          result: assessment.riskLevel,
          source: source,
        },
      });

      // If URL was in unassessed queue, update its status
      console.log(
        `[AssessmentController] Updating unassessed queue status for URL: ${url}`
      );
      await db.updateUnassessedStatus(url, "Completed");

      console.log(
        `[AssessmentController] Assessment process complete, returning results`
      );
      return res.status(200).json({
        status: "success",
        assessment: {
          url: savedAssessment.url,
          riskLevel: savedAssessment.privacy_assessment.riskLevel,
          categories: savedAssessment.privacy_assessment.categories,
          summary: savedAssessment.privacy_assessment.summary,
          lastUpdated: savedAssessment.last_updated,
        },
      });
    } else {
      // For Chrome plugin or other automated triggers, use the new single URL processing
      console.log(
        `[AssessmentController] Using single URL processing for: ${url}`
      );

      // Import the assessment trigger service
      const assessmentTriggerService = require("../services/assessmentTriggerService");

      // Process the single URL without batch processing
      const result = await assessmentTriggerService.processSingleUrl(url);

      if (result.success) {
        console.log(
          `[AssessmentController] Single URL processing successful for: ${url}`
        );

        // Get the assessment from the database
        const assessment = await db.getAssessment(url);

        if (assessment) {
          return res.status(200).json({
            status: "success",
            assessment: {
              url: assessment.url,
              riskLevel: assessment.privacy_assessment.riskLevel,
              categories: assessment.privacy_assessment.categories,
              summary: assessment.privacy_assessment.summary,
              lastUpdated: assessment.last_updated,
            },
          });
        } else {
          return res.status(404).json({
            status: "error",
            message: "Assessment not found after processing",
          });
        }
      } else {
        console.log(
          `[AssessmentController] Single URL processing failed for: ${url}`
        );
        return res.status(500).json({
          status: "error",
          message: `Failed to process URL: ${result.status}`,
          details: result,
        });
      }
    }
  } catch (error) {
    console.error("[AssessmentController] Error triggering assessment:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to trigger assessment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update an existing assessment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateAssessment = async (req, res) => {
  try {
    const { url } = req.params;
    const { assessment } = req.body;

    if (!url || !assessment) {
      return res.status(400).json({
        status: "error",
        message: "URL and assessment are required",
      });
    }

    // Get existing assessment
    const existingAssessment = await db.getAssessment(url);

    if (!existingAssessment) {
      return res.status(404).json({
        status: "error",
        message: "Assessment not found",
      });
    }

    // Update assessment
    const updatedAssessment = await db.upsertAssessment({
      ...existingAssessment,
      privacy_assessment: {
        ...assessment,
        // Preserve any fields not provided in the update
        ...existingAssessment.privacy_assessment,
      },
      last_updated: new Date().toISOString(),
      manual_entry: true, // Mark as manually edited
    });

    // Create audit log entry
    await db.createAuditLog({
      action: "assessment_updated",
      user_id: req.session?.user?.id || null,
      details: {
        url,
        result: assessment.riskLevel,
      },
    });

    return res.status(200).json({
      status: "success",
      assessment: {
        url: updatedAssessment.url,
        riskLevel: updatedAssessment.privacy_assessment.riskLevel,
        categories: updatedAssessment.privacy_assessment.categories,
        summary: updatedAssessment.privacy_assessment.summary,
        lastUpdated: updatedAssessment.last_updated,
      },
    });
  } catch (error) {
    console.error("Error updating assessment:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to update assessment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete an assessment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteAssessment = async (req, res) => {
  try {
    const { url } = req.params;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL parameter is required",
      });
    }

    // Delete assessment from database
    await db.supabase.from("websites").delete().eq("url", url);

    // Create audit log entry
    await db.createAuditLog({
      action: "assessment_deleted",
      user_id: req.session?.user?.id || null,
      details: { url },
    });

    return res.status(200).json({
      status: "success",
      message: "Assessment deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting assessment:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to delete assessment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  getAssessment,
  triggerAssessment,
  updateAssessment,
  deleteAssessment,
};
