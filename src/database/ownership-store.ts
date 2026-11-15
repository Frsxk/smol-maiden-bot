import mongoose from 'mongoose';
import { OwnedChannel } from './owned-channel';
import type { ChannelState, OwnershipDocument, ViewSnapshot } from '../features/channel-manager/types';

export interface CreateOwnership extends Partial<ChannelState> {
    userId: string;
    guildId: string;
    channelId: string;
    viewSnapshots?: ViewSnapshot[];
}

export interface OwnershipStore {
    isReady(): boolean;
    findByUser(userId: string): Promise<OwnershipDocument | null>;
    findByChannel(channelId: string): Promise<OwnershipDocument | null>;
    create(record: CreateOwnership): Promise<OwnershipDocument>;
    deleteByChannel(channelId: string): Promise<void>;
    save(document: OwnershipDocument): Promise<void>;
}

function requireReady(): void {
    if (OwnedChannel.db.readyState !== mongoose.ConnectionStates.connected) throw new Error('Channel registry is unavailable.');
}

export const ownershipStore: OwnershipStore = {
    isReady: () => OwnedChannel.db.readyState === mongoose.ConnectionStates.connected,
    async findByUser(userId) {
        requireReady();
        return OwnedChannel.findOne({ userId }).exec();
    },
    async findByChannel(channelId) {
        requireReady();
        return OwnedChannel.findOne({ channelId }).exec();
    },
    async create(record) {
        requireReady();
        return OwnedChannel.create(record);
    },
    async deleteByChannel(channelId) {
        requireReady();
        await OwnedChannel.deleteOne({ channelId }).exec();
    },
    async save(document) {
        requireReady();
        await document.save();
    },
};
