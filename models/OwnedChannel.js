const { model, Schema } = require('mongoose');

const viewSnapshotSchema = new Schema({
    id: { type: String, required: true },
    // 0 = role overwrite, 1 = member overwrite (discord.js OverwriteType)
    type: { type: Number, required: true, enum: [0, 1] },
    // -1 = denied, 0 = inherited/neutral, 1 = allowed
    view: { type: Number, required: true, enum: [-1, 0, 1] },
}, { _id: false });

/**
 * Channel ownership registry: one personal channel per user across this database.
 * userId and channelId are both unique (1:1 mapping).
 *
 * viewSnapshots stores the first ViewChannel value seen for every
 * role/member the feature has changed. Unrelated permission bits are
 * never stored here; they are copied from the live channel on each update.
 */
const ownedChannelSchema = new Schema({
    userId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true, index: true },
    locked: { type: Boolean, default: false },
    whitelist: { type: [String], default: [] },
    blacklist: { type: [String], default: [] },
    viewSnapshots: { type: [viewSnapshotSchema], default: [] },
}, { versionKey: false });

module.exports = model('OwnedChannel', ownedChannelSchema);
