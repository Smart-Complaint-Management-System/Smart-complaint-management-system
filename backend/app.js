//import
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const authRoutes = require("./routes/authRoutes");
const complaintRoutes = require("./routes/complaintRoutes");
const adminRoutes = require("./routes/adminRoutes");
let userRoutes;
try {
  userRoutes = require("./routes/userRoutes");
} catch {
  // Optional user routes
}

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API home route
app.get("/", (req, res) => {
  res.json({
    message: "Smart Complaint Management System API is running!",
  });
});

// Health check endpoints (supports both /api/health and /health)
app.get(["/health", "/api/health"], (req, res) => {
  res.json({
    status: "ok",
    server: "running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// Application Routes
app.use("/api/auth", authRoutes);
app.use("/api/complaints", complaintRoutes);
app.use("/api/admin", adminRoutes);
if (userRoutes) {
  app.use("/api/user", userRoutes);
}

// Handle malformed JSON request bodies
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      message: "Invalid JSON request body.",
    });
  }

  next(err);
});

module.exports = app;
