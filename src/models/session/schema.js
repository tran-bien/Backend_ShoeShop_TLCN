const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    token: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
      default: "Unknown",
    },
    ip: {
      type: String,
      default: "Unknown",
    },
    device: {
      type: Object,
      default: {},
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

SessionSchema.index({ user: 1 });
SessionSchema.index({ token: 1 });
SessionSchema.index({ refreshToken: 1 });
SessionSchema.index({ expiresAt: 1 });

module.exports = SessionSchema;
