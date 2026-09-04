const { Schema, model } = require('mongoose');

const ChatSchema = new Schema(
  {
    sessionId: { type: String, index: true, default: 'default' },
    chatId: { type: String, required: true, unique: true, index: true },
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
    profilePicUrl: String,
  },
  { timestamps: true }
);

module.exports = model('WaChat', ChatSchema);
