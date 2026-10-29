const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const { generateToken } = require("../../utils/helpers");

const router = express.Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SCMS-F-001 / SCMS-US-001: Register a new user with required details
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        message: "Full name is required.",
      });
    }

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        message: "Email address is required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        message: "Please provide a valid email address.",
      });
    }

    if (typeof password !== "string" || !password) {
      return res.status(400).json({
        message: "Password is required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long.",
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    // SCMS-SR-003: Passwords hashed with bcrypt, never stored as plaintext
    const saltRounds = process.env.NODE_ENV === "test" ? 4 : 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "user", // Role is fixed to 'user' for public registration
    });

    const token = generateToken(user);

    return res.status(201).json({
      message: "User registered successfully.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Registration error:", error.message);
    return res.status(500).json({
      message: "An unexpected error occurred during registration.",
    });
  }
});

module.exports = router;

