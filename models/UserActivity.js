// models/UserActivity.js
const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  guildId: {
    type: String,
    required: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
});

// Compound index for faster lookups
userActivitySchema.index({ userId: 1, guildId: 1 }, { unique: true });

module.exports = mongoose.model('UserActivity', userActivitySchema);