import { model, Schema } from 'mongoose';
import type { OwnershipRecord, ViewSnapshot } from '../features/channel-manager/types';

const viewSnapshotSchema = new Schema<ViewSnapshot>({
    id: { type: String, required: true },
    type: { type: Number, required: true, enum: [0, 1] },
    view: { type: Number, required: true, enum: [-1, 0, 1] },
}, { _id: false });

// Ownership is global across this database, not scoped to guildId.
export const ownedChannelSchema = new Schema<OwnershipRecord>({
    userId: { type: String, required: true, unique: true, index: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true, index: true },
    locked: { type: Boolean, default: false },
    whitelist: { type: [String], default: [] },
    blacklist: { type: [String], default: [] },
    viewSnapshots: { type: [viewSnapshotSchema], default: [] },
}, { versionKey: false, bufferCommands: false });

// Mongoose derives the existing ownedchannels collection from this model name.
export const OwnedChannel = model<OwnershipRecord>('OwnedChannel', ownedChannelSchema);
