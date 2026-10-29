const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const AuditLog = require("../models/AuditLog");
const { requireAdmin } = require("../middleware/authMiddleware");
const { generateToken, recordAudit } = require("../utils/helpers");

const router = express.Router();

const VALID_STATUSES = ["Submitted", "In Progress", "Resolved", "Closed"];

const NEXT_STATUS = {
  Submitted: "In Progress",
  "In Progress": "Resolved",
  Resolved: "Closed",
};

// SCMS-F-012 / SCMS-US-012: Authenticate an authorised administrator
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    // Must exist and have 'admin' role
    if (!user || user.role !== "admin") {
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
      message: "Admin login successful.",
      token,
      admin: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Admin login error:", error.message);
    return res.status(500).json({
      message: "An internal server error occurred during admin login.",
    });
  }
});

// SCMS-F-013 / SCMS-US-013: View all submitted complaints as administrator
router.get("/complaints", requireAdmin, async (req, res) => {
  try {
    const complaints = await Complaint.find()
      .sort({ createdAt: -1 })
      .populate("submittedBy", "name email");

    return res.status(200).json({
      count: complaints.length,
      complaints,
    });
  } catch (error) {
    console.error("Fetch all complaints error:", error.message);
    return res.status(500).json({
      message: "Failed to retrieve complaints.",
    });
  }
});

// SCMS-F-014 / SCMS-US-014: View details of a selected complaint
router.get("/complaints/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    let query;
    if (mongoose.isValidObjectId(id)) {
      query = { _id: id };
    } else {
      query = { complaintId: id };
    }

    const complaint = await Complaint.findOne(query).populate(
      "submittedBy",
      "name email"
    );

    if (!complaint) {
      return res.status(404).json({
        message: "Complaint not found.",
      });
    }

    return res.status(200).json({
      complaint,
    });
  } catch (error) {
    console.error("Fetch complaint detail error:", error.message);
    return res.status(500).json({
      message: "Failed to retrieve complaint details.",
    });
  }
});

// SCMS-F-016 / SCMS-US-016: Provide a resolution or response (ShivaSwaroop D S)
router.patch("/complaints/:id/resolution", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution } = req.body || {};

    let query;
    if (mongoose.isValidObjectId(id)) {
      query = { _id: id };
    } else {
      query = { complaintId: id };
    }

    const complaint = await Complaint.findOne(query);
    if (!complaint) {
      return res.status(404).json({
        message: "Complaint not found.",
      });
    }

    if (complaint.status === "Closed") {
      return res.status(400).json({
        message: "Closed complaints cannot be modified.",
      });
    }

    if (typeof resolution !== "string" || !resolution.trim()) {
      return res.status(400).json({
        message: "Resolution must be a non-empty string.",
      });
    }

    const trimmedResolution = resolution.trim();
    if (trimmedResolution.length > 2000) {
      return res.status(400).json({
        message: "Resolution must not exceed 2000 characters.",
      });
    }

    const action = complaint.resolution ? "RESOLUTION_UPDATED" : "RESOLUTION_ADDED";
    complaint.resolution = trimmedResolution;
    await complaint.save();

    // SCMS-SR-005: Audit recording
    await recordAudit({
      administrator: req.user._id,
      complaint: complaint._id,
      action,
      details: {
        resolutionLength: trimmedResolution.length,
      },
    });

    const updatedComplaint = await Complaint.findById(complaint._id).populate(
      "submittedBy",
      "name email"
    );

    return res.status(200).json({
      message: "Resolution saved successfully.",
      complaint: updatedComplaint,
    });
  } catch (error) {
    console.error("Save resolution error:", error.message);
    return res.status(500).json({
      message: "Failed to save complaint resolution.",
    });
  }
});

// SCMS-F-015 & SCMS-F-017: Update complaint status & Close complaint after resolution
router.patch("/complaints/:id/status", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    let query;
    if (mongoose.isValidObjectId(id)) {
      query = { _id: id };
    } else {
      query = { complaintId: id };
    }

    const complaint = await Complaint.findOne(query);
    if (!complaint) {
      return res.status(404).json({
        message: "Complaint not found.",
      });
    }

    const currentStatus = complaint.status;

    // Idempotent: repeating current status is accepted
    if (currentStatus === status) {
      const populated = await Complaint.findById(complaint._id).populate(
        "submittedBy",
        "name email"
      );
      return res.status(200).json({
        message: `Complaint is already in status '${status}'.`,
        complaint: populated,
      });
    }

    // Closed complaints cannot be reopened
    if (currentStatus === "Closed") {
      return res.status(400).json({
        message: "A closed complaint cannot be reopened or changed.",
      });
    }

    // Verify valid status workflow: Submitted -> In Progress -> Resolved -> Closed
    const expectedNext = NEXT_STATUS[currentStatus];
    if (status !== expectedNext) {
      return res.status(400).json({
        message: `Invalid status transition from '${currentStatus}' to '${status}'. Expected '${expectedNext}'.`,
      });
    }

    // SCMS-F-017: A saved resolution is required before moving to Resolved or Closed
    if (status === "Resolved" || status === "Closed") {
      if (!complaint.resolution || !complaint.resolution.trim()) {
        return res.status(400).json({
          message: "A resolution must be provided before resolving or closing a complaint.",
        });
      }
    }

    complaint.status = status;
    await complaint.save();

    // SCMS-SR-005: Audit recording
    const auditAction = status === "Closed" ? "COMPLAINT_CLOSED" : "COMPLAINT_STATUS_CHANGED";
    await recordAudit({
      administrator: req.user._id,
      complaint: complaint._id,
      action: auditAction,
      details: {
        previousStatus: currentStatus,
        newStatus: status,
      },
    });

    const updatedComplaint = await Complaint.findById(complaint._id).populate(
      "submittedBy",
      "name email"
    );

    return res.status(200).json({
      message: `Complaint status updated to '${status}'.`,
      complaint: updatedComplaint,
    });
  } catch (error) {
    console.error("Update status error:", error.message);
    return res.status(500).json({
      message: "Failed to update complaint status.",
    });
  }
});

// SCMS-SR-005: View audit logs for a complaint
router.get("/complaints/:id/audit-logs", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    let complaintId = id;
    if (!mongoose.isValidObjectId(id)) {
      const complaint = await Complaint.findOne({ complaintId: id });
      if (!complaint) {
        return res.status(404).json({ message: "Complaint not found." });
      }
      complaintId = complaint._id;
    }

    const auditLogs = await AuditLog.find({ complaint: complaintId })
      .sort({ createdAt: -1 })
      .populate("administrator", "name email");

    return res.status(200).json({
      count: auditLogs.length,
      auditLogs,
    });
  } catch (error) {
    console.error("Fetch audit logs error:", error.message);
    return res.status(500).json({
      message: "Failed to retrieve audit logs.",
    });
  }
});

module.exports = router;
