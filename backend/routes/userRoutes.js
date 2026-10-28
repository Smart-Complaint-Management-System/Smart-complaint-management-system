const express = require("express");
const mongoose = require("mongoose");
const Complaint = require("../models/Complaint");
const { requireUser } = require("../middleware/authMiddleware");

const router = express.Router();

// Get complaints belonging only to the logged-in user
router.get("/complaints", requireUser, async (req, res) => {
  try {
    const complaints = await Complaint.find({
      submittedBy: req.user._id,
    }).sort({ createdAt: -1 });

    return res.status(200).json({ complaints });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to retrieve complaints.",
    });
  }
});

// Get one complaint only if it belongs to the logged-in user
router.get("/complaints/:id", requireUser, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid complaint ID.",
      });
    }

    const complaint = await Complaint.findOne({
      _id: id,
      submittedBy: req.user._id,
    });

    if (!complaint) {
      return res.status(404).json({
        message: "Complaint not found.",
      });
    }

    return res.status(200).json({ complaint });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to retrieve complaint details.",
    });
  }
});

module.exports = router;
