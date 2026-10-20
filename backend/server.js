
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const adminRoutes = require("./routes/adminRoutes");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Home route
app.get("/", (req, res) => {
  res.json({
    message: "Smart Complaint Management System API is running!",
  });
});

// Health check route
app.get("/health", (req, res) => {
  res.json({
    server: "running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

// Admin routes
app.use("/api/admin", adminRoutes);

// Start server after connecting to MongoDB
async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from the .env file.");
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing from the .env file.");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB Atlas connected successfully!");

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
