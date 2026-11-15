import { model, Schema } from 'mongoose';
import type { GiveawayRecord, GiveawayStore } from '../features/giveaways/service';

const entrySchema = new Schema({
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    messageId: { type: String, required: true },
}, { _id: false });
const requirementSchema = new Schema({
    type: { type: String, enum: ['none', 'guild', 'role'], required: true },
    id: { type: String },
}, { _id: false });
export const giveawaySchema = new Schema<GiveawayRecord>({
    message: { type: String, required: true, index: true },
    prize: { type: String, required: true },
    started: { type: Number, required: true },
    entry: { type: [entrySchema], default: [] },
    entered: { type: Number, default: 0 },
    winCount: { type: Number, required: true },
    requirements: { type: requirementSchema, default: () => ({ type: 'none' }) },
    endTime: { type: String, default: null },
    host: { type: String, required: true },
    description: { type: String, default: '' },
    embeds: { type: Schema.Types.Mixed },
    guildId: { type: String },
    channelId: { type: String },
    completed: { type: Boolean },
    winners: { type: [String], default: undefined },
    pendingPublish: { type: Boolean },
}, { versionKey: false, bufferCommands: false, collection: 'giveaway-systems' });
export const Giveaway = model<GiveawayRecord>('Giveaway-System', giveawaySchema);

export function createMongooseGiveawayStore(): GiveawayStore {
    return {
        async list() { return Giveaway.find().select('-_id -__v').lean<GiveawayRecord[]>().exec(); },
        async get(messageId) { return Giveaway.findOne({ message: messageId }).select('-_id -__v').lean<GiveawayRecord | null>().exec(); },
        async insert(record) { await Giveaway.create(record); },
        async save(record) {
            // Do not replace documents: older deployments may have persisted additional fields.
            const result = await Giveaway.updateOne({ message: record.message }, { $set: record }, { runValidators: true }).exec();
            if (result.matchedCount !== 1) throw new Error(`Giveaway ${record.message} no longer exists in the database.`);
        },
    };
}
