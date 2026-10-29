const mongoose = require("mongoose");

const complaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Submitting user is required"],
    },
    title: {
      type: String,
      required: [true, "Complaint title is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Complaint description is required"],
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Complaint category is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["Submitted", "In Progress", "Resolved", "Closed"],
      default: "Submitted",
    },
    resolution: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

complaintSchema.index({ submittedBy: 1, createdAt: -1 });
complaintSchema.index({ status: 1 });

module.exports = mongoose.model("Complaint", complaintSchema);
