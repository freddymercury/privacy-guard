// Admin Controller for PrivacyGuard admin dashboard

const db = require("../utils/db");
const llmService = require("../services/llmService");
const assessmentTriggerService = require("../services/assessmentTriggerService");
const axios = require("axios");

/**
 * Render admin dashboard home page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const dashboard = async (req, res) => {
  try {
    // Get counts for dashboard
    const { data: websites, error: websitesError } = await db.supabase
      .from("websites")
      .select("privacy_assessment->riskLevel", { count: "exact" });

    if (websitesError) {
      throw websitesError;
    }

    // Count by risk level
    const riskCounts = {
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    };

    websites.forEach((website) => {
      const riskLevel =
        website.privacy_assessment?.riskLevel?.toLowerCase() || "unknown";
      if (riskCounts.hasOwnProperty(riskLevel)) {
        riskCounts[riskLevel]++;
      } else {
        riskCounts.unknown++;
      }
    });

    // Get unassessed URLs count
    const { count: unassessedCount, error: unassessedError } = await db.supabase
      .from("unassessed_urls")
      .select("*", { count: "exact", head: true });

    if (unassessedError) {
      throw unassessedError;
    }

    // Get recent assessments
    const { data: recentAssessments, error: recentError } = await db.supabase
      .from("websites")
      .select("url, privacy_assessment->riskLevel, last_updated")
      .order("last_updated", { ascending: false })
      .limit(5);

    if (recentError) {
      throw recentError;
    }

    // Get recent audit logs
    const { data: recentLogs, error: logsError } = await db.supabase
      .from("audit_logs")
      .select("action, user_id, timestamp, details")
      .order("timestamp", { ascending: false })
      .limit(10);

    if (logsError) {
      throw logsError;
    }

    // Render dashboard
    res.render("dashboard", {
      title: "PrivacyGuard Admin - Dashboard",
      user: req.session.user,
      stats: {
        total: websites.length,
        riskCounts,
        unassessedCount,
      },
      recentAssessments,
      recentLogs,
    });
  } catch (error) {
    console.error("Error rendering dashboard:", error);
    res.render("error", {
      title: "Error",
      message: "Failed to load dashboard",
      error: process.env.NODE_ENV === "development" ? error : {},
    });
  }
};

/**
 * List all assessments
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const listAssessments = async (req, res) => {
  try {
    const { search, riskLevel, sort, order, page = 1, limit = 20 } = req.query;

    // Build query
    let query = db.supabase
      .from("websites")
      .select(
        "url, privacy_assessment->riskLevel, last_updated, manual_entry",
        { count: "exact" }
      );

    // Apply filters
    if (search) {
      query = query.ilike("url", `%${search}%`);
    }

    if (riskLevel && riskLevel !== "all") {
      query = query.eq("privacy_assessment->riskLevel", riskLevel);
    }

    // Apply sorting
    const validSortFields = ["url", "last_updated"];
    const sortField = validSortFields.includes(sort) ? sort : "last_updated";
    const sortOrder = order === "asc" ? true : false;

    query = query.order(sortField, { ascending: sortOrder });

    // Apply pagination
    const pageSize = parseInt(limit);
    const offset = (parseInt(page) - 1) * pageSize;

    query = query.range(offset, offset + pageSize - 1);

    // Execute query
    const { data: assessments, count, error } = await query;

    if (error) {
      throw error;
    }

    // Calculate pagination info
    const totalPages = Math.ceil(count / pageSize);

    // Render assessments page
    res.render("assessments", {
      title: "PrivacyGuard Admin - Assessments",
      user: req.session.user,
      assessments,
      pagination: {
        page: parseInt(page),
        limit: pageSize,
        totalItems: count,
        totalPages,
      },
      filters: {
        search,
        riskLevel,
        sort: sortField,
        order: sortOrder ? "asc" : "desc",
      },
    });
  } catch (error) {
    console.error("Error listing assessments:", error);
    res.render("error", {
      title: "Error",
      message: "Failed to list assessments",
      error: process.env.NODE_ENV === "development" ? error : {},
    });
  }
};

/**
 * View a single assessment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const viewAssessment = async (req, res) => {
  try {
    const { url } = req.params;

    if (!url) {
      return res.status(400).render("error", {
        title: "Error",
        message: "URL parameter is required",
      });
    }

    // Get assessment from database
    const assessment = await db.getAssessment(url);

    if (!assessment) {
      return res.status(404).render("error", {
        title: "Error",
        message: "Assessment not found",
      });
    }

    // Render assessment page
    res.render("assessment-detail", {
      title: `PrivacyGuard Admin - ${url}`,
      user: req.session.user,
      assessment: {
        url: assessment.url,
        userAgreementUrl: assessment.user_agreement_url,
        userAgreementHash: assessment.user_agreement_hash,
        riskLevel: assessment.privacy_assessment.riskLevel,
        categories: assessment.privacy_assessment.categories,
        summary: assessment.privacy_assessment.summary,
        lastUpdated: assessment.last_updated,
        manualEntry: assessment.manual_entry,
      },
    });
  } catch (error) {
    console.error("Error viewing assessment:", error);
    res.render("error", {
      title: "Error",
      message: "Failed to view assessment",
      error: process.env.NODE_ENV === "development" ? error : {},
    });
  }
};

/**
 * List unassessed URLs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const listUnassessed = async (req, res) => {
  try {
    const { status, sort, order, page = 1, limit = 20 } = req.query;

    // Build query
    let query = db.supabase
      .from("unassessed_urls")
      .select("*", { count: "exact" });

    // Apply filters
    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    // Apply sorting
    const validSortFields = ["url", "first_recorded", "status"];
    const sortField = validSortFields.includes(sort) ? sort : "first_recorded";
    const sortOrder = order === "asc" ? true : false;

    query = query.order(sortField, { ascending: sortOrder });

    // Apply pagination
    const pageSize = parseInt(limit);
    const offset = (parseInt(page) - 1) * pageSize;

    query = query.range(offset, offset + pageSize - 1);

    // Execute query
    const { data: unassessedUrls, count, error } = await query;

    if (error) {
      throw error;
    }

    // Calculate pagination info
    const totalPages = Math.ceil(count / pageSize);

    // Render unassessed URLs page
    res.render("unassessed", {
      title: "PrivacyGuard Admin - Unassessed URLs",
      user: req.session.user,
      unassessedUrls,
      pagination: {
        page: parseInt(page),
        limit: pageSize,
        totalItems: count,
        totalPages,
      },
      filters: {
        status,
        sort: sortField,
        order: sortOrder ? "asc" : "desc",
      },
    });
  } catch (error) {
    console.error("Error listing unassessed URLs:", error);
    res.render("error", {
      title: "Error",
      message: "Failed to list unassessed URLs",
      error: process.env.NODE_ENV === "development" ? error : {},
    });
  }
};

/**
 * Process an unassessed URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const processUnassessed = async (req, res) => {
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
      user_id: req.session.user.id,
      details: { url },
    });

    // Trigger assessment (this would typically be done by a background job)
    // For demo purposes, we'll do it synchronously
    try {
      // Extract user agreement
      const agreementData = await llmService.extractUserAgreement(url);

      // Assess privacy policy
      const assessment = await llmService.assessPrivacyPolicy(
        agreementData.text
      );

      // Save assessment to database
      await db.upsertAssessment({
        url: url,
        user_agreement_url: agreementData.url,
        user_agreement_hash: agreementData.hash,
        privacy_assessment: assessment,
        last_updated: new Date().toISOString(),
        manual_entry: false,
      });

      // Update status to Completed
      await db.updateUnassessedStatus(url, "Completed");

      // Create audit log entry
      await db.createAuditLog({
        action: "assessment_completed",
        user_id: req.session.user.id,
        details: {
          url,
          result: assessment.riskLevel,
        },
      });

      return res.status(200).json({
        status: "success",
        message: "Assessment completed successfully",
        riskLevel: assessment.riskLevel,
      });
    } catch (assessmentError) {
      // Update status to Failed
      await db.updateUnassessedStatus(url, "Failed");

      // Create audit log entry
      await db.createAuditLog({
        action: "assessment_failed",
        user_id: req.session.user.id,
        details: {
          url,
          error: assessmentError.message,
        },
      });

      return res.status(500).json({
        status: "error",
        message: "Assessment failed",
        error:
          process.env.NODE_ENV === "development"
            ? assessmentError.message
            : undefined,
      });
    }
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
 * Delete an unassessed URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteUnassessed = async (req, res) => {
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
      user_id: req.session.user.id,
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
 * Show analytics page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const analytics = async (req, res) => {
  try {
    // Get all assessments for analytics using axios instead of fetch
    const { data: assessments, error } = await db.supabase
      .from("websites")
      .select("url, privacy_assessment, last_updated, manual_entry");

    if (error) {
      throw error;
    }

    // Process data for analytics
    const riskLevelCounts = {
      High: 0,
      Medium: 0,
      Low: 0,
      Unknown: 0,
    };

    const categoryCounts = {};

    // Initialize category counts
    llmService.PRIVACY_CATEGORIES.forEach((category) => {
      categoryCounts[category] = {
        High: 0,
        Medium: 0,
        Low: 0,
        Unknown: 0,
      };
    });

    // Count assessments by risk level and category
    assessments.forEach((assessment) => {
      const riskLevel = assessment.privacy_assessment?.riskLevel || "Unknown";
      riskLevelCounts[riskLevel] = (riskLevelCounts[riskLevel] || 0) + 1;

      // Count categories
      const categories = assessment.privacy_assessment?.categories || {};
      for (const [category, data] of Object.entries(categories)) {
        if (categoryCounts[category]) {
          const categoryRisk = data.risk || "Unknown";
          categoryCounts[category][categoryRisk] =
            (categoryCounts[category][categoryRisk] || 0) + 1;
        }
      }
    });

    // Get assessment counts by month
    const assessmentsByMonth = {};
    assessments.forEach((assessment) => {
      const date = new Date(assessment.last_updated);
      const monthYear = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;

      if (!assessmentsByMonth[monthYear]) {
        assessmentsByMonth[monthYear] = {
          total: 0,
          manual: 0,
          automatic: 0,
        };
      }

      assessmentsByMonth[monthYear].total++;
      if (assessment.manual_entry) {
        assessmentsByMonth[monthYear].manual++;
      } else {
        assessmentsByMonth[monthYear].automatic++;
      }
    });

    // Sort months chronologically
    const sortedMonths = Object.keys(assessmentsByMonth).sort();

    // Render analytics page
    res.render("analytics", {
      title: "PrivacyGuard Admin - Analytics",
      user: req.session.user,
      analytics: {
        totalAssessments: assessments.length,
        riskLevelCounts,
        categoryCounts,
        assessmentsByMonth: sortedMonths.map((month) => ({
          month,
          ...assessmentsByMonth[month],
        })),
      },
    });
  } catch (error) {
    console.error("Error showing analytics:", error);
    res.render("error", {
      title: "Error",
      message: "Failed to load analytics",
      error: process.env.NODE_ENV === "development" ? error : {},
    });
  }
};

/**
 * List users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const listUsers = async (req, res) => {
  try {
    // Check if user has admin role
    if (req.session.user.role !== "admin") {
      return res.status(403).render("error", {
        title: "Error",
        message: "Access denied. Admin privileges required.",
      });
    }

    // Get users from database
    const { data: users, error } = await db.supabase
      .from("users")
      .select("id, username, name, role, created_at, updated_at")
      .order("username");

    if (error) {
      throw error;
    }

    // Render users page
    res.render("users", {
      title: "PrivacyGuard Admin - Users",
      user: req.session.user,
      users,
    });
  } catch (error) {
    console.error("Error listing users:", error);
    res.render("error", {
      title: "Error",
      message: "Failed to list users",
      error: process.env.NODE_ENV === "development" ? error : {},
    });
  }
};

/**
 * Show audit logs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const auditLogs = async (req, res) => {
  try {
    const { action, user_id, page = 1, limit = 50 } = req.query;

    // Build query
    let query = db.supabase.from("audit_logs").select("*", { count: "exact" });

    // Apply filters
    if (action) {
      query = query.eq("action", action);
    }

    if (user_id) {
      query = query.eq("user_id", user_id);
    }

    // Apply sorting and pagination
    const pageSize = parseInt(limit);
    const offset = (parseInt(page) - 1) * pageSize;

    query = query
      .order("timestamp", { ascending: false })
      .range(offset, offset + pageSize - 1);

    // Execute query
    const { data: logs, count, error } = await query;

    if (error) {
      throw error;
    }

    // Get users for display
    const { data: users } = await db.supabase
      .from("users")
      .select("id, username, name");

    // Create user lookup map
    const userMap = {};
    users.forEach((user) => {
      userMap[user.id] = user;
    });

    // Calculate pagination info
    const totalPages = Math.ceil(count / pageSize);

    // Get unique actions for filter
    const { data: actions } = await db.supabase
      .from("audit_logs")
      .select("action")
      .order("action");

    const uniqueActions = [...new Set(actions.map((log) => log.action))];

    // Render audit logs page
    res.render("audit-logs", {
      title: "PrivacyGuard Admin - Audit Logs",
      user: req.session.user,
      logs,
      users,
      userMap,
      actions: uniqueActions,
      pagination: {
        page: parseInt(page),
        limit: pageSize,
        totalItems: count,
        totalPages,
      },
      filters: {
        action,
        user_id,
      },
    });
  } catch (error) {
    console.error("Error showing audit logs:", error);
    res.render("error", {
      title: "Error",
      message: "Failed to load audit logs",
      error: process.env.NODE_ENV === "development" ? error : {},
    });
  }
};

/**
 * Update an assessment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateAssessment = async (req, res) => {
  try {
    const { url } = req.params;
    const { riskLevel, summary, categories } = req.body;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL parameter is required",
      });
    }

    // Get existing assessment
    const assessment = await db.getAssessment(url);

    if (!assessment) {
      return res.status(404).json({
        status: "error",
        message: "Assessment not found",
      });
    }

    // Update assessment
    const updatedAssessment = {
      ...assessment,
      privacy_assessment: {
        ...assessment.privacy_assessment,
        riskLevel: riskLevel || assessment.privacy_assessment.riskLevel,
        summary: summary || assessment.privacy_assessment.summary,
        categories: categories || assessment.privacy_assessment.categories,
      },
      last_updated: new Date().toISOString(),
      manual_entry: true,
    };

    // Save to database
    await db.upsertAssessment(updatedAssessment);

    // Create audit log entry
    await db.createAuditLog({
      action: "assessment_updated",
      user_id: req.session.user.id,
      details: {
        url,
        riskLevel: updatedAssessment.privacy_assessment.riskLevel,
      },
    });

    return res.status(200).json({
      status: "success",
      message: "Assessment updated successfully",
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
 * Trigger a new assessment for an existing URL
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const triggerAssessment = async (req, res) => {
  try {
    const { url } = req.params;

    if (!url) {
      return res.status(400).json({
        status: "error",
        message: "URL parameter is required",
      });
    }

    // Create audit log entry
    await db.createAuditLog({
      action: "assessment_triggered",
      user_id: req.session.user.id,
      details: { url },
    });

    // Trigger assessment (this would typically be done by a background job)
    // For demo purposes, we'll do it synchronously
    try {
      // Extract user agreement
      const agreementData = await llmService.extractUserAgreement(url);

      // Assess privacy policy
      const assessment = await llmService.assessPrivacyPolicy(
        agreementData.text
      );

      // Save assessment to database
      await db.upsertAssessment({
        url: url,
        user_agreement_url: agreementData.url,
        user_agreement_hash: agreementData.hash,
        privacy_assessment: assessment,
        last_updated: new Date().toISOString(),
        manual_entry: false,
      });

      // Create audit log entry
      await db.createAuditLog({
        action: "assessment_completed",
        user_id: req.session.user.id,
        details: {
          url,
          result: assessment.riskLevel,
        },
      });

      return res.status(200).json({
        status: "success",
        message: "Assessment completed successfully",
        riskLevel: assessment.riskLevel,
      });
    } catch (assessmentError) {
      // Create audit log entry
      await db.createAuditLog({
        action: "assessment_failed",
        user_id: req.session.user.id,
        details: {
          url,
          error: assessmentError.message,
        },
      });

      return res.status(500).json({
        status: "error",
        message: "Assessment failed",
        error:
          process.env.NODE_ENV === "development"
            ? assessmentError.message
            : undefined,
      });
    }
  } catch (error) {
    console.error("Error triggering assessment:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to trigger assessment",
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
    await db.deleteAssessment(url);

    // Create audit log entry
    await db.createAuditLog({
      action: "assessment_deleted",
      user_id: req.session.user.id,
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

/**
 * Create a new user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createUser = async (req, res) => {
  try {
    // Check if user has admin role
    if (req.session.user.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Admin privileges required.",
      });
    }

    const { username, password, name, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "Username and password are required",
      });
    }

    // Check if username already exists
    const { data: existingUser, error: checkError } = await db.supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    if (existingUser) {
      return res.status(400).json({
        status: "error",
        message: "Username already exists",
      });
    }

    // Create user
    const bcrypt = require("bcrypt");
    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: newUser, error } = await db.supabase
      .from("users")
      .insert({
        username,
        password: hashedPassword,
        name: name || username,
        role: role || "user",
      })
      .select("id, username, name, role")
      .single();

    if (error) {
      throw error;
    }

    // Create audit log entry
    await db.createAuditLog({
      action: "user_created",
      user_id: req.session.user.id,
      details: {
        username: newUser.username,
        role: newUser.role,
      },
    });

    return res.status(201).json({
      status: "success",
      message: "User created successfully",
      user: newUser,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to create user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateUser = async (req, res) => {
  try {
    // Check if user has admin role
    if (req.session.user.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Admin privileges required.",
      });
    }

    const { id } = req.params;
    const { name, role, password } = req.body;

    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "User ID is required",
      });
    }

    // Check if user exists
    const { data: existingUser, error: checkError } = await db.supabase
      .from("users")
      .select("id, username")
      .eq("id", id)
      .single();

    if (checkError) {
      throw checkError;
    }

    if (!existingUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // Prepare update data
    const updateData = {};
    if (name) updateData.name = name;
    if (role) updateData.role = role;
    if (password) {
      const bcrypt = require("bcrypt");
      updateData.password = await bcrypt.hash(password, 10);
    }

    // Update user
    const { error } = await db.supabase
      .from("users")
      .update(updateData)
      .eq("id", id);

    if (error) {
      throw error;
    }

    // Create audit log entry
    await db.createAuditLog({
      action: "user_updated",
      user_id: req.session.user.id,
      details: {
        username: existingUser.username,
        updatedFields: Object.keys(updateData),
      },
    });

    return res.status(200).json({
      status: "success",
      message: "User updated successfully",
    });
  } catch (error) {
    console.error("Error updating user:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to update user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteUser = async (req, res) => {
  try {
    // Check if user has admin role
    if (req.session.user.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Access denied. Admin privileges required.",
      });
    }

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "User ID is required",
      });
    }

    // Prevent deleting self
    if (id === req.session.user.id) {
      return res.status(400).json({
        status: "error",
        message: "Cannot delete your own account",
      });
    }

    // Check if user exists
    const { data: existingUser, error: checkError } = await db.supabase
      .from("users")
      .select("username")
      .eq("id", id)
      .single();

    if (checkError) {
      throw checkError;
    }

    if (!existingUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // Delete user
    const { error } = await db.supabase.from("users").delete().eq("id", id);

    if (error) {
      throw error;
    }

    // Create audit log entry
    await db.createAuditLog({
      action: "user_deleted",
      user_id: req.session.user.id,
      details: {
        username: existingUser.username,
      },
    });

    return res.status(200).json({
      status: "success",
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to delete user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Trigger assessment process for all unassessed URLs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const triggerAllAssessments = async (req, res) => {
  try {
    // Create audit log entry
    await db.createAuditLog({
      action: "trigger_all_assessments",
      user_id: req.session.user.id,
      details: {
        initiatedBy: req.session.user.username,
      },
    });

    // Process all unassessed URLs
    const results = await assessmentTriggerService.processUnassessedUrls();

    return res.status(200).json({
      status: "success",
      message: "Assessment process triggered for all unassessed URLs",
      results,
    });
  } catch (error) {
    console.error("Error triggering assessment process:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to trigger assessment process",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  dashboard,
  listAssessments,
  viewAssessment,
  updateAssessment,
  triggerAssessment,
  deleteAssessment,
  listUnassessed,
  processUnassessed,
  deleteUnassessed,
  analytics,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  auditLogs,
  triggerAllAssessments,
};
