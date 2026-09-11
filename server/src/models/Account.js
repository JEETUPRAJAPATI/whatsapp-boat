const { Schema, model } = require('mongoose');

/**
 * One linked WhatsApp account. The row is what survives a server restart: the
 * manager reads it on boot and brings every account that was linked back up,
 * reusing the LocalAuth profile stored under .wwebjs_auth/<sessionId>.
 */
const AccountSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    label: { type: String, default: '' },
    // Last known identity, so the UI can name an account before it reconnects.
    number: String,
    pushname: String,
    wid: String,
    // 'linked' once a QR has been scanned successfully; 'pending' until then.
    linked: { type: Boolean, default: false },
    lastReadyAt: Date,
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = model('WaAccount', AccountSchema);
