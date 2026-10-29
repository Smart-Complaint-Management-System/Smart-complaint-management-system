const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const authRoutes = require("./routes/authRoutes");
const complaintRoutes = require("./routes/complaintRoutes");
let adminRoutes;
try {
  adminRoutes = require("./routes/adminRoutes");
} catch {
  // Optional if adminRoutes not present
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

// Health checks
app.get("/api/health", (req, res) => {
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

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// Application Routes
app.use("/api/auth", authRoutes);
app.use("/api/complaints", complaintRoutes);
if (adminRoutes) {
  app.use("/api/admin", adminRoutes);
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
