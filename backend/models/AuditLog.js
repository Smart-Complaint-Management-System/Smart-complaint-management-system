const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    administrator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    complaint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
      required: true,
      immutable: true,
    },

    action: {
      type: String,
      enum: [
        "RESOLUTION_ADDED",
        "RESOLUTION_UPDATED",
        "COMPLAINT_STATUS_CHANGED",
        "COMPLAINT_CLOSED",
      ],
      required: true,
      immutable: true,
    },

    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      immutable: true,
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  }
);

auditLogSchema.index({ complaint: 1, createdAt: -1 });
auditLogSchema.index({ administrator: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);