const express = require("express");
const mongoose = require("mongoose");
const Complaint = require("../models/Complaint");
const AuditLog = require("../models/AuditLog");
const { requireAuth } = require("../middleware/authMiddleware");
const { generateComplaintId } = require("../utils/helpers");

const router = express.Router();

// SCMS-F-004, SCMS-F-005, SCMS-F-006, SCMS-F-007
// Dhruva Ganesh Hegde: Submit a complaint while authenticated
router.post("/", requireAuth, async (req, res) => {
  try {
    const { title, description, category } = req.body || {};

    // Validate mandatory fields
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({
        message: "Complaint title is required.",
      });
    }

    if (title.trim().length > 200) {
      return res.status(400).json({
        message: "Complaint title must not exceed 200 characters.",
      });
    }

    if (typeof description !== "string" || !description.trim()) {
      return res.status(400).json({
        message: "Complaint description is required.",
      });
    }

    if (description.trim().length > 5000) {
      return res.status(400).json({
        message: "Complaint description must not exceed 5000 characters.",
      });
    }

    if (typeof category !== "string" || !category.trim()) {
      return res.status(400).json({
        message: "Complaint category is required.",
      });
    }

    // SCMS-F-005: Generate unique complaint identifier server-side
    const complaintId = generateComplaintId();

    // SCMS-F-006: Persist complaint details reliably
    // Submitting user identity derived from verified token (req.user._id), not trusted from client
    const complaint = await Complaint.create({
      complaintId,
      submittedBy: req.user._id,
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      status: "Submitted",
      resolution: "",
    });

    return res.status(201).json({
      message: "Complaint submitted successfully.",
      complaint,
    });
  } catch (error) {
    console.error("Complaint submission error:", error.message);
    return res.status(500).json({
      message: "Failed to submit complaint.",
    });
  }
});

// SCMS-F-008 / SCMS-US-008
// Raksha: View complaints submitted by the current user
router.get("/", requireAuth, async (req, res) => {
  try {
    // Only return complaints submitted by the authenticated user
    const complaints = await Complaint.find({ submittedBy: req.user._id })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      count: complaints.length,
      complaints,
    });
  } catch (error) {
    console.error("Fetch user complaints error:", error.message);
    return res.status(500).json({
      message: "Failed to retrieve your complaints.",
    });
  }
});

// SCMS-F-009, SCMS-F-010, SCMS-F-011, SCMS-F-018, SCMS-SR-004
// Raksha & ShivaSwaroop: Track current status and details of a single complaint
router.get("/:id", requireAuth, async (req, res) => {
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

    // SCMS-SR-004: Prevent cross-user complaint access
    // Non-admin user can only access their own complaint
    const isOwner =
      complaint.submittedBy &&
      complaint.submittedBy._id.toString() === req.user._id.toString();

    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Access denied. You do not have permission to view this complaint.",
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

// SCMS-F-011 / SCMS-US-011: View updates and responses for a complaint (SCMS-16)
router.get("/:id/updates", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

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

    // SCMS-SR-004: Ownership check
    const isOwner =
      complaint.submittedBy &&
      complaint.submittedBy.toString() === req.user._id.toString();

    if (!isOwner && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Access denied. You do not have permission to view updates for this complaint.",
      });
    }

    // Retrieve saved audit logs / status changes / resolution responses in chronological order
    const updates = await AuditLog.find({ complaint: complaint._id })
      .sort({ createdAt: 1 })
      .populate("administrator", "name email");

    return res.status(200).json({
      complaintId: complaint.complaintId || complaint._id,
      currentStatus: complaint.status,
      resolution: complaint.resolution || "",
      count: updates.length,
      updates,
    });
  } catch (error) {
    console.error("Fetch complaint updates error:", error.message);
    return res.status(500).json({
      message: "Failed to retrieve complaint updates.",
    });
  }
});

module.exports = router;

