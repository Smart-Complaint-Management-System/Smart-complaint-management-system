
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const adminRoutes = require("./routes/adminRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Smart Complaint Management System API is running!"
  });
});

app.get("/health", (req, res) => {
  res.json({
    server: "running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected"
  });
});

app.use("/api/admin", adminRoutes);

module.exports = app;
