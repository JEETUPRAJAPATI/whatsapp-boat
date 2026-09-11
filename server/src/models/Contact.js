const { Schema, model } = require('mongoose');

const ContactSchema = new Schema(
  {
    sessionId: { type: String, index: true, default: 'default' },
    contactId: { type: String, required: true, index: true },
    number: String,
    name: String,
    pushname: String,
    shortName: String,
    isMe: { type: Boolean, default: false },
    isUser: { type: Boolean, default: true },
    isGroup: { type: Boolean, default: false },
    isMyContact: { type: Boolean, default: false },
    isBusiness: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    profilePicUrl: String,
    about: String,
  },
  { timestamps: true }
);

ContactSchema.index({ sessionId: 1, contactId: 1 }, { unique: true });
ContactSchema.index({ name: 'text', pushname: 'text', number: 'text' });

module.exports = model('WaContact', ContactSchema);
