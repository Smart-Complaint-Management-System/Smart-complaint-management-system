const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/User");
const Complaint = require("../models/Complaint");
const AuditLog = require("../models/AuditLog");
const { requireAdmin } = require("../middleware/authMiddleware");

const router = express.Router();
const NEXT_STATUS = {
  Submitted: "In Progress",
  "In Progress": "Resolved",
  Resolved: "Closed",
};

class RouteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function updateComplaintWithAudit(id, administrator, changeComplaint) {
  const session = await mongoose.startSession();
  let updatedComplaint;

  try {
    await session.withTransaction(async () => {
      const complaint = await Complaint.findById(id).session(session);

      if (!complaint) {
        throw new RouteError(404, "Complaint not found.");
      }

      const auditEvent = changeComplaint(complaint);

      if (auditEvent) {
        await complaint.save({ session });
        await AuditLog.create(
          [
            {
              administrator,
              complaint: complaint._id,
              ...auditEvent,
            },
          ],
          { session }
        );
      }

      updatedComplaint = complaint;
    });

    return updatedComplaint;
  } finally {
    await session.endSession();
  }
}

function sendRouteError(res, error, message, context) {
  if (error instanceof RouteError) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(`${context}:`, error.message);
  return res.status(500).json({ message });
}

// 1. Admin Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

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

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+password");

    if (!user || user.role !== "admin") {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "Authentication configuration error.",
      });
    }

    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

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
      message: "An internal server error occurred.",
    });
  }
});

// 2. View all complaints
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
    console.error("Fetch complaints error:", error.message);

    return res.status(500).json({
      message: "Failed to retrieve complaints.",
    });
  }
});

// 3. View one complaint's details
router.get("/complaints/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid complaint ID.",
      });
    }

    const complaint = await Complaint.findById(id)
      .populate("submittedBy", "name email");

    if (!complaint) {
      return res.status(404).json({
        message: "Complaint not found.",
      });
    }

    return res.status(200).json({ complaint });
  } catch (error) {
    console.error("Complaint details error:", error.message);

    return res.status(500).json({
      message: "Failed to retrieve complaint details.",
    });
  }
});

// 4. Add or update complaint resolution
router.patch(
  "/complaints/:id/resolution",
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const resolution = req.body?.resolution;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid complaint ID.",
        });
      }

      if (
        typeof resolution !== "string" ||
        !resolution.trim() ||
        resolution.trim().length > 2000
      ) {
        return res.status(400).json({
          message:
            "Resolution must contain between 1 and 2000 characters.",
        });
      }

      const resolutionText = resolution.trim();
      const complaint = await updateComplaintWithAudit(
        id,
        req.user._id,
        (currentComplaint) => {
          if (currentComplaint.status === "Closed") {
            throw new RouteError(
              409,
              "A closed complaint cannot be modified."
            );
          }

          const previousResolution = currentComplaint.resolution || "";
          currentComplaint.resolution = resolutionText;

          return {
            action: previousResolution
              ? "RESOLUTION_UPDATED"
              : "RESOLUTION_ADDED",
            details: {
              resolutionLength: resolutionText.length,
            },
          };
        }
      );

      return res.status(200).json({
        message: "Complaint resolution saved successfully.",
        complaint,
      });
    } catch (error) {
      return sendRouteError(
        res,
        error,
        "Failed to save complaint resolution.",
        "Save resolution error"
      );
    }
  }
);

// 5. Update complaint status
router.patch(
  "/complaints/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({
          message: "Invalid complaint ID.",
        });
      }

      const allowedStatuses = [
        "Submitted",
        "In Progress",
        "Resolved",
        "Closed",
      ];

      if (
        typeof status !== "string" ||
        !allowedStatuses.includes(status)
      ) {
        return res.status(400).json({
          message: "Invalid status.",
          allowedStatuses,
        });
      }

      const complaint = await updateComplaintWithAudit(
        id,
        req.user._id,
        (currentComplaint) => {
          if (status === currentComplaint.status) {
            return null;
          }

          if (
            status === "Closed" &&
            !currentComplaint.resolution?.trim()
          ) {
            throw new RouteError(
              400,
              "A complaint must have a resolution before closure."
            );
          }

          if (currentComplaint.status === "Closed") {
            throw new RouteError(
              409,
              "A closed complaint cannot be reopened."
            );
          }

          if (NEXT_STATUS[currentComplaint.status] !== status) {
            throw new RouteError(
              409,
              "Invalid status transition. Complaints must move through the defined workflow."
            );
          }

          if (
            status === "Resolved" &&
            !currentComplaint.resolution?.trim()
          ) {
            throw new RouteError(
              400,
              "A complaint must have a resolution before it can be resolved."
            );
          }

          const previousStatus = currentComplaint.status;
          currentComplaint.status = status;

          return {
            action:
              status === "Closed"
                ? "COMPLAINT_CLOSED"
                : "COMPLAINT_STATUS_CHANGED",
            details: {
              previousStatus,
              newStatus: status,
            },
          };
        }
      );

      await complaint.populate("submittedBy", "name email");

      return res.status(200).json({
        message: "Complaint status updated successfully.",
        complaint,
      });
    } catch (error) {
      return sendRouteError(
        res,
        error,
        "Failed to update complaint status.",
        "Update status error"
      );
    }
  }
);

module.exports = router;
