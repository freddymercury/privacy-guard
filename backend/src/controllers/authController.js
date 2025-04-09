// Authentication Controller for PrivacyGuard admin dashboard

const bcrypt = require("bcrypt");
const db = require("../utils/db");

/**
 * Render login page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const loginPage = (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.session && req.session.user) {
    return res.redirect("/admin");
  }

  // Render login page
  res.render("login", {
    title: "PrivacyGuard Admin - Login",
    error: req.query.error,
  });
};

/**
 * Handle login form submission
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.redirect(
        "/admin/login?error=Username+and+password+are+required"
      );
    }

    // Get user from database
    const user = await db.getUserByUsername(username);

    if (!user) {
      // Create audit log entry for failed login
      await db.createAuditLog({
        action: "login_failed",
        details: {
          username,
          reason: "User not found",
        },
      });

      return res.redirect("/admin/login?error=Invalid+username+or+password");
    }

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      // Create audit log entry for failed login
      await db.createAuditLog({
        action: "login_failed",
        details: {
          username,
          reason: "Invalid password",
        },
      });

      return res.redirect("/admin/login?error=Invalid+username+or+password");
    }

    // Create session
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
    };

    // Create audit log entry for successful login
    await db.createAuditLog({
      action: "login_success",
      user_id: user.id,
      details: {
        username,
      },
    });

    // Redirect to original URL or dashboard
    const returnTo = req.session.returnTo || "/admin";
    delete req.session.returnTo;

    res.redirect(returnTo);
  } catch (error) {
    console.error("Login error:", error);
    res.redirect("/admin/login?error=An+error+occurred+during+login");
  }
};

/**
 * Handle logout
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const logout = async (req, res) => {
  try {
    // Create audit log entry for logout
    if (req.session && req.session.user) {
      await db.createAuditLog({
        action: "logout",
        user_id: req.session.user.id,
        details: {
          username: req.session.user.username,
        },
      });
    }

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
      }
      res.redirect("/admin/login");
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.redirect("/admin");
  }
};

/**
 * Create a new user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createUser = async (req, res) => {
  try {
    const { username, password, name, role } = req.body;

    if (!username || !password || !name || !role) {
      return res.status(400).json({
        status: "error",
        message: "All fields are required",
      });
    }

    // Check if username already exists
    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({
        status: "error",
        message: "Username already exists",
      });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user in database
    const { data: user, error } = await db.supabase
      .from("users")
      .insert({
        username,
        password_hash: passwordHash,
        name,
        role,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Create audit log entry
    await db.createAuditLog({
      action: "user_created",
      user_id: req.session.user.id,
      details: {
        created_user_id: user.id,
        username,
        role,
      },
    });

    return res.status(201).json({
      status: "success",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        created_at: user.created_at,
      },
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
 * Update user password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updatePassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({
        status: "error",
        message: "All fields are required",
      });
    }

    // Get user from database
    const { data: user, error } = await db.supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // Check if current user is authorized (self or admin)
    if (req.session.user.id !== userId && req.session.user.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Not authorized to update this user",
      });
    }

    // Verify current password (only if updating own password)
    if (req.session.user.id === userId) {
      const passwordMatch = await bcrypt.compare(
        currentPassword,
        user.password_hash
      );
      if (!passwordMatch) {
        return res.status(400).json({
          status: "error",
          message: "Current password is incorrect",
        });
      }
    }

    // Hash new password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password in database
    const { error: updateError } = await db.supabase
      .from("users")
      .update({
        password_hash: passwordHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      throw updateError;
    }

    // Create audit log entry
    await db.createAuditLog({
      action: "password_updated",
      user_id: req.session.user.id,
      details: {
        target_user_id: userId,
      },
    });

    return res.status(200).json({
      status: "success",
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Error updating password:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to update password",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  loginPage,
  login,
  logout,
  createUser,
  updatePassword,
};
