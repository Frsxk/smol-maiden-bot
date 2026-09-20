const { model, Schema } = require('mongoose');

/**
 * Channel ownership registry — one personal channel per user.
 * userId and channelId are both unique (1:1 mapping).
 */
const ownedChannelSchema = new Schema({
    userId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true, index: true },
    locked: { type: Boolean, default: false },
    whitelist: { type: [String], default: [] },
    blacklist: { type: [String], default: [] },
}, { versionKey: false });

module.exports = model('OwnedChannel', ownedChannelSchema);
