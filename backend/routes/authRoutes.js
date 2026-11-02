const express = require("express");
const registerRoute = require("./auth/registerRoute");
const loginRoute = require("./auth/loginRoute");
const logoutRoute = require("./auth/logoutRoute");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

// Story-specific sub-routes:
// SCMS-F-001 / SCMS-US-001: User registration
router.use("/", registerRoute);

// SCMS-F-002 / SCMS-US-002: User authentication & login
router.use("/", loginRoute);

// SCMS-F-003 / SCMS-US-003: User logout
router.use("/", logoutRoute);

// Current user profile (shared authenticated route)
router.get("/me", requireAuth, (req, res) => {
  return res.status(200).json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

module.exports = router;
