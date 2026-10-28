const jwt = require("jsonwebtoken");
const AuditLog = require("../models/AuditLog");

function generateComplaintId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
  return `CMP-${timestamp}-${randomSuffix}`;
}

function generateToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(
    {
      userId: user._id.toString(),
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );
}

async function recordAudit({ administrator, complaint, action, details = {}, session = null }) {
  const payload = {
    administrator,
    complaint,
    action,
    details,
  };
  if (session) {
    return await AuditLog.create([payload], { session });
  }
  return await AuditLog.create(payload);
}

module.exports = {
  generateComplaintId,
  generateToken,
  recordAudit,
};

