const jwt = require("jsonwebtoken");
const User = require("../models/User");

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }
  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    return parts[1];
  }
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        message: "Authentication required. Please provide a valid bearer token.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "Authentication service misconfiguration.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        message: "Invalid or expired authentication token.",
      });
    }

    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        message: "Malformed authentication token.",
      });
    }

    const user = await User.findById(decoded.userId).select("_id name email role");
    if (!user) {
      return res.status(401).json({
        message: "User session no longer valid.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({
      message: "An error occurred during authentication verification.",
    });
  }
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.user && req.user.role === "admin") {
      return next();
    }
    return res.status(403).json({
      message: "Admin access required. You do not have permission to access this resource.",
    });
  });
}

module.exports = {
  requireAuth,
  requireAdmin,
};

