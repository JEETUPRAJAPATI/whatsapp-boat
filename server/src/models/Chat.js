const { Schema, model } = require('mongoose');

const ChatSchema = new Schema(
  {
    sessionId: { type: String, index: true, default: 'default' },
    chatId: { type: String, required: true, index: true },
    name: String,
    isGroup: { type: Boolean, default: false },
    isMuted: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    isReadOnly: { type: Boolean, default: false },
    unreadCount: { type: Number, default: 0 },
    timestamp: { type: Number, index: true },
    lastMessage: { type: Schema.Types.Mixed, default: null },
    participants: { type: [Schema.Types.Mixed], default: undefined },
    participantCount: { type: Number, default: 0 },
    profilePicUrl: String,
  },
  { timestamps: true }
);

ChatSchema.index({ sessionId: 1, chatId: 1 }, { unique: true });
ChatSchema.index({ sessionId: 1, timestamp: -1 });

module.exports = model('WaChat', ChatSchema);
