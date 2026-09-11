const { Schema, model } = require('mongoose');

const MessageSchema = new Schema(
  {
    sessionId: { type: String, index: true, default: 'default' },
    msgId: { type: String, required: true, index: true },
    chatId: { type: String, required: true, index: true },
    from: String,
    to: String,
    author: String,
    fromMe: { type: Boolean, default: false },
    body: { type: String, default: '' },
    type: { type: String, default: 'chat' },
    timestamp: { type: Number, index: true },
    ack: { type: Number, default: 0 },
    hasMedia: { type: Boolean, default: false },
    mediaMime: String,
    mediaFilename: String,
    mediaPath: String,
    isForwarded: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    location: { type: Schema.Types.Mixed, default: null },
    vcards: { type: [String], default: undefined },
    quotedMsgId: String,
    quotedPreview: { type: Schema.Types.Mixed, default: null },
    mentionedIds: { type: [String], default: undefined },
    reactions: { type: [Schema.Types.Mixed], default: undefined },
    notifyName: String,
  },
  { timestamps: true }
);

// One account's copy of a message is independent of another's, so identity is
// the pair, never the message id alone.
MessageSchema.index({ sessionId: 1, msgId: 1 }, { unique: true });
MessageSchema.index({ sessionId: 1, chatId: 1, timestamp: -1 });
MessageSchema.index({ body: 'text' });

module.exports = model('WaMessage', MessageSchema);
