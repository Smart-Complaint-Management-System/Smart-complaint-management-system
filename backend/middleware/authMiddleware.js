const jwt = require("jsonwebtoken");
const User = require("../models/User");

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }
  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer" && parts[1]) {
    return parts[1];
  }
  return null;
}

async function verifyTokenAndGetUser(req) {
  const token = extractToken(req);
  if (!token) {
    return { errorStatus: 401, errorMessage: "Authentication required." };
  }

  if (!process.env.JWT_SECRET) {
    return { errorStatus: 500, errorMessage: "Authentication service misconfiguration." };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return { errorStatus: 401, errorMessage: "Invalid or expired authentication token." };
  }

  if (!decoded || !decoded.userId) {
    return { errorStatus: 401, errorMessage: "Malformed authentication token." };
  }

  const user = await User.findById(decoded.userId).select("_id name email role");
  if (!user) {
    return { errorStatus: 401, errorMessage: "User session no longer valid." };
  }

  return { user };
}

async function requireAuth(req, res, next) {
  try {
    const result = await verifyTokenAndGetUser(req);
    if (result.errorStatus) {
      return res.status(result.errorStatus).json({ message: result.errorMessage });
    }

    req.user = result.user;
    next();
  } catch (error) {
    return res.status(500).json({
      message: "An error occurred during authentication verification.",
    });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const result = await verifyTokenAndGetUser(req);
    if (result.errorStatus) {
      return res.status(result.errorStatus).json({ message: result.errorMessage });
    }

    if (result.user.role !== "admin") {
      return res.status(403).json({
        message: "Admin access required.",
      });
    }

    req.user = result.user;
    next();
  } catch (error) {
    return res.status(500).json({
      message: "An error occurred during admin authorization.",
    });
  }
}

async function requireUser(req, res, next) {
  try {
    const result = await verifyTokenAndGetUser(req);
    if (result.errorStatus) {
      return res.status(result.errorStatus).json({ message: result.errorMessage });
    }

    if (result.user.role !== "user") {
      return res.status(403).json({
        message: "User access required.",
      });
    }

    req.user = result.user;
    next();
  } catch (error) {
    return res.status(500).json({
      message: "An error occurred during user authorization.",
    });
  }
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireUser,
};
