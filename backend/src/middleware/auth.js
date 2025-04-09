// Authentication middleware for PrivacyGuard admin dashboard

/**
 * Check if user is authenticated
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const isAuthenticated = (req, res, next) => {
  // Check if user is authenticated via session
  if (req.session && req.session.user) {
    return next();
  }

  // If not authenticated, redirect to login page
  // Store the original URL in the session to redirect after login
  req.session.returnTo = req.originalUrl;
  res.redirect("/admin/login");
};

/**
 * Check if user has admin role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const isAdmin = (req, res, next) => {
  // Check if user is authenticated and has admin role
  if (req.session && req.session.user && req.session.user.role === "admin") {
    return next();
  }

  // If not admin, return forbidden error
  res.status(403).json({
    status: "error",
    message: "Access denied. Admin privileges required.",
  });
};

module.exports = {
  isAuthenticated,
  isAdmin,
};
