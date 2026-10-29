const express = require("express");

const router = express.Router();

// SCMS-F-003 / SCMS-US-003: Log out an authenticated user
router.post("/logout", (req, res) => {
  // In JWT token authentication, logout is managed client-side by clearing session/token.
  // The API provides an endpoint to signal logout completion.
  return res.status(200).json({
    message: "Logged out successfully.",
  });
});

module.exports = router;

