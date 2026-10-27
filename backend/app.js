
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const adminRoutes = require("./routes/adminRoutes");

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

// Health check
app.get("/health", (req, res) => {
  res.json({
    server: "running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// Admin complaint management routes
app.use("/api/admin", adminRoutes);

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
