const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const { generateToken } = require("../../utils/helpers");

const router = express.Router();

// SCMS-F-002 / SCMS-US-002: Authenticate a registered user
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Select password hash to compare
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) {
      // Return generic error message to avoid account enumeration
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      message: "Login successful.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      message: "An unexpected error occurred during login.",
    });
  }
});

module.exports = router;

