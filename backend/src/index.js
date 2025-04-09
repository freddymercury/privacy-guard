// Main entry point for PrivacyGuard backend

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const session = require("express-session");

// Import routes
const apiRoutes = require("./api");
const adminRoutes = require("./api/admin");

// Import services
const assessmentTriggerService = require("./services/assessmentTriggerService");

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "privacy-guard-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Static files for admin dashboard
app.use(express.static(path.join(__dirname, "public")));

// View engine setup for admin dashboard
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Routes
app.use("/api", apiRoutes);
app.use("/admin", adminRoutes);

// Admin dashboard home route
app.get("/", (req, res) => {
  res.redirect("/admin");
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: "error",
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`PrivacyGuard backend server running on port ${PORT}`);

  // Initialize assessment trigger service
  const intervalMinutes =
    process.env.ASSESSMENT_TRIGGER_INTERVAL_MINUTES || 600; // Changed from 60 to 600 (10 hours)
  console.log(
    `Initializing assessment trigger service with interval: ${intervalMinutes} minutes`
  );
  assessmentTriggerService.scheduleProcessing(parseInt(intervalMinutes));
});

module.exports = app; // Export for testing
